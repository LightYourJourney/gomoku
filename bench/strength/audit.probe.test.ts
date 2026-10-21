import { describe, expect, it } from 'vitest'
import { createBoard, idx } from '../../src/core/board'
import { applyMove, createGame } from '../../src/core/game'
import { findWinLine, validateMove } from '../../src/core/rules'
import { BLACK, WHITE, type Board } from '../../src/core/types'
import { boardFromLines } from '../../src/test/board-fixtures'
import { DIFFICULTY_PARAMS } from '../../src/ai/difficulty'
import { evaluateBoard } from '../../src/ai/evaluate'
import { createIncrementalEvaluator } from '../../src/ai/incrementalEvaluate'
import { searchBoard, searchOptionsFor } from '../../src/ai/search'
import { computeKey, toggleStone, toggleTurn } from '../../src/ai/transposition'
import { proveForcedWin } from './proof'

const CLOCK = () => 0
const OPTIONS = {
  width: 10,
  maxDepth: 4,
  budgetMs: 1_000_000,
  transposition: true,
  threatPlies: 0,
  threatThrees: false,
  attack: 1,
  defense: 1,
} as const

function place(board: Board, x: number, y: number, player: 1 | 2): Board {
  const next = board.slice()
  next[idx(x, y)] = player
  return next
}

describe('审计探针 · 规则', () => {
  it('四个方向成五都能判出；四子不算', () => {
    const base = createBoard()
    const cases = [
      [{ x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }],
      [{ x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 }],
      [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }],
      [{ x: 11, y: 3 }, { x: 10, y: 4 }, { x: 9, y: 5 }, { x: 8, y: 6 }, { x: 7, y: 7 }],
    ]
    for (const stones of cases) {
      let board = base
      for (const p of stones) board = place(board, p.x, p.y, BLACK)
      expect(findWinLine(board, stones[4]!)).not.toBeNull()
    }

    let four = base
    for (const x of [3, 4, 5, 6]) four = place(four, x, 7, BLACK)
    expect(findWinLine(four, { x: 6, y: 7 })).toBeNull()
  })

  it('长连（6 子）也判胜，且返回整段长度', () => {
    let board = createBoard()
    for (const x of [3, 4, 5, 6, 7, 8]) board = place(board, x, 7, BLACK)

    expect(findWinLine(board, { x: 8, y: 7 })).toHaveLength(6)
  })

  it('非法落子与终局落子被拒', () => {
    const board = place(createBoard(), 7, 7, BLACK)
    expect(validateMove(board, { x: 7, y: 7 })).toBe('occupied')
    expect(validateMove(board, { x: -1, y: 0 })).toBe('out_of_bounds')
    expect(validateMove(board, { x: 15, y: 15 })).toBe('out_of_bounds')

    let state = createGame()
    for (const p of [
      { x: 3, y: 7 }, { x: 3, y: 8 },
      { x: 4, y: 7 }, { x: 4, y: 8 },
      { x: 5, y: 7 }, { x: 5, y: 8 },
      { x: 6, y: 7 }, { x: 6, y: 8 },
      { x: 7, y: 7 },
    ]) {
      const applied = applyMove(state, p)
      expect(applied.ok).toBe(true)
      if (applied.ok) state = applied.state
    }
    expect(state.status).toBe('won')
    expect(applyMove(state, { x: 0, y: 0 }).ok).toBe(false)
  })
})

