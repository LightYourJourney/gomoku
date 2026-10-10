import { describe, expect, it } from 'vitest'
import { createBoard, DIRECTIONS } from '../core/board'
import { BLACK, WHITE, type Board, type Point } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import {
  analyzeDirection,
  analyzeFast,
  analyzePoint,
  doubleThreat,
  hasDoubleThreat,
  isWinningPoint,
  shapeScore,
  threatAt,
  type ShapeCount,
} from './patterns'

const HORIZONTAL = DIRECTIONS[0]
const VERTICAL = DIRECTIONS[1]

/**
 * 把一行字符画放到第 7 行（y = 7）。'B' = 黑，'W' = 白，'.' = 空。
 * 长度必须正好 15——写错一个点，下面所有 x 坐标的注释都会失效。
 */
function rowBoard(line: string): Board {
  if (line.length !== 15) {
    throw new Error(`测试数据必须正好 15 列，实际 ${line.length} 列：${line}`)
  }
  return boardFromLines([...Array.from({ length: 7 }, () => ''), line])
}

/** 造一个只有一色棋子的棋型计数，方便断言。 */
function counts(patch: Partial<ShapeCount>): ShapeCount {
  return {
    five: 0,
    openFour: 0,
    four: 0,
    openThree: 0,
    three: 0,
    openTwo: 0,
    two: 0,
    ...patch,
  }
}

describe('analyzeDirection —— 成五与四', () => {
  it('连续四子补上第五子判成五', () => {
    // x = 4,5,6,7 是黑子，分析第 8 点
    const board = rowBoard('....BBBB.......')

    expect(analyzeDirection(board, { x: 8, y: 7 }, BLACK, HORIZONTAL).kind).toBe('five')
  })

  it('.mmmm. 是活四，两端各有一个成五点', () => {
    // x = 5,6,7 是黑子，分析第 8 点 → 4..8 形成 B B B B，两端 x=4 与 x=9 都空
    const board = rowBoard('.....BBB.......')

    const threat = analyzeDirection(board, { x: 8, y: 7 }, BLACK, HORIZONTAL)

    expect(threat.kind).toBe('openFour')
    expect(threat.winningPoints).toHaveLength(2)
    expect(threat.winningPoints).toEqual(
      expect.arrayContaining([
        { x: 4, y: 7 },
        { x: 9, y: 7 },
      ]),
    )
  })

  it('mmmm. 是冲四，只有一个成五点', () => {
    // x=3 白子堵住左边，x = 4,5,6 黑子，分析第 7 点
    const board = rowBoard('...WBBB........')

    const threat = analyzeDirection(board, { x: 7, y: 7 }, BLACK, HORIZONTAL)

    expect(threat.kind).toBe('four')
    expect(threat.winningPoints).toEqual([{ x: 8, y: 7 }])
  })

  it('mm.mm 是冲四，成五点是中间的空位', () => {
    // x = 3,4 与 6,7 是黑子，中间 x=5 空，分析第 7 点
    const board = rowBoard('...BB.BB.......')

    const threat = analyzeDirection(board, { x: 7, y: 7 }, BLACK, HORIZONTAL)

    expect(threat.kind).toBe('four')
    expect(threat.winningPoints).toEqual([{ x: 5, y: 7 }])
  })

  it('m.mmm 是冲四', () => {
    // x=3 黑，x=4 空，x = 5,6,7 黑，分析第 3 点
    const board = rowBoard('...B.BBB.......')

    const threat = analyzeDirection(board, { x: 3, y: 7 }, BLACK, HORIZONTAL)

    expect(threat.kind).toBe('four')
    expect(threat.winningPoints).toEqual([{ x: 4, y: 7 }])
  })

  it('mmm.m 是冲四', () => {
    // x = 3,4,5 黑，x=6 空，x=7 黑，分析第 7 点
    const board = rowBoard('...BBB.B.......')

    const threat = analyzeDirection(board, { x: 7, y: 7 }, BLACK, HORIZONTAL)

    expect(threat.kind).toBe('four')
    expect(threat.winningPoints).toEqual([{ x: 6, y: 7 }])
  })

  it('贴边的 mmmm. 仍是冲四而不是活四', () => {
    // x = 0,1,2,3 黑，左端是棋盘外面——外面放不下棋子，不算开口
    const board = rowBoard('BBBB...........')

    const threat = analyzeDirection(board, { x: 3, y: 7 }, BLACK, HORIZONTAL)

    expect(threat.kind).toBe('four')
    expect(threat.winningPoints).toEqual([{ x: 4, y: 7 }])
  })

  it('被对手堵死的四子什么都不是', () => {
    // x = 0,1,2,3 黑，x=4 白
    const board = rowBoard('BBBBW..........')

    expect(analyzeDirection(board, { x: 3, y: 7 }, BLACK, HORIZONTAL).kind).toBe('none')
  })

  it('白棋用同一套判定', () => {
    const board = rowBoard('.....WWW.......')

    expect(analyzeDirection(board, { x: 8, y: 7 }, WHITE, HORIZONTAL).kind).toBe('openFour')
  })
})

