import { describe, expect, it } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK, WHITE } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import { evaluateBoard, SHAPE_VALUES, WIN_SCORE } from './evaluate'

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

  it('隔子四 BB_BB 被认成冲四，与直四同分', () => {
    // 两者都只有「一个成五点」，分值必须一致。旧实现把隔子四只当成
    // 两个活二（1200 分），与冲四的 15000 分差了一个数量级。
    const gapped = boardFromLines(['...............', '...............', '...BB.BB.......'])
    const straight = boardFromLines(['...............', '...............', '..WBBBB........'])

    expect(evaluateBoard(gapped, BLACK)).toBe(SHAPE_VALUES.four)
    expect(evaluateBoard(gapped, BLACK)).toBe(evaluateBoard(straight, BLACK))
  })

  it('.mm.mm. 是冲四而不是活四', () => {
    // 成五点只有中间那一个（x=5）：补上它才成五，补两端都凑不出五连
    const gappedFour = boardFromLines(['...............', '...............', '...BB.BB.......'])
    const openFour = boardFromLines(['...............', '...............', '...BBBB........'])

    expect(evaluateBoard(gappedFour, BLACK)).toBeLessThan(evaluateBoard(openFour, BLACK))
  })

  it('活四只计一次，不因滑窗重复累加', () => {
    // x = 3,4,5,6 两端都空：包含它的两个 5 窗口各产出一个成五点。
    // 若按窗口累加，这里会得到两倍活四的分。
    const openFour = boardFromLines(['...............', '...............', '...BBBB........'])

    expect(evaluateBoard(openFour, BLACK)).toBe(SHAPE_VALUES.openFour)
  })

  it('冲四与活三同样只计一次', () => {
    const four = boardFromLines(['...............', '...............', '..WBBBB........'])
    const openThree = boardFromLines(['...............', '...............', '...BBB.........'])
    const sleepingThree = boardFromLines(['...............', '...............', '..WBBB.........'])

    expect(evaluateBoard(four, BLACK)).toBe(SHAPE_VALUES.four)
    expect(evaluateBoard(openThree, BLACK)).toBe(SHAPE_VALUES.openThree)
    expect(evaluateBoard(sleepingThree, BLACK)).toBe(SHAPE_VALUES.three)
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
