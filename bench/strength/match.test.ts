// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { idx } from '../../src/core/board'
import { createBoard } from '../../src/core/board'
import { findWinLine } from '../../src/core/rules'
import type { Point } from '../../src/core/types'
import { playGame, playPaired, runExperiment } from './match'
import type { MatchOpening } from './openings'
import { createLocalEngine } from './local'
import type { Engine, EngineMove } from './types'

/**
 * 评测器自身的测试。
 *
 * 用**脚本化引擎**而不是真实搜索：这里要验证的是「评测器怎么归类、怎么计数」，
 * 让真实引擎参与只会把失败原因混进搜索行为里。真实引擎的对照在
 * `engines.test.ts`（打包等价性）与 `run.ts`（实际评测）里。
 */

const EMPTY_OPENING: MatchOpening = { id: 'test-empty', moves: [], source: 'test', note: '空盘' }

/** 按顺序吐出预设落点的引擎。用完之后一直停在最后一个点（测试里不会用到）。 */
function sequenceEngine(id: string, points: readonly Point[]): Engine {
  let index = 0
  return {
    id,
    choose(): EngineMove {
      const move = points[Math.min(index, points.length - 1)] ?? { x: 0, y: 0 }
      index++
      return { move, depth: 1, nodes: 10, ttHits: 0, reason: 'search', elapsedMs: 1 }
    },
  }
}

/** 永远返回同一个非法点的引擎。 */
function illegalEngine(id: string): Engine {
  return {
    id,
    choose(): EngineMove {
      return { move: { x: 15, y: 15 }, depth: 1, nodes: 1, ttHits: 0, reason: 'search', elapsedMs: 1 }
    },
  }
}

function throwingEngine(id: string): Engine {
  return {
    id,
    choose(): EngineMove {
      throw new Error('引擎内部炸了')
    },
  }
}

function nullEngine(id: string): Engine {
  return {
    id,
    choose(): EngineMove {
      return { move: null, depth: 0, nodes: 0, ttHits: 0, reason: 'no_move', elapsedMs: 0 }
    },
  }
}

function mutatingEngine(id: string): Engine {
  return {
    id,
    choose(board): EngineMove {
      board[0] = 1
      return { move: { x: 7, y: 7 }, depth: 0, nodes: 0, ttHits: 0, reason: 'opening', elapsedMs: 0 }
    },
  }
}

/** 黑棋五连的一组合法手顺（黑第 5 手成五）。 */
const BLACK_WIN_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 }, { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function blackPoints(): Point[] {
  return BLACK_WIN_MOVES.filter((_, i) => i % 2 === 0)
}

function whitePoints(): Point[] {
  return BLACK_WIN_MOVES.filter((_, i) => i % 2 === 1)
}

/**
 * 能下成和棋的完整手顺。
 *
 * 染色用 `(x + 2y) % 4 < 2`：四个方向上同色最长只连得出两颗（见
 * `src/test/board-fixtures.ts` 的说明），所以**任意子集都不可能成五**。
 *
 * 这个染色的子力数正好是 113 黑 / 112 白（8 个偶数行各 8 枚、7 个奇数行各 7 枚），
 * 满足黑先手。下面用 `findWinLine` 正面验证满盘无五连，而不是靠推理。
 *
 * 最后把黑白格按交替顺序串成手顺：真实对局是黑先、黑白交替，顺序必须匹配颜色。
 */
function drawMoves(): Point[] {
  const board = createBoard()
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      board[idx(x, y)] = (x + 2 * y) % 4 < 2 ? 1 : 2
    }
  }

  const black: Point[] = []
  const white: Point[] = []
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const cell = board[idx(x, y)]!
      if (cell === 1) black.push({ x, y })
      else white.push({ x, y })
      // 满盘不允许先成五
      expect(findWinLine(board, { x, y }), `和棋局面在 (${x},${y}) 已经成五`).toBeNull()
    }
  }

  expect(black).toHaveLength(113)
  expect(white).toHaveLength(112)

  const moves: Point[] = []
  for (let i = 0; i < black.length; i++) {
    moves.push(black[i]!)
    if (white[i] !== undefined) moves.push(white[i]!)
  }
  return moves
}

