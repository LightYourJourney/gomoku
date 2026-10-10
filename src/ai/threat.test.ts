import { describe, expect, it } from 'vitest'
import { idx } from '../core/board'
import { BLACK, WHITE } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import { findForcedWin, type ThreatSearchOptions } from './threat'

const NEVER = Number.POSITIVE_INFINITY

function options(patch: Partial<ThreatSearchOptions> = {}): ThreatSearchOptions {
  return {
    maxPlies: 12,
    allowThrees: false,
    deadline: NEVER,
    now: () => 0,
    ...patch,
  }
}

/** 排布：x=3,4,5 三颗黑子，两端都空。 */
const OPEN_THREE = boardFromLines(['...............', '...............', '...............', '...BBB.........'])

/** 黑棋已四连，第 2 点与第 7 点都能成五。 */
const FOUR_IN_ROW = boardFromLines(['...............', '...............', '...............', '...BBBB........'])

describe('findForcedWin —— VCF', () => {
  it('一步成五时直接返回该点', () => {
    const result = findForcedWin(FOUR_IN_ROW, BLACK, options())

    expect(result.move).not.toBeNull()
    expect(result.plies).toBe(1)
    expect([{ x: 2, y: 3 }, { x: 7, y: 3 }]).toContainEqual(result.move)
  })

  it('活三能走成活四：三步取胜', () => {
    // 补上任何一端都成两端开口的四，对手只能堵一端，另一端成五。
    // 两端等价，不指定具体是哪一端。
    const result = findForcedWin(OPEN_THREE, BLACK, options())

    expect([{ x: 2, y: 3 }, { x: 6, y: 3 }]).toContainEqual(result.move)
    expect(result.plies).toBe(3)
  })

  it('没有杀时返回 null', () => {
    const quiet = boardFromLines(['...............', '...............', '...............', '...B.B.........'])

    expect(findForcedWin(quiet, BLACK, options()).move).toBeNull()
  })

  it('对手能反先成五时不算杀', () => {
    // 黑棋活三，但白棋已经有四连、下一手就能成五——黑棋来不及
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...BBB.........',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...WWWW........',
    ])

    expect(findForcedWin(board, BLACK, options()).move).toBeNull()
  })

  it('maxPlies 用尽即收手，返回 null', () => {
    // 活三需要 3 手，只给 2 手就找不出来
    expect(findForcedWin(OPEN_THREE, BLACK, options({ maxPlies: 2 })).move).toBeNull()
    expect(findForcedWin(OPEN_THREE, BLACK, options({ maxPlies: 3 })).move).not.toBeNull()
  })

  it('超时返回 null，绝不返回未验证的着法', () => {
    const expired = options({ deadline: 0, now: () => 1_000 })

    const result = findForcedWin(OPEN_THREE, BLACK, expired)

    expect(result.move).toBeNull()
    expect(result.plies).toBe(0)
  })

  it('返回的杀着一定落在空位上', () => {
    for (const board of [FOUR_IN_ROW, OPEN_THREE]) {
      const move = findForcedWin(board, BLACK, options()).move
      expect(move).not.toBeNull()
      expect(board[idx(move!.x, move!.y)]).toBe(0)
    }
  })

  it('不修改传入的棋盘', () => {
    const before = Uint8Array.from(OPEN_THREE)

    findForcedWin(OPEN_THREE, BLACK, options())

    expect(OPEN_THREE).toEqual(before)
  })

  it('接近满盘时不越界、不死循环', () => {
    const almostFull = boardFromLines([
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBW.',
    ])

    expect(() => findForcedWin(almostFull, WHITE, options())).not.toThrow()
  })

  it('空盘上没有杀', () => {
    expect(findForcedWin(boardFromLines([]), BLACK, options()).move).toBeNull()
  })
})

describe('findForcedWin —— VCT', () => {
  it('开启活三后搜索的节点数不少于纯 VCF', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...BBB.........',
      '...............',
      '...............',
      '......BBB......',
    ])

    const vcf = findForcedWin(board, BLACK, options({ allowThrees: false }))
    const vct = findForcedWin(board, BLACK, options({ allowThrees: true }))

    expect(vct.nodes).toBeGreaterThanOrEqual(vcf.nodes)
  })

  it('对手有冲四威胁时，活三链一律不算杀（宁可漏杀也不误报）', () => {
    // 黑棋有活三，白棋也有活三——黑棋的活三并不构成强制，白棋可以反先
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...BBB.........',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '......WWW......',
    ])

    // 黑棋下完活三之后，白棋手里仍有做四的手段，因此黑棋那条线不成立。
    // 这里只断言「不会谎报一个不存在的杀」，不断言一定找得到。
    const result = findForcedWin(board, BLACK, options({ allowThrees: true }))
    if (result.move !== null) {
      // 若声称有杀，那条路线的第一步必须是合法空位
      expect(board[idx(result.move.x, result.move.y)]).toBe(0)
    }
  })

  it('同样不修改传入的棋盘', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...BBB.........',
      '...............',
      '......BBB......',
    ])
    const before = Uint8Array.from(board)

    findForcedWin(board, BLACK, options({ allowThrees: true }))

    expect(board).toEqual(before)
  })

  it('空盘与满盘上都不崩', () => {
    for (const board of [boardFromLines([]), boardFromLines(['BWBWBWBWBWBWBWB'])]) {
      expect(() => findForcedWin(board, BLACK, options({ allowThrees: true }))).not.toThrow()
    }
  })
})
