import { describe, expect, it } from 'vitest'
import { idx } from '../core/board'
import { BLACK, WHITE } from '../core/types'
import { boardFromLines, nearlyFullBoard } from '../test/board-fixtures'
import { findForcedWin, isForcedWinStart, type ThreatSearchOptions } from './threat'

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
    const almostFull = nearlyFullBoard()

    expect(() => findForcedWin(almostFull, WHITE, options())).not.toThrow()
  })

  it('空盘上没有杀', () => {
    expect(findForcedWin(boardFromLines([]), BLACK, options()).move).toBeNull()
  })
})

describe('findForcedWin —— VCT', () => {
  it('开启活三后搜索量显著上升，证明这个开关真的在起作用', () => {
    // 用严格大于而不是「不少于」：`allowThrees` 一旦彻底失效，两个数会相等，
    // `>=` 照样通过——那就成了一条永远绿的死断言。
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

    expect(vct.nodes).toBeGreaterThan(vcf.nodes)
  })

  it('白棋能反先成五时，开不开活三都一律不算杀', () => {
    // 黑棋活三看似能做杀，但白棋已经四连、下一手就成五，黑棋来不及。
    //
    // 这条用例原先用的是「黑活三 + 白活三」的局面，并配了一个
    // `if (move !== null)` 的守卫——结果引擎在那个局面**确实**找得到杀
    // （补一端成活四，白棋来不及反先），守卫把这件事整个盖住了：
    // 用例名说的是「有反先威胁」，局面演示的却是「没有反先威胁」。
    // 换成真正被反先的局面，并把 null 断言写死。
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

    for (const allowThrees of [false, true]) {
      const result = findForcedWin(board, BLACK, options({ allowThrees }))

      expect(result.move).toBeNull()
      expect(result.plies).toBe(0)
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

describe('isForcedWinStart —— 某一手是不是取胜链的第一步', () => {
  /**
   * 黑棋 (4,7)(5,7)(6,7)，白棋堵住右端。
   *
   * 补左端 (3,7) 做出**活四**（成五点 (2,7) 与 (7,7) 两端开口）→ 三步取胜；
   * 补右端 (7,7) 只是**冲四**（只剩 (3,7) 一个成五点）→ 白棋堵掉就没了。
   */
  const ONE_END_BLOCKED = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '....BBB.W......',
  ])

  it('给出真正做得出活四的那一手时为真', () => {
    expect(isForcedWinStart(ONE_END_BLOCKED, BLACK, { x: 3, y: 7 }, options({ maxPlies: 5 }))).toBe(true)
  })

  it('做出一个冲四、对手堵掉就没事了，为假', () => {
    // 这条是「走子后再调 findForcedWin」那个错法的照妖镜：那种写法把盘面交给
    // 一个「假定轮到攻方走」的函数，而玩家落子之后轮到的是对手，等于白送一手。
    // 实测白棋在 (3,7) 堵掉之后，黑棋 9 手内都没有杀。
    expect(isForcedWinStart(ONE_END_BLOCKED, BLACK, { x: 7, y: 7 }, options({ maxPlies: 9 }))).toBe(false)
  })

  it('已成四时两端都算取胜链的第一步', () => {
    const four = boardFromLines(['...............', '...............', '...............', '...BBBB........'])

    expect(isForcedWinStart(four, BLACK, { x: 2, y: 3 }, options())).toBe(true)
    expect(isForcedWinStart(four, BLACK, { x: 7, y: 3 }, options())).toBe(true)
  })

  it('和取胜无关的普通着法为假', () => {
    expect(isForcedWinStart(ONE_END_BLOCKED, BLACK, { x: 0, y: 0 }, options())).toBe(false)
  })

  it('落在已占用的点上为假', () => {
    expect(isForcedWinStart(ONE_END_BLOCKED, BLACK, { x: 4, y: 7 }, options())).toBe(false)
  })

  it('maxPlies 不够时为假', () => {
    // 活三成活四要 3 手，只给 2 手就找不出来
    const three = boardFromLines(['...............', '...............', '...............', '...BBB.........'])

    expect(isForcedWinStart(three, BLACK, { x: 2, y: 3 }, options({ maxPlies: 2 }))).toBe(false)
    expect(isForcedWinStart(three, BLACK, { x: 2, y: 3 }, options({ maxPlies: 3 }))).toBe(true)
  })

  it('不改传入的棋盘', () => {
    const before = Uint8Array.from(ONE_END_BLOCKED)

    isForcedWinStart(ONE_END_BLOCKED, BLACK, { x: 3, y: 7 }, options())

    expect(ONE_END_BLOCKED).toEqual(before)
  })
})
