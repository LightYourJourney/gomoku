import { describe, expect, it } from 'vitest'
import { createBoard, idx } from '../core/board'
import { boardFromLines } from '../test/board-fixtures'
import { candidateMoves, NEIGHBOR_RADIUS } from './candidates'

describe('candidateMoves', () => {
  it('空盘没有任何候选点', () => {
    expect(candidateMoves(createBoard())).toEqual([])
  })

  it('候选点全部落在已有棋子的邻域内', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
    ])

    for (const point of candidateMoves(board)) {
      expect(Math.abs(point.x - 7)).toBeLessThanOrEqual(NEIGHBOR_RADIUS)
      expect(Math.abs(point.y - 7)).toBeLessThanOrEqual(NEIGHBOR_RADIUS)
    }
  })

  it('不会把已有棋子当成候选点', () => {
    const board = boardFromLines(['...............', '...............', '...............', '...............', '...............', '...............', '...............', '.......B.......'])

    for (const point of candidateMoves(board)) {
      expect(board[idx(point.x, point.y)]).toBe(0)
    }
  })

  it('只下一子时，候选点是该子邻域内的全部空位', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
    ])

    // 半径 2 的 5×5 邻域共 25 格，扣掉棋子本身。
    expect(candidateMoves(board)).toHaveLength(24)
  })

  it('贴角的棋子只产生界内候选点', () => {
    const board = boardFromLines(['B..............'])

    // 角上半径 2 的邻域是 3×3 共 9 格，扣掉棋子本身。
    expect(candidateMoves(board)).toHaveLength(8)
  })

  it('候选点不重复', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BBBB......',
    ])
    const points = candidateMoves(board)
    const keys = new Set(points.map((p) => `${p.x},${p.y}`))

    expect(keys.size).toBe(points.length)
  })

  it('满盘时没有候选点', () => {
    const board = createBoard()
    board.fill(1)

    expect(candidateMoves(board)).toEqual([])
  })

  it('可以指定更小的搜索半径', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
    ])

    expect(candidateMoves(board, 1)).toHaveLength(8)
  })
})