describe('对局执行器', () => {
  it('黑胜判定', () => {
    const record = playGame({
      black: sequenceEngine('black', blackPoints()),
      white: sequenceEngine('white', whitePoints()),
      opening: EMPTY_OPENING,
      maxMoves: 100,
    })

    expect(record.outcome).toBe('black-win')
    expect(record.winner).toBe(1)
    expect(record.moves).toHaveLength(9)
    expect(record.error).toBeNull()
  })

  it('白胜判定：换手顺，白棋成五', () => {
    // 白棋第 5 手成五：黑棋只做陪衬，白棋连成五子
    const record = playGame({
      // 陪衬手必须彼此不相邻——否则黑棋会先成五，测到的就不是「白胜」
      black: sequenceEngine('black', [
        { x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 0 },
      ]),
      white: sequenceEngine('white', [
        { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 },
      ]),
      opening: EMPTY_OPENING,
      maxMoves: 100,
    })

    expect(record.outcome).toBe('white-win')
    expect(record.winner).toBe(2)
    expect(record.moves).toHaveLength(10)
  })

  it('正常和棋：满盘无五连', () => {
    const moves = drawMoves()
    const record = playGame({
      black: sequenceEngine('black', moves.filter((_, i) => i % 2 === 0)),
      white: sequenceEngine('white', moves.filter((_, i) => i % 2 === 1)),
      opening: EMPTY_OPENING,
      maxMoves: 300,
    })

    expect(record.outcome).toBe('draw')
    expect(record.winner).toBeNull()
    expect(record.moves).toHaveLength(225)
  })

  it('非法落子被单独归类，并保留复现信息', () => {
    const record = playGame({
      black: illegalEngine('bad'),
      white: sequenceEngine('white', whitePoints()),
      opening: EMPTY_OPENING,
      maxMoves: 10,
    })

    expect(record.outcome).toBe('illegal-move')
    expect(record.error).toContain('bad')
    expect(record.error).toContain('out_of_bounds')
    expect(record.failAtMove).toBe(0)
    expect(record.moves).toHaveLength(0)
  })

  it('达到手数上限记为 move-limit，**不是和棋**', () => {
    const safe: readonly Point[] = [
      { x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }, { x: 2, y: 2 },
      { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 6, y: 0 }, { x: 6, y: 2 },
    ]
    const record = playGame({
      black: sequenceEngine('black', safe.filter((_, i) => i % 2 === 0)),
      white: sequenceEngine('white', safe.filter((_, i) => i % 2 === 1)),
      opening: EMPTY_OPENING,
      maxMoves: 4,
    })

    expect(record.outcome).toBe('move-limit')
    expect(record.moves).toHaveLength(4)
    expect(record.winner).toBeNull()
  })

  it('引擎抛错时记录引擎 id 与出错手数', () => {
    const record = playGame({
      black: throwingEngine('boom'),
      white: sequenceEngine('white', whitePoints()),
      opening: EMPTY_OPENING,
      maxMoves: 10,
    })

    expect(record.outcome).toBe('engine-error')
    expect(record.error).toContain('boom')
    expect(record.error).toContain('引擎内部炸了')
    expect(record.failAtMove).toBe(0)
  })

  it('盘面未满却返回 null 记为 no-move，不当作和棋', () => {
    const record = playGame({
      black: nullEngine('empty-handed'),
      white: sequenceEngine('white', whitePoints()),
      opening: EMPTY_OPENING,
      maxMoves: 10,
    })

    expect(record.outcome).toBe('no-move')
    expect(record.error).toContain('empty-handed')
  })

  it('实验超时记为 aborted', () => {
    let clock = 0
    const record = playGame({
      black: sequenceEngine('black', blackPoints()),
      white: sequenceEngine('white', whitePoints()),
      opening: EMPTY_OPENING,
      maxMoves: 100,
      // 每次读钟前进 100 ms，deadline 立刻过期
      now: () => (clock += 100),
      deadline: 50,
    })

    expect(record.outcome).toBe('aborted')
    expect(record.error).toContain('deadline')
  })

  it('引擎修改传入棋盘会被抓住并判为引擎异常', () => {
    const record = playGame({
      black: mutatingEngine('mutant'),
      white: sequenceEngine('white', whitePoints()),
      opening: EMPTY_OPENING,
      maxMoves: 10,
    })

    expect(record.outcome).toBe('engine-error')
    expect(record.error).toContain('修改了传入的棋盘')
  })

  it('同一开局、同一配置可复现', () => {
    const run = () =>
      playGame({
        black: sequenceEngine('black', blackPoints()),
        white: sequenceEngine('white', whitePoints()),
        opening: EMPTY_OPENING,
        maxMoves: 100,
      })

    const first = run()
    const second = run()
    expect(second.moves.map((m) => m.point)).toEqual(first.moves.map((m) => m.point))
    expect(second.outcome).toBe(first.outcome)
  })
})