describe('analyzeDirection —— 三', () => {
  it('.mmm. 是活三：存在能做成活四的点', () => {
    // x = 5,6,7 黑，分析第 7 点；在第 4 点补一子即成为两端开口的四
    const board = rowBoard('.....BBB.......')

    const threat = analyzeDirection(board, { x: 7, y: 7 }, BLACK, HORIZONTAL)

    expect(threat.kind).toBe('openThree')
    expect(threat.winningPoints).toEqual([])
  })

  it('.mm.m. 是活三', () => {
    // x = 4,5 与 7 黑，x=6 空，分析第 7 点；补第 6 点成为活四
    const board = rowBoard('....BB.B.......')

    expect(analyzeDirection(board, { x: 7, y: 7 }, BLACK, HORIZONTAL).kind).toBe('openThree')
  })

  it('.m.mm. 是活三', () => {
    // x = 4 与 6,7 黑，x=5 空，分析第 7 点；补第 5 点成为活四
    const board = rowBoard('....B.BB.......')

    expect(analyzeDirection(board, { x: 7, y: 7 }, BLACK, HORIZONTAL).kind).toBe('openThree')
  })

  it('ommm. 是眠三：只能做成冲四', () => {
    // x=3 白，x = 4,5,6 黑，分析第 6 点
    const board = rowBoard('...WBBB........')

    expect(analyzeDirection(board, { x: 6, y: 7 }, BLACK, HORIZONTAL).kind).toBe('three')
  })

  it('.mm.mo 是眠三', () => {
    // x = 4,5 黑，x=6 空，x=7 黑，x=8 白，分析第 7 点
    const board = rowBoard('....BB.BW......')

    expect(analyzeDirection(board, { x: 7, y: 7 }, BLACK, HORIZONTAL).kind).toBe('three')
  })

  it('两子连不成三', () => {
    const board = rowBoard('.....BB........')

    expect(analyzeDirection(board, { x: 6, y: 7 }, BLACK, HORIZONTAL).kind).toBe('none')
  })

  it('纵向与横向判定一致', () => {
    // 第 7 列从 y=5 到 y=7 放三颗黑子
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
      '.......B.......',
      '.......B.......',
    ])

    expect(analyzeDirection(board, { x: 7, y: 7 }, BLACK, VERTICAL).kind).toBe('openThree')
  })
})

describe('analyzeFast —— 搜索热路径用的廉价档', () => {
  it('识别成五', () => {
    const board = rowBoard('....BBBB.......')

    expect(analyzeFast(board, { x: 8, y: 7 }, BLACK).five).toBe(true)
  })

  it('识别活四与冲四', () => {
    expect(analyzeFast(rowBoard('.....BBB.......'), { x: 8, y: 7 }, BLACK).openFour).toBe(true)
    expect(analyzeFast(rowBoard('...WBBB........'), { x: 7, y: 7 }, BLACK).four).toBe(true)
  })

  it('给出成五点，供强制链使用', () => {
    const threat = analyzeFast(rowBoard('...BB.BB.......'), { x: 7, y: 7 }, BLACK)

    expect(threat.winningPoints).toEqual([{ x: 5, y: 7 }])
  })

  it('不判三——三的精确判定不进搜索热路径', () => {
    const threat = analyzeFast(rowBoard('.....BBB.......'), { x: 7, y: 7 }, BLACK)

    expect(threat.five).toBe(false)
    expect(threat.openFour).toBe(false)
    expect(threat.four).toBe(false)
  })

  it('与 analyzeDirection 在五与四上结论一致', () => {
    const cases: ReadonlyArray<[string, Point]> = [
      ['....BBBB.......', { x: 8, y: 7 }],
      ['.....BBB.......', { x: 8, y: 7 }],
      ['...WBBB........', { x: 7, y: 7 }],
      ['...BB.BB.......', { x: 7, y: 7 }],
      ['BBBBW..........', { x: 3, y: 7 }],
    ]

    for (const [line, point] of cases) {
      const board = rowBoard(line)
      const fast = analyzeFast(board, point, BLACK)
      const full = analyzeDirection(board, point, BLACK, HORIZONTAL)

      expect(fast.five).toBe(full.kind === 'five')
      expect(fast.openFour).toBe(full.kind === 'openFour')
      expect(fast.four).toBe(full.kind === 'four')
      expect(fast.winningPoints).toEqual(full.winningPoints)
    }
  })
})

