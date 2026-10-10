import { describe, expect, it } from 'vitest'
import { cellAt, createBoard, idx, inBounds, opponentOf, pointFromIdx } from './board'
import { BOARD_SIZE, CELL_COUNT } from './types'

describe('idx / pointFromIdx', () => {
  it('按行主序换算索引', () => {
    expect(idx(0, 0)).toBe(0)
    expect(idx(14, 0)).toBe(14)
    expect(idx(0, 1)).toBe(15)
    expect(idx(14, 14)).toBe(224)
  })

  it('pointFromIdx 是 idx 的逆运算', () => {
    for (let i = 0; i < CELL_COUNT; i += 7) {
      expect(idx(pointFromIdx(i).x, pointFromIdx(i).y)).toBe(i)
    }
  })
})

describe('inBounds', () => {
  it.each([
    [0, 0],
    [14, 0],
    [0, 14],
    [14, 14],
    [7, 7],
  ])('(%i, %i) 在界内', (x, y) => {
    expect(inBounds(x, y)).toBe(true)
  })

  it.each([
    [-1, 0],
    [0, -1],
    [BOARD_SIZE, 0],
    [0, BOARD_SIZE],
    [1.5, 0],
    [0, 2.5],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])('(%s, %s) 在界外', (x, y) => {
    expect(inBounds(x, y)).toBe(false)
  })
})

describe('createBoard', () => {
  it('返回 225 格且全为空', () => {
    const board = createBoard()
    expect(board).toHaveLength(CELL_COUNT)
    expect(board.every((cell) => cell === 0)).toBe(true)
  })

  it('每次调用返回互相独立的棋盘', () => {
    const a = createBoard()
    const b = createBoard()
    a[idx(3, 3)] = 1
    expect(b[idx(3, 3)]).toBe(0)
  })
})

describe('cellAt', () => {
  it('读回写入的值', () => {
    const board = createBoard()
    board[idx(3, 7)] = 1
    expect(cellAt(board, 3, 7)).toBe(1)
    expect(cellAt(board, 4, 7)).toBe(0)
  })

  it('界外一律按空处理，方便扫描连线时省略边界判断', () => {
    expect(cellAt(createBoard(), -1, 0)).toBe(0)
    expect(cellAt(createBoard(), BOARD_SIZE, 0)).toBe(0)
  })
})

describe('opponentOf', () => {
  it('黑白的对手互为对方', () => {
    expect(opponentOf(1)).toBe(2)
    expect(opponentOf(2)).toBe(1)
  })
})
