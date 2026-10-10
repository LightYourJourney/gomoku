import { describe, expect, it } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK, WHITE, type Board, type Player } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import { chooseMove } from './search'
import type { Difficulty, SearchRequest, SearchResponse } from './types'

function ask(
  board: Board,
  player: Player,
  difficulty: Difficulty = 'easy',
  extra: Partial<SearchRequest> = {},
): SearchResponse {
  return chooseMove({
    requestId: 1,
    gameVersion: 0,
    board,
    player,
    difficulty,
    ...extra,
  })
}

describe('chooseMove —— 必胜与必防', () => {
  it('己方有四连时立即补成五', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...BBBB........',
    ])

    const result = ask(board, BLACK)

    expect(result.reason).toBe('win')
    expect([{ x: 2, y: 2 }, { x: 7, y: 2 }]).toContainEqual(result.move)
  })

  it('对手有四连时立即堵住', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '..BWWWW........',
    ])

    const result = ask(board, BLACK)

    expect(result.reason).toBe('block')
    expect(result.move).toEqual({ x: 7, y: 2 })
  })

  it('能赢的时候不会去防守', () => {
    // 黑棋自己有四连，白棋也有四连；黑棋应当直接取胜。
    const board = boardFromLines([
      '...............',
      '...BBBB........',
      '...............',
      '..W.WWWW.......',
    ])

    const result = ask(board, BLACK)

    expect(result.reason).toBe('win')
    expect([{ x: 2, y: 1 }, { x: 7, y: 1 }]).toContainEqual(result.move)
  })

  it('白棋同样会补成五', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...WWWW........',
    ])

    const result = ask(board, WHITE)

    expect(result.reason).toBe('win')
    expect([{ x: 2, y: 2 }, { x: 7, y: 2 }]).toContainEqual(result.move)
  })
})

describe('chooseMove —— 战术判断', () => {
  it('对手活三时必须应对', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....WWW.......',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      'B..............',
    ])

    const result = ask(board, BLACK)

    expect([{ x: 4, y: 7 }, { x: 8, y: 7 }]).toContainEqual(result.move)
  })

  it('不会放过自己成四的机会', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BBB.......',
      '.....WW........',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
    ])

    const result = ask(board, BLACK)

    expect([{ x: 4, y: 7 }, { x: 8, y: 7 }]).toContainEqual(result.move)
  })
})

describe('chooseMove —— 开局与边界', () => {
  it('空盘时下天元', () => {
    const result = ask(createBoard(), BLACK)

    expect(result.move).toEqual({ x: 7, y: 7 })
    expect(result.reason).toBe('opening')
  })

  it('满盘时没有可走的着法', () => {
    const board = createBoard()
    board.fill(1)

    const result = ask(board, BLACK)

    expect(result.move).toBeNull()
    expect(result.reason).toBe('no_move')
  })

  it('返回的着法一定落在空位上', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE)

    expect(result.move).not.toBeNull()
    expect(board[result.move!.y * 15 + result.move!.x]).toBe(0)
  })
})

describe('chooseMove —— 时间预算', () => {
  it('预算极小时仍然返回一个合法着法，并标记为超时回退', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE, 'expert', { budgetMs: 0 })

    expect(result.move).not.toBeNull()
    expect(result.reason).toBe('timeout')
    expect(result.confidence).toBe('heuristic')
    expect(board[result.move!.y * 15 + result.move!.x]).toBe(0)
  })

  it('预算充足时给出精确结论', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE, 'easy', { budgetMs: 5000 })

    expect(result.reason).toBe('search')
    expect(result.confidence).toBe('exact')
    expect(result.depth).toBeGreaterThan(0)
  })

  it('记录搜索耗时与节点数', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE)

    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(result.nodes).toBeGreaterThan(0)
  })
})

describe('chooseMove —— 难度差异', () => {
  it('入门与初级都能应对对手的活三', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....WWW.......',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      'B..............',
    ])

    for (const difficulty of ['beginner', 'easy'] as const) {
      const result = ask(board, BLACK, difficulty)
      expect([{ x: 4, y: 7 }, { x: 8, y: 7 }]).toContainEqual(result.move)
    }
  })

  it('请求原样带回 requestId 与 gameVersion，供主线程作废过期结果', () => {
    const board = boardFromLines(['...............', '...............', '...............', '...............', '...............', '...............', '...............', '.....BWB.......'])

    const result = ask(board, WHITE, 'easy', { requestId: 42, gameVersion: 7 })

    expect(result.requestId).toBe(42)
    expect(result.gameVersion).toBe(7)
  })
})