describe('审计探针 · 搜索', () => {
  it('一手成五：直接走成五点', () => {
    const board = boardFromLines(['...............', '...............', '...............', '......BBBB.....'])
    const result = searchBoard(board, BLACK, { ...OPTIONS, maxDepth: 3 }, CLOCK)
    expect(result.reason).toBe('win')
    expect(result.move).not.toBeNull()
    const after = place(board, result.move!.x, result.move!.y, BLACK)
    expect(findWinLine(after, result.move!)).not.toBeNull()
  })

  it('必防：只有 (9,7) 不立即输', () => {
    // 前面补 7 行空行，威胁才落在 y=7；boardFromLines 从顶部开始填。
    const board = boardFromLines([
      ...Array.from({ length: 7 }, () => '...............'),
      '....BWWWW......',
    ])
    const result = searchBoard(board, BLACK, { ...OPTIONS, maxDepth: 3 }, CLOCK)
    expect(result.reason).toBe('block')
    expect(result.move).toEqual({ x: 9, y: 7 })
  })

  it('固定深度不超过上限，着法合法', () => {
    const board = boardFromLines([
      '...............', '...............', '...............', '.......W.......',
      '.......B.......', '.....B.....W...', '......WB.......', '....W.B.B......',
      '.......W.......',
    ])
    for (const depth of [1, 2, 3]) {
      const result = searchBoard(board, BLACK, { ...OPTIONS, maxDepth: depth, threatPlies: 0 }, CLOCK)
      expect(result.depth).toBeLessThanOrEqual(depth)
      expect(result.move).not.toBeNull()
      expect(validateMove(board, result.move!)).toBeNull()
    }
  })

  it('安静局面没有假必胜声明', () => {
    const board = boardFromLines([
      '...............', '...............', '...............', '.......W.......',
      '.......B.......', '.....B.....W...', '......WB.......', '....W.B.B......',
      '.......W.......',
    ])
    const result = searchBoard(board, BLACK, { ...OPTIONS, maxDepth: 4 }, CLOCK)
    expect(['search', 'timeout']).toContain(result.reason)
  })

  it('独立证明器：活三局面存在三手强制胜，安静局面没有', () => {
    const openThree = boardFromLines(['...............', '...............', '...............', '......BBB......'])
    expect(proveForcedWin(openThree, BLACK)).not.toBeNull()

    const quiet = boardFromLines([
      '...............', '...............', '...............', '.......W.......',
      '.......B.......', '.....B.....W...', '......WB.......', '....W.B.B......',
      '.......W.......',
    ])
    expect(proveForcedWin(quiet, BLACK)).toBeNull()
  })
})

describe('审计探针 · 置换表与增量评估', () => {
  it('同一局面的不同手顺得到同一个键', () => {
    const board = createBoard()
    const a = place(place(board, 7, 7, BLACK), 8, 8, WHITE)
    const b = place(place(board, 8, 8, WHITE), 7, 7, BLACK)
    expect(computeKey(a, BLACK)).toEqual(computeKey(b, BLACK))
  })

  it('toggleStone / toggleTurn 两次回到原键', () => {
    const board = place(createBoard(), 7, 7, BLACK)
    const key = computeKey(board, WHITE)
    expect(toggleStone(toggleStone(key, 3, WHITE), 3, WHITE)).toEqual(key)
    expect(toggleTurn(toggleTurn(key))).toEqual(key)
  })

  it('增量评估与全盘评估逐位相等，且撤销后恢复', () => {
    const boards = [
      boardFromLines(['...............', '...............', '...............', '......BBB......']),
      boardFromLines([
        '...............', '...............', '...............', '.......W.......',
        '.......B.......', '.....B.....W...', '......WB.......', '....W.B.B......',
        '.......W.......',
      ]),
    ]
    for (const board of boards) {
      const evaluator = createIncrementalEvaluator(board)
      expect(evaluator.score(BLACK)).toBe(evaluateBoard(board, BLACK))
      expect(evaluator.score(WHITE)).toBe(evaluateBoard(board, WHITE))

      const empty = board.findIndex((cell) => cell === 0)
      const before = { black: evaluator.score(BLACK), white: evaluator.score(WHITE) }
      evaluator.place(empty, BLACK)
      expect(evaluator.score(BLACK)).toBe(evaluateBoard(place(board, empty % 15, Math.floor(empty / 15), BLACK), BLACK))
      evaluator.undo()
      expect(evaluator.score(BLACK)).toBe(before.black)
      expect(evaluator.score(WHITE)).toBe(before.white)
    }
  })
})

describe('审计探针 · 五档可用性（固定时钟）', () => {
  it('五档都返回合法着法且不超过各自深度上限', () => {
    const board = boardFromLines([
      '...............', '...............', '...............', '.......W.......',
      '.......B.......', '.....B.....W...', '......WB.......', '....W.B.B......',
      '.......W.......',
    ])
    for (const difficulty of ['beginner', 'easy', 'medium', 'hard', 'expert'] as const) {
      const params = DIFFICULTY_PARAMS[difficulty]
      // 固定时钟 + 上限 8 在宽局面上会爆炸；压到 3 只验「接线与合法性」，
      // 深度上限的完整验证由 difficulty.test.ts 的专项用例负责。
      const options = { ...searchOptionsFor(params, { budgetMs: 1_000_000 }), maxDepth: Math.min(params.depth, 3) }
      const result = searchBoard(board, BLACK, options, CLOCK)
      expect(result.depth).toBeLessThanOrEqual(Math.min(params.depth, 3))
      expect(result.move).not.toBeNull()
      expect(validateMove(board, result.move!)).toBeNull()
    }
  })
})
