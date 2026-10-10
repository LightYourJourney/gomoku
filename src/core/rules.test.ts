import { describe, expect, it } from 'vitest'
import { boardFromLines, linesFromBoard } from '../test/board-fixtures'
import { createBoard } from './board'
import { findWinLine, isBoardFull, validateMove } from './rules'
import { BOARD_SIZE, type Point } from './types'

/** 断言 findWinLine 返回的连线正好是这些点（顺序：沿连线的负方向端到正方向端）。 */
function expectLine(actual: readonly Point[] | null, expected: readonly Point[]): void {
  expect(actual).not.toBeNull()
  expect(actual).toEqual(expected)
}

describe('findWinLine —— 四个方向', () => {
  it('识别横向五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...BBBBB.......',
    ])

    expectLine(findWinLine(board, { x: 7, y: 7 }), [
      { x: 3, y: 7 },
      { x: 4, y: 7 },
      { x: 5, y: 7 },
      { x: 6, y: 7 },
      { x: 7, y: 7 },
    ])
  })

  it('识别纵向五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '.......B.......',
      '.......B.......',
      '.......B.......',
      '.......B.......',
      '.......B.......',
    ])

    expectLine(findWinLine(board, { x: 7, y: 7 }), [
      { x: 7, y: 3 },
      { x: 7, y: 4 },
      { x: 7, y: 5 },
      { x: 7, y: 6 },
      { x: 7, y: 7 },
    ])
  })

  it('识别主对角线（↘）五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...B...........',
      '....B..........',
      '.....B.........',
      '......B........',
      '.......B.......',
    ])

    expectLine(findWinLine(board, { x: 7, y: 7 }), [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
      { x: 6, y: 6 },
      { x: 7, y: 7 },
    ])
  })

  it('识别副对角线（↗）五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '.......B.......',
      '......B........',
      '.....B.........',
      '....B..........',
      '...B...........',
    ])

    expectLine(findWinLine(board, { x: 4, y: 6 }), [
      { x: 3, y: 7 },
      { x: 4, y: 6 },
      { x: 5, y: 5 },
      { x: 6, y: 4 },
      { x: 7, y: 3 },
    ])
  })

  it('白棋同样可以五连获胜', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...WWWWW.......',
    ])

    expect(findWinLine(board, { x: 5, y: 7 })).toHaveLength(5)
  })
})

describe('findWinLine —— 边界', () => {
  it('识别贴左边缘的五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      'BBBBB..........',
    ])

    expect(findWinLine(board, { x: 0, y: 7 })).toHaveLength(5)
  })

  it('识别贴右边缘的五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '..........BBBBB',
    ])

    expect(findWinLine(board, { x: 14, y: 7 })).toHaveLength(5)
  })

  it('识别贴顶边的五连', () => {
    const board = boardFromLines(['.....BBBBB.....'])

    expectLine(findWinLine(board, { x: 9, y: 0 }), [
      { x: 5, y: 0 },
      { x: 6, y: 0 },
      { x: 7, y: 0 },
      { x: 8, y: 0 },
      { x: 9, y: 0 },
    ])
  })

  it('识别贴底边的五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BBBBB.....',
    ])

    expect(findWinLine(board, { x: 5, y: 14 })).toHaveLength(5)
  })

  it('识别贴左上角的主对角线五连', () => {
    const board = boardFromLines([
      'B..............',
      '.B.............',
      '..B............',
      '...B...........',
      '....B..........',
    ])

    expect(findWinLine(board, { x: 0, y: 0 })).toHaveLength(5)
  })

  it('识别贴右下角的主对角线五连', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '..........B....',
      '...........B...',
      '............B..',
      '.............B.',
      '..............B',
    ])

    expect(findWinLine(board, { x: 14, y: 14 })).toHaveLength(5)
  })
})

describe('findWinLine —— 长连与反例', () => {
  it('长连（六连）同样判胜，并返回全部六枚', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...BBBBBB......',
    ])

    expectLine(findWinLine(board, { x: 8, y: 7 }), [
      { x: 3, y: 7 },
      { x: 4, y: 7 },
      { x: 5, y: 7 },
      { x: 6, y: 7 },
      { x: 7, y: 7 },
      { x: 8, y: 7 },
    ])
  })

  it('四连不算胜', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...BBBB........',
    ])

    expect(findWinLine(board, { x: 6, y: 7 })).toBeNull()
  })

  it('被对方棋子隔断的四连不算胜', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...BBWBB.......',
    ])

    expect(findWinLine(board, { x: 7, y: 7 })).toBeNull()
  })

  it('只检查最后一手所在的连线，盘中无关的五连不算最后一手获胜', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      'BBBBB..........',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '............W..',
    ])

    expect(findWinLine(board, { x: 12, y: 14 })).toBeNull()
  })

  it('最后一手落在空位上时返回 null', () => {
    expect(findWinLine(createBoard(), { x: 7, y: 7 })).toBeNull()
  })
})

describe('validateMove', () => {
  const board = boardFromLines(['...............', '...............', '...............', '...............', '...............', '...............', '...............', '...B...........'])

  it('空位可以通过', () => {
    expect(validateMove(board, { x: 0, y: 0 })).toBeNull()
    expect(validateMove(board, { x: 14, y: 14 })).toBeNull()
  })

  it('拒绝已占用的位置', () => {
    expect(validateMove(board, { x: 3, y: 7 })).toBe('occupied')
  })

  it.each([
    ['x 为负', { x: -1, y: 0 }],
    ['y 为负', { x: 0, y: -1 }],
    ['x 越上界', { x: BOARD_SIZE, y: 0 }],
    ['y 越上界', { x: 0, y: BOARD_SIZE }],
    ['x 非整数', { x: 1.5, y: 0 }],
    ['y 非整数', { x: 0, y: 2.5 }],
    ['x 为 NaN', { x: Number.NaN, y: 0 }],
    ['x 为 Infinity', { x: Number.POSITIVE_INFINITY, y: 0 }],
  ])('拒绝非法坐标：%s', (_label, point) => {
    expect(validateMove(board, point)).toBe('out_of_bounds')
  })
})

describe('isBoardFull', () => {
  it('空棋盘不算满', () => {
    expect(isBoardFull(createBoard())).toBe(false)
  })

  it('填满全部 225 格才算满', () => {
    const board = createBoard()
    board.fill(1)
    expect(isBoardFull(board)).toBe(true)
  })

  it('只差一格就不算满', () => {
    const board = createBoard()
    board.fill(2)
    board[0] = 0
    expect(isBoardFull(board)).toBe(false)
  })
})

describe('测试夹具自检', () => {
  it('boardFromLines 与 linesFromBoard 互为逆运算', () => {
    const lines = [
      'B.W............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '..............W',
    ]
    expect(linesFromBoard(boardFromLines(lines))).toEqual(lines)
  })

  it('列数超过棋盘宽度时直接报错，避免测试数据被静默截断', () => {
    expect(() => boardFromLines(['................'])).toThrow(/16 列/)
  })

  it('行数超过棋盘高度时直接报错', () => {
    expect(() => boardFromLines(Array.from({ length: 16 }, () => '...............'))).toThrow(
      /16 行/,
    )
  })
})