describe('analyzePoint —— 四方向汇总', () => {
  it('两个方向各有冲四时分别计入', () => {
    // 横向 (3,6)(4,6)(5,6) 黑、左端 (2,6) 白；
    // 纵向 (6,3)(6,4)(6,5) 黑、上端 (6,2) 白。两者在第 6 点交汇。
    const board = boardFromLines([
      '...............',
      '...............',
      '......W........',
      '......B........',
      '......B........',
      '......B........',
      '..WBBB.........',
    ])

    const result = analyzePoint(board, { x: 6, y: 6 }, BLACK)

    expect(result.five).toBe(0)
    expect(result.four + result.openFour).toBeGreaterThanOrEqual(2)
  })

  it('成五时只计 five，不再计更低级的棋型', () => {
    const board = rowBoard('....BBBB.......')

    const result = analyzePoint(board, { x: 8, y: 7 }, BLACK)

    expect(result.five).toBe(1)
    expect(result.openFour).toBe(0)
    expect(result.four).toBe(0)
  })

  it('空盘上任意点都是空计数', () => {
    const board = boardFromLines([])

    expect(analyzePoint(board, { x: 7, y: 7 }, BLACK)).toEqual(counts({}))
  })

  it('四角不越界也不死循环', () => {
    const board = boardFromLines(['B..............'])

    for (const point of [
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 0, y: 14 },
      { x: 14, y: 14 },
    ]) {
      expect(() => analyzePoint(board, point, BLACK)).not.toThrow()
      expect(() => analyzeFast(board, point, BLACK)).not.toThrow()
    }
  })

  it('接近满盘时四角与中心都不崩', () => {
    const board = boardFromLines([
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
      'BWBWBWBWBWBWBWB',
    ])

    expect(() => analyzePoint(board, { x: 7, y: 7 }, BLACK)).not.toThrow()
    expect(() => analyzeFast(board, { x: 0, y: 14 }, WHITE)).not.toThrow()
  })
})

describe('shapeScore —— 棋型与双威胁', () => {
  it('活四 > 冲四 > 活三 > 眠三 > 活二', () => {
    const openFour = shapeScore(counts({ openFour: 1 }))
    const four = shapeScore(counts({ four: 1 }))
    const openThree = shapeScore(counts({ openThree: 1 }))
    const three = shapeScore(counts({ three: 1 }))
    const openTwo = shapeScore(counts({ openTwo: 1 }))

    expect(openFour).toBeGreaterThan(four)
    expect(four).toBeGreaterThan(openThree)
    expect(openThree).toBeGreaterThan(three)
    expect(three).toBeGreaterThan(openTwo)
  })

  it('成五的分值高于任何组合', () => {
    const five = shapeScore(counts({ five: 1 }))
    const everythingElse = shapeScore(
      counts({ openFour: 2, four: 2, openThree: 2, three: 2, openTwo: 2, two: 2 }),
    )

    expect(five).toBeGreaterThan(everythingElse)
  })

  it('双冲四高于单冲四加活三', () => {
    expect(shapeScore(counts({ four: 2 }))).toBeGreaterThan(shapeScore(counts({ four: 1, openThree: 1 })))
  })

  it('四三组合高于单活三', () => {
    expect(shapeScore(counts({ four: 1, openThree: 1 }))).toBeGreaterThan(
      shapeScore(counts({ openThree: 1 })),
    )
  })

  it('双活三高于单活三', () => {
    expect(shapeScore(counts({ openThree: 2 }))).toBeGreaterThan(shapeScore(counts({ openThree: 1 })))
  })

  it('单活三高于双活二', () => {
    expect(shapeScore(counts({ openThree: 1 }))).toBeGreaterThan(shapeScore(counts({ openTwo: 2 })))
  })

  it('空计数为 0', () => {
    expect(shapeScore(counts({}))).toBe(0)
  })
})

