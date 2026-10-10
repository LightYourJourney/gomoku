import { describe, expect, it } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK, WHITE } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import { evaluateBoard, WIN_SCORE } from './evaluate'

describe('evaluateBoard', () => {
  it('空盘双方都是 0', () => {
    expect(evaluateBoard(createBoard(), BLACK)).toBe(0)
    expect(evaluateBoard(createBoard(), WHITE)).toBe(0)
  })

  it('成五得到最高分值', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...BBBBB.......',
    ])

    expect(evaluateBoard(board, BLACK)).toBeGreaterThanOrEqual(WIN_SCORE)
  })

  it('活四高于被堵住一端的冲四', () => {
    const openFour = boardFromLines([
      '...............',
      '...............',
      '...BBBB........',
    ])
    const blockedFour = boardFromLines([
      '...............',
      '...............',
      '..WBBBB........',
    ])

    expect(evaluateBoard(openFour, BLACK)).toBeGreaterThan(evaluateBoard(blockedFour, BLACK))
  })

  it('活三高于被堵住一端的眠三', () => {
    const openThree = boardFromLines([
      '...............',
      '...............',
      '...BBB.........',
    ])
    const blockedThree = boardFromLines([
      '...............',
      '...............',
      '..WBBB.........',
    ])

    expect(evaluateBoard(openThree, BLACK)).toBeGreaterThan(evaluateBoard(blockedThree, BLACK))
  })

  it('两端都被堵死的连子不计分', () => {
    const dead = boardFromLines([
      '...............',
      '...............',
      '..WBBBW........',
    ])

    expect(evaluateBoard(dead, BLACK)).toBe(0)
  })

  it('黑白互换后分值相等', () => {
    const blackBoard = boardFromLines([
      '...............',
      '...............',
      '...BBB.........',
      '...............',
      '...............',
      '.....WW........',
    ])
    const whiteBoard = boardFromLines([
      '...............',
      '...............',
      '...WWW.........',
      '...............',
      '...............',
      '.....BB........',
    ])

    expect(evaluateBoard(blackBoard, BLACK)).toBe(evaluateBoard(whiteBoard, WHITE))
  })

  it('我方占优时对我方的分值为正，对对方为负', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...BBB.........',
    ])

    expect(evaluateBoard(board, BLACK)).toBeGreaterThan(0)
    expect(evaluateBoard(board, WHITE)).toBeLessThan(0)
  })

  it('对角线上的活三与横向活三同分', () => {
    const horizontal = boardFromLines(['...............', '...BBB.........'])
    const diagonal = boardFromLines([
      '...............',
      '...B...........',
      '....B..........',
      '.....B.........',
    ])

    expect(evaluateBoard(diagonal, BLACK)).toBe(evaluateBoard(horizontal, BLACK))
  })
})
