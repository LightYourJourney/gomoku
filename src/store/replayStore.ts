import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { replay, resign as resignGame, type GameState } from '../core/game'
import { BLACK } from '../core/types'
import type { GameRecord } from '../persist/gameRecords'

/**
 * 自动播放的默认步进间隔（= 「标准」档）。
 *
 * **这个常量不能删**：`replayStore.test.ts` / `review.test.tsx` / `e2e/review.spec.ts`
 * 三处 import 它，其中 e2e 那处还派生了等待时长（`REPLAY_DWELL_MS`）。
 * 档位表里引用它，而不是另抄一个 900——同一个数字只许出现一次。
 */
export const REPLAY_STEP_MS = 900

/** 三档播放速度（毫秒／手）。间隔是设计选择：900 是原有值，另两档取明显的快慢差。 */
export const REPLAY_SPEEDS = {
  slow: 1400,
  normal: REPLAY_STEP_MS,
  fast: 400,
} as const

export type ReplaySpeed = keyof typeof REPLAY_SPEEDS

/**
 * 界面上给这三档的名字。**键序即展示顺序**——回放面板直接按它的键渲染。
 *
 * `Record<ReplaySpeed, string>` 保证加档位时这里必然被补上，而面板
 * 又从这个对象取顺序，于是「有几档、什么顺序、叫什么」只有这一个出处。
 * 早先面板自己又抄了一遍 `['slow', 'normal', 'fast']`：两句注释都写着
 * 「就是展示顺序」，实际谁也没管谁。
 */
export const REPLAY_SPEED_LABELS: Record<ReplaySpeed, string> = {
  slow: '慢速',
  normal: '标准',
  fast: '快速',
}

/** 回放器持有完整记录（含 seq）——分析管线要按 seq 做缓存键。 */
export type ReplayRecord = GameRecord

export interface ReplayStore {
  readonly record: ReplayRecord | null
  /** 当前看到第几手（0 = 空盘，moves.length = 终局）。 */
  readonly cursor: number
  readonly playing: boolean
  readonly speed: ReplaySpeed
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
  /** 手动定位：会**暂停自动播放**（你接管了，我就停）。 */
  stepPrev(): void
  stepNext(): void
  /** clamp 到 [0, moves.length]。同样会暂停。 */
  goTo(index: number): void
  play(): void
  pause(): void
  /** 播放中改速度会**重建**定时器，不会留下并行的第二个。 */
  setSpeed(speed: ReplaySpeed): void
}

/** position 是纯派生：由 record + cursor 算出，绝不增量维护。 */
function derivePosition(record: ReplayRecord, cursor: number): GameState {
  const replayed = replay(record.moves.slice(0, cursor), record.firstPlayer)
  if (cursor === record.moves.length && record.resignedBy !== null) {
    return resignGame(replayed, record.resignedBy)
  }
  return replayed
}

function deriveState(
  record: ReplayRecord | null,
  cursor: number,
  playing: boolean,
  speed: ReplaySpeed,
) {
  if (record === null) {
    return {
      record: null,
      cursor: 0,
      playing: false,
      speed,
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
    speed,
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
    /**
     * **起表的地方只有这一处**，而且进来先停旧的。
     *
     * 于是「改速度忘了清旧定时器」这类缺陷在结构上不存在：调用方要么没起，
     * 要么起的必然是唯一那个。改速度、开播、从暂停恢复，走的都是它。
     */
    function startTimer(stepMs: number) {
      stopTimer()
      timer = setInterval(() => {
        const state = get()
        const rec = state.record
        // 到尾（或记录已关）自动停——这是任务书 §六 点名的「到达结尾自动停止」
        if (rec === null || !state.hasNext) {
          stopTimer()
          commit({ playing: false })
          return
        }

        /*
         * 推进一格，**不走公开的 `stepNext`**：那个会暂停（手动定位的规则），
         * 定时器调它就等于第一个 tick 把自己停掉，自动播放只走一手。
         * 两件事长得像，语义不同。
         *
         * 「推进后正好到头」必须在**这一次 tick 里**收尾，不能等下一轮：
         * 否则第 N 手已经落在盘上、`playing` 还是 true，播放键顶着
         * `disabled`（`!hasNext`）写着「暂停」，最长一个间隔按不动
         * （慢速档 1.4s）——既停不掉，也点不动。
         */
        const next = state.cursor + 1
        const atEnd = next >= rec.moves.length
        if (atEnd) stopTimer()
        commit({ cursor: next, playing: !atEnd })
      }, stepMs)
    }

    // record + cursor + playing + speed 之外的字段全部派生；set 时整体重算，
    // 不存在「改了游标忘了重算局面」这类裂缝。
    function commit(patch: {
      cursor?: number
      playing?: boolean
      speed?: ReplaySpeed
    }) {
      const current = get()
      set(
        deriveState(
          current.record,
          patch.cursor ?? current.cursor,
          patch.playing ?? current.playing,
          patch.speed ?? current.speed,
        ),
      )
    }

        /**
     * 手动定位的统一前奏：**停表**。三个公开定位方法都从它开始。
     *
     * 「退出播放态」不在这里——它和游标一起由调用方的
     * `commit({ ..., playing: false })` 完成。两步分开是边界逼出来的：
     * 越界时那几个方法要原样返回、一个字段都不许动（见 `stepPrev` 的注释），
     * 所以「接管」只能发生在**真的要走一步**的时候。
     */
    function takeOver() {
      stopTimer()
    }

    return {
      ...deriveState(null, 0, false, 'normal'),

      open(record) {
        stopTimer()
        set(deriveState(record, 0, false, get().speed))
      },

      close() {
        stopTimer()
        set(deriveState(null, 0, false, get().speed))
      },

      /*
       * 边界时是**真·空操作**：一个字段都不动，连 `position` 的引用都保持原样。
       * 「接管」在前一步之前发生，不在越界尝试上——那时按钮本来就是禁用的，
       * 走到这里只可能是程序调用，没有谁需要被停下来。
       * （回归验证：早先把 `stopTimer()` 提到边界判断之前并补一次
       * `commit({ playing: false })`，`position` 每次都是新对象，
       * 「到尾后再 stepNext 是空操作」那条用例当场抓住了它。）
       */
      stepPrev() {
        const { cursor } = get()
        if (cursor <= 0) return
        takeOver()
        commit({ cursor: cursor - 1, playing: false })
      },

      stepNext() {
        const { record, cursor } = get()
        if (record === null || cursor >= record.moves.length) return
        takeOver()
        commit({ cursor: cursor + 1, playing: false })
      },

      goTo(index) {
        takeOver()
        const { record } = get()
        if (record === null) return
        const clamped = Math.max(0, Math.min(index, record.moves.length))
        commit({ cursor: clamped, playing: false })
      },

      play() {
        const { record, playing, hasNext, speed } = get()
        // 已经在终局就别摆出「正在播放」的样子——原先是先置 playing、
        // 等第一个 tick 才发现到头，于是按钮先变「暂停」再自己弹回来。
        if (record === null || playing || !hasNext) return

        commit({ playing: true })
        startTimer(REPLAY_SPEEDS[speed])
      },

      pause() {
        stopTimer()
        commit({ playing: false })
      },

      setSpeed(speed) {
        const { playing } = get()
        commit({ speed })
        // 播放中改速度必须重建定时器，否则旧 interval 会继续按旧间隔跑
        if (playing) startTimer(REPLAY_SPEEDS[speed])
      },
    }
  })
}
