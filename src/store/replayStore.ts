import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { replay, resign as resignGame, type GameState } from '../core/game'
import { BLACK } from '../core/types'
import type { GameRecord } from '../persist/gameRecords'

/** 自动播放的步进间隔。 */
export const REPLAY_STEP_MS = 900

export type ReplayRecord = Omit<GameRecord, 'seq' | 'schemaVersion'>

export interface ReplayStore {
  readonly record: ReplayRecord | null
  /** 当前看到第几手（0 = 空盘，moves.length = 终局）。 */
  readonly cursor: number
  readonly playing: boolean
  /**
   * 派生局面：`replay(record.moves.slice(0, cursor))`；
   * **cursor === moves.length 且 record.resignedBy 非空时再套一层 resign**。
   * 0 手的认输局（moves 为空数组）打开即为认输终局——这局确实结束了。
   */
  readonly position: GameState
  readonly hasPrev: boolean
  readonly hasNext: boolean

  open(record: GameRecord): void
  close(): void
  stepPrev(): void
  stepNext(): void
  /** clamp 到 [0, moves.length]。 */
  goTo(index: number): void
  play(): void
  pause(): void
}

/** position 是纯派生：由 record + cursor 算出，绝不增量维护。 */
function derivePosition(record: ReplayRecord, cursor: number): GameState {
  const replayed = replay(record.moves.slice(0, cursor), record.firstPlayer)
  if (cursor === record.moves.length && record.resignedBy !== null) {
    return resignGame(replayed, record.resignedBy)
  }
  return replayed
}

function deriveState(record: ReplayRecord | null, cursor: number, playing: boolean) {
  if (record === null) {
    return {
      record: null,
      cursor: 0,
      playing: false,
      position: replay([], BLACK),
      hasPrev: false,
      hasNext: false,
    } as const
  }

  const total = record.moves.length
  return {
    record,
    cursor,
    playing,
    position: derivePosition(record, cursor),
    hasPrev: cursor > 0,
    hasNext: cursor < total,
  } as const
}

export function createReplayStore(): UseBoundStore<StoreApi<ReplayStore>> {
  let timer: ReturnType<typeof setInterval> | null = null

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return create<ReplayStore>()((set, get) => {
    // record + cursor + playing 之外的字段全部派生；set 时整体重算，
    // 不存在「改了游标忘了重算局面」这类裂缝。
    function commit(patch: { cursor?: number; playing?: boolean }) {
      const current = get()
      const record = current.record
      if (record === null) return

      const cursor = patch.cursor ?? current.cursor
      const playing = patch.playing ?? current.playing
      set(deriveState(record, cursor, playing))
    }

    return {
      ...deriveState(null, 0, false),

      open(record) {
        stopTimer()
        set(deriveState(record, 0, false))
      },

      close() {
        stopTimer()
        set(deriveState(null, 0, false))
      },

      stepPrev() {
        const { cursor } = get()
        if (cursor > 0) commit({ cursor: cursor - 1 })
      },

      stepNext() {
        const { record, cursor } = get()
        if (record === null || cursor >= record.moves.length) return
        commit({ cursor: cursor + 1 })
      },

      goTo(index) {
        const { record } = get()
        if (record === null) return
        const clamped = Math.max(0, Math.min(index, record.moves.length))
        commit({ cursor: clamped })
      },

      play() {
        const { record, playing } = get()
        if (record === null || playing) return

        commit({ playing: true })
        timer = setInterval(() => {
          const state = get()
          if (state.record === null || !state.hasNext) {
            // 到尾（或记录已关）自动停
            stopTimer()
            commit({ playing: false })
            return
          }
          state.stepNext()
        }, REPLAY_STEP_MS)
      },

      pause() {
        stopTimer()
        commit({ playing: false })
      },
    }
  })
}