describe('配对赛', () => {
  const OPENING: MatchOpening = {
    id: 'test-two-ply',
    moves: [{ x: 7, y: 7 }, { x: 7, y: 8 }],
    source: 'test',
    note: '两手开局',
  }

  it('同一开局下双方各执黑一次', () => {
    const a = sequenceEngine('A', [{ x: 0, y: 0 }, { x: 1, y: 0 }])
    const b = sequenceEngine('B', [{ x: 2, y: 0 }, { x: 3, y: 0 }])
    const set = playPaired(OPENING, a, b, { maxMoves: 2 })

    expect(set.aBlack.black).toBe('A')
    expect(set.aBlack.white).toBe('B')
    expect(set.bBlack.black).toBe('B')
    expect(set.bBlack.white).toBe('A')
  })

  it('对局数与重复次数相符', () => {
    const a = sequenceEngine('A', [{ x: 0, y: 0 }])
    const b = sequenceEngine('B', [{ x: 2, y: 0 }])
    const sets = runExperiment(a, b, {
      openings: [OPENING, { ...OPENING, id: 'second' }, { ...OPENING, id: 'third' }],
      maxMoves: 2,
      repeats: 2,
    })

    // 3 个开局 × 2 次重复 = 6 组；每组 2 局 = 12 局
    expect(sets).toHaveLength(6)
    expect(sets.flatMap((s) => [s.aBlack, s.bBlack])).toHaveLength(12)
  })

  it('确定性配置下两次实验完全一致', () => {
    const spec = { id: 'det', label: 'det', difficulty: 'easy' as const, clock: 'fixed' as const, maxDepth: 1 }

    const once = () => {
      const sets = runExperiment(createLocalEngine({ ...spec, id: 'A' }), createLocalEngine({ ...spec, id: 'B' }), {
        openings: [OPENING],
        maxMoves: 40,
      })
      return sets.flatMap((s) => [s.aBlack, s.bBlack]).map((r) => r.moves.map((m) => m.point))
    }

    expect(once()).toEqual(once())
  })

  it('大批量对局后堆内存没有明显增长', () => {
    const a = sequenceEngine('A', [{ x: 0, y: 0 }, { x: 1, y: 0 }])
    const b = sequenceEngine('B', [{ x: 2, y: 0 }, { x: 3, y: 0 }])

    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < 300; i++) {
      playPaired(OPENING, a, b, { maxMoves: 2 })
    }
    const after = process.memoryUsage().heapUsed

    // 阈值故意给得很宽：这条只抓「每局都留下整盘引用」这类粗放泄漏，
    // 不是精确的内存基准。精确测量要在 node --expose-gc 下做。
    expect(after - before).toBeLessThan(64 * 1024 * 1024)
  })
})