describe('isWinningPoint / threatAt', () => {
  it('补上第五子才算成五点', () => {
    // x = 4,5,6,7 是黑子：第 8 点与第 3 点都能补成五连，第 2 点不行（中间隔着第 3 点）
    const board = rowBoard('....BBBB.......')

    expect(isWinningPoint(board, { x: 8, y: 7 }, BLACK)).toBe(true)
    expect(isWinningPoint(board, { x: 3, y: 7 }, BLACK)).toBe(true)
    expect(isWinningPoint(board, { x: 2, y: 7 }, BLACK)).toBe(false)
  })

  it('对手的成五点不算我的成五点', () => {
    const board = rowBoard('....BBBB.......')

    expect(isWinningPoint(board, { x: 8, y: 7 }, WHITE)).toBe(false)
  })

  it('threatAt 在成五点上取到最高分', () => {
    const board = rowBoard('....BBBB.......')

    expect(threatAt(board, { x: 8, y: 7 }, BLACK)).toBe(shapeScore(counts({ five: 1 })))
  })
})

describe('doubleThreat —— 双重威胁谓词', () => {
  /**
   * 四个夹具都以 (7,7) 为落点，那个点必须是空的。
   *
   * `analyzePoint` 的语义是**假定落子方已经落在 point 上**再分析，
   * 所以直接拿它去分析一个已经有子的点会得到无意义的结果。
   *
   * 实测（改夹具后必须重跑）：
   *   DOUBLE_FOUR  openFour=0 four=2 openThree=0
   *   FOUR_THREE   openFour=0 four=1 openThree=1
   *   DOUBLE_THREE openFour=0 four=0 openThree=2
   *   SINGLE_FOUR  openFour=0 four=1 openThree=0
   */
  const DOUBLE_FOUR = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '.......B.......',
    '.......B.......',
    '.......B.......',
    '....BBB.W......',
    '.......W.......',
  ])

  const FOUR_THREE = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '.......B.......',
    '.......B.......',
    '...............',
    '....BBB.W......',
  ])

  const DOUBLE_THREE = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '.......B.......',
    '.......B.......',
    '...............',
    '....BB.........',
  ])

  const SINGLE_FOUR = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '....BBB.W......',
  ])

  const AT = { x: 7, y: 7 }

  it('两个方向各一个冲四就是双四', () => {
    expect(doubleThreat(analyzePoint(DOUBLE_FOUR, AT, BLACK))).toEqual({
      doubleFour: true,
      fourThree: false,
      doubleThree: false,
    })
  })

  it('一个冲四配一个活三算四三', () => {
    expect(doubleThreat(analyzePoint(FOUR_THREE, AT, BLACK))).toEqual({
      doubleFour: false,
      fourThree: true,
      doubleThree: false,
    })
  })

  it('两个活三算双三', () => {
    expect(doubleThreat(analyzePoint(DOUBLE_THREE, AT, BLACK))).toEqual({
      doubleFour: false,
      fourThree: false,
      doubleThree: true,
    })
  })

  it('只有一个冲四时三条全为假', () => {
    expect(hasDoubleThreat(analyzePoint(SINGLE_FOUR, AT, BLACK))).toBe(false)
  })

  it('活四本身就是两端开口的四，不是双重威胁', () => {
    // 活四已经必胜，但它只出现在一个方向上——判成「双四」会让
    // 「构造活四」和「构造双四」两类题混为一谈。
    const openFour = boardFromLines(['...............', '...............', '...............', '....BBB........'])

    expect(doubleThreat(analyzePoint(openFour, AT, BLACK)).doubleFour).toBe(false)
    expect(hasDoubleThreat(analyzePoint(openFour, AT, BLACK))).toBe(false)
  })

  it('空盘上什么都不算', () => {
    expect(hasDoubleThreat(analyzePoint(createBoard(), AT, BLACK))).toBe(false)
  })
})
