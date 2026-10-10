import { describe, expect, it } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK, WHITE, type Board, type Player } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import { chooseMove, searchBoard } from './search'
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

describe('searchBoard —— 置换表与注入时钟', () => {
  // 中盘局面：多个方向都有应手，不同着法次序容易走到同一局面（换位）
  const MIDGAME = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '......WB.......',
    '.....BWB.......',
    '......BW.......',
    '.......B.......',
  ])

  const options = { width: 10, maxDepth: 4, budgetMs: 60_000, transposition: true }
  const clock = (): number => 0

  it('开启置换表后节点数少于关闭时', () => {
    const withTable = searchBoard(MIDGAME, WHITE, options, clock)
    const withoutTable = searchBoard(MIDGAME, WHITE, { ...options, transposition: false }, clock)

    expect(withTable.nodes).toBeLessThan(withoutTable.nodes)
  })

  it('置换表确实产生过命中', () => {
    // 没有这一条，上面的节点数对比可能只是两个相等的数在互相比较
    const result = searchBoard(MIDGAME, WHITE, options, clock)

    expect(result.ttHits).toBeGreaterThan(0)
  })

  it('开启置换表不改变必胜局面的结论', () => {
    // 用有唯一正确着法的局面：黑棋四连，两端都能成五，随便选一端都是胜
    const mustWin = boardFromLines(['...............', '...............', '...BBBB........'])
    const winOptions = { width: 10, maxDepth: 4, budgetMs: 60_000, transposition: true }

    const withTable = searchBoard(mustWin, BLACK, winOptions, clock)
    const withoutTable = searchBoard(mustWin, BLACK, { ...winOptions, transposition: false }, clock)

    expect(withTable.score).toBe(withoutTable.score)
    expect([{ x: 2, y: 2 }, { x: 7, y: 2 }]).toContainEqual(withTable.move)
  })

  it('必胜分值不随搜索深度漂移', () => {
    // canWinNow 返回 WIN_SCORE - ply，若直接存表就会带上「本次迭代目标深度」，
    // 同一局面在不同 maxDepth 下会拿到不同分值。
    const mustWin = boardFromLines(['...............', '...............', '...BBBB........'])
    const base = { width: 10, budgetMs: 60_000, transposition: true }

    const shallow = searchBoard(mustWin, BLACK, { ...base, maxDepth: 2 }, clock)
    const deep = searchBoard(mustWin, BLACK, { ...base, maxDepth: 5 }, clock)

    expect(shallow.score).toBe(deep.score)
  })

  it('注入的时钟走到预算耗尽时返回超时回退，并给出合法着法', () => {
    let ticks = 0
    // 第一次调用给起点，之后每次直接跳过预算
    const expiringClock = (): number => {
      ticks++
      return ticks === 1 ? 0 : 10_000
    }

    const result = searchBoard(MIDGAME, WHITE, { ...options, budgetMs: 100 }, expiringClock)

    expect(result.reason).toBe('timeout')
    expect(result.move).not.toBeNull()
    expect(MIDGAME[result.move!.y * 15 + result.move!.x]).toBe(0)
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
