import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import type { UseBoundStore, StoreApi } from 'zustand'
import { BLACK, WHITE, type Point } from '../core/types'
import { resign } from '../core/game'
import { createReplayStore, REPLAY_STEP_MS, type ReplayStore } from './replayStore'
import type { GameRecord } from '../persist/gameRecords'
type ReplayRecord = Omit<GameRecord, 'seq' | 'schemaVersion'>

/** 黑棋第 7 行五连、白棋下方散四子——9 手黑胜。 */
const WIN_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 }, { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function winRecord(moves: readonly Point[] = WIN_MOVES): ReplayRecord {
  return {
    moves: [...moves],
    firstPlayer: BLACK,
    mode: 'pve',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
  }
}

function resignRecord(): ReplayRecord {
  return {
    moves: [],
    firstPlayer: BLACK,
    mode: 'pve',
    humanColor: WHITE,
    difficulty: 'easy',
    resignedBy: BLACK,
    winner: WHITE,
  }
}

let store: UseBoundStore<StoreApi<ReplayStore>>

beforeEach(() => {
  store = createReplayStore()
})

describe('回放器 —— 游标与派生局面', () => {
  it('未打开时 position 是空盘', () => {
    expect(store.getState().record).toBeNull()
    expect(store.getState().position.version).toBe(0)
    expect(store.getState().hasNext).toBe(false)
    expect(store.getState().hasPrev).toBe(false)
  })

  it('open 后停在空盘：version 0、盘面全空', () => {
    const record = winRecord()
    store.getState().open(record as unknown as GameRecord)

    const { position, cursor } = store.getState()
    expect(cursor).toBe(0)
    expect(position.version).toBe(0)
    expect(position.board.every((cell) => cell === 0)).toBe(true)
    expect(position.moves).toHaveLength(0)
  })

  it('stepNext 一次：version 1、lastMove 是第 1 手', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().stepNext()

    const { position, cursor } = store.getState()
    expect(cursor).toBe(1)
    expect(position.version).toBe(1)
    expect(position.lastMove).toEqual(WIN_MOVES[0])
  })

  it('goTo 负数与超界都 clamp 进 [0, moves.length]', () => {
    store.getState().open(winRecord() as unknown as GameRecord)

    store.getState().goTo(-5)
    expect(store.getState().cursor).toBe(0)

    store.getState().goTo(999)
    expect(store.getState().cursor).toBe(9)
  })

  it('连续 stepNext 到尾后 hasNext 为 false，再 stepNext 是空操作', () => {
    store.getState().open(winRecord() as unknown as GameRecord)

    for (let i = 0; i < 20; i++) store.getState().stepNext()

    const state = store.getState()
    expect(state.cursor).toBe(9)
    expect(state.hasNext).toBe(false)

    const positionBefore = state.position
    store.getState().stepNext()
    expect(store.getState().position).toBe(positionBefore)
  })

  it('多手棋谱的中间游标保持 playing——终局标记不提前应用', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().goTo(5) // 黑白各两手半，没到终局

    expect(store.getState().position.status).toBe('playing')
    expect(store.getState().position.winner).toBeNull()
  })

  it('走完之后 position 反映真实终局（黑棋五连获胜）', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().goTo(9)

    const { position } = store.getState()
    expect(position.status).toBe('won')
    expect(position.winner).toBe(BLACK)
  })
})

describe('回放器 —— 认输局', () => {
  it('0 手认输局打开即为认输终局（这局确实结束了）', () => {
    const record = resignRecord()
    store.getState().open(record as unknown as GameRecord)

    const { position, cursor, hasNext } = store.getState()
    expect(cursor).toBe(0)
    expect(hasNext).toBe(false)
    // cursor === moves.length 且 resignedBy 非空 → 套 resign
    expect(position.status).toBe('resigned')
    expect(position.winner).toBe(WHITE)
  })

  it('多手认输局的中间游标是 playing，走到末尾才显示认输', () => {
    const record: ReplayRecord = {
      ...resignRecord(),
      moves: [{ x: 7, y: 7 }, { x: 8, y: 8 }],
    }
    store.getState().open(record as unknown as GameRecord)

    store.getState().goTo(1)
    expect(store.getState().position.status).toBe('playing')

    store.getState().goTo(2)
    const { position } = store.getState()
    // replay 出的终局 + resign 叠加
    expect(position.status).toBe('resigned')
    expect(position.winner).toBe(WHITE)
    // 与直接调用 resign 语义一致
    const manual = resign(store.getState().position, BLACK)
    expect(manual.winner).toBe(position.winner)
  })
})

describe('回放器 —— 派生完整性', () => {
  it('position.moves 恒等于 record.moves.slice(0, cursor)', () => {
    const record = winRecord()
    store.getState().open(record as unknown as GameRecord)

    for (const cursor of [0, 1, 5, 9]) {
      store.getState().goTo(cursor)
      const { position } = store.getState()
      expect(position.moves).toEqual(record.moves.slice(0, cursor))
    }
  })
})

describe('回放器 —— 自动播放', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('play 后每 REPLAY_STEP_MS 前进一步', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().play()

    expect(store.getState().playing).toBe(true)

    vi.advanceTimersByTime(REPLAY_STEP_MS)
    expect(store.getState().cursor).toBe(1)

    vi.advanceTimersByTime(REPLAY_STEP_MS)
    expect(store.getState().cursor).toBe(2)
  })

  it('到尾自动停', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().goTo(9)
    store.getState().play()

    vi.advanceTimersByTime(REPLAY_STEP_MS * 3)

    expect(store.getState().playing).toBe(false)
    expect(store.getState().cursor).toBe(9)
  })

  it('pause 后定时器不再推进', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().play()
    store.getState().pause()

    expect(store.getState().playing).toBe(false)

    vi.advanceTimersByTime(REPLAY_STEP_MS * 5)
    expect(store.getState().cursor).toBe(0)
  })

  it('play 在已在播放时是空操作，不叠加定时器', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().play()
    store.getState().play()

    vi.advanceTimersByTime(REPLAY_STEP_MS)
    expect(store.getState().cursor).toBe(1) // 叠加的话这里会是 2
  })

  it('close 停掉播放并清空记录', () => {
    store.getState().open(winRecord() as unknown as GameRecord)
    store.getState().play()
    store.getState().close()

    expect(store.getState().playing).toBe(false)
    expect(store.getState().record).toBeNull()

    vi.advanceTimersByTime(REPLAY_STEP_MS * 3)
    expect(store.getState().position.version).toBe(0)
  })
})
