import { describe, expect, it } from 'vitest'
import { createBoard, DIRECTIONS } from '../core/board'
import { findWinLine } from '../core/rules'
import { BLACK, CELL_COUNT, WHITE, type Board, type Point, type Player } from '../core/types'
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
  type FastThreat,
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

/**
 * `analyzeFast` 内部走的是「直接扫窗口」的版本，`analyzeDirection` 走的是
 * 「先建 9 格数组再扫」的版本。两段窗口逻辑重复，所以这里用随机棋盘把
 * 直扫版的四个聚合字段与数组版逐项对齐——不是抽样比对，是逐局面全等。
 */
function referenceFast(board: Board, point: Point, player: Player): FastThreat {
  let five = false
  let maxWinningInOneDirection = 0
  const winningPoints: Point[] = []

  for (const dir of DIRECTIONS) {
    const threat = analyzeDirection(board, point, player, dir)
    if (threat.kind === 'five') {
      five = true
      break
    }
    if (threat.winningPoints.length > maxWinningInOneDirection) {
      maxWinningInOneDirection = threat.winningPoints.length
    }
    for (const q of threat.winningPoints) {
      if (!winningPoints.some((p) => p.x === q.x && p.y === q.y)) winningPoints.push(q)
    }
  }

  if (five) return { five: true, openFour: false, four: false, winningPoints: [] }

  const openFour = maxWinningInOneDirection >= 2
  return {
    five: false,
    openFour,
    four: !openFour && winningPoints.length > 0,
    winningPoints,
  }
}

/** 可复现的伪随机数（mulberry32）。差分测试必须能在失败时按种子重放。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('analyzeFast 与数组版（analyzeDirection）随机差分', () => {
  it('20 个种子 × 60 手随机棋局上逐项一致', () => {
    const SEEDS = 20
    const MOVES = 60

    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = mulberry32(seed)
      const board = createBoard()
      const empty = Array.from({ length: CELL_COUNT }, (_, i) => i)

      for (let move = 0; move < MOVES; move++) {
        const pick = Math.floor(random() * empty.length)
        const cell = empty[pick]
        empty[pick] = empty[empty.length - 1]
        empty.pop()
        board[cell] = random() < 0.5 ? BLACK : WHITE

        // 每个局面问三个点、黑白两方——包含**已有棋子**的点，
        // 那正是「落点无条件当己方」这条前置行为要覆盖的分支。
        for (let probe = 0; probe < 3; probe++) {
          const at = Math.floor(random() * CELL_COUNT)
          const point = { x: at % 15, y: Math.floor(at / 15) }

          for (const player of [BLACK, WHITE]) {
            expect(
              analyzeFast(board, point, player),
              `种子 ${seed} 第 ${move + 1} 手，点 (${point.x},${point.y})，'${player === BLACK ? '黑' : '白'}'`,
            ).toEqual(referenceFast(board, point, player))
          }
        }
      }
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


describe('前置条件：只对空点调用', () => {

  /**
   * `buildLine` 无条件把落点那一格当成「己方已落下」（`line[CENTER] = player`）——
   * 那正是 `analyzeFast` 的用途（问「我下这里会怎样」）。代价是：**对一颗已有棋子
   * 的点调用，它会给出一个看起来合理、实际上毫无意义的答案**，不抛错也不返回空。
   *
   * 这一条把那个行为钉住，不是为了保护它，而是为了让将来任何改动都变成**刻意决定**。
   * 当前全部生产调用点都只传空点（取点来源只有 `candidateMoves` 与 `threat.ts` 的显式守卫）。
   */
  it('对一颗**对方**的棋子调用时，会假装它是空的并据此作答', () => {
    // 第 7 行：x=4 是白子，x=5..8 是黑子。黑棋在这条线上已经有五连了吗？没有——
    // 白子把左边堵死了，黑棋只有四颗。
    const board = rowBoard('....WBBBB......')

    expect(findWinLine(board, { x: 8, y: 7 })).toBeNull() // 黑棋并没有赢

    // 但若问「黑棋下在 (4,7) 会怎样」——那里明明是白子——它会回答「成五」，
    // 因为落点被强行当成了黑子，于是 x=4..8 凑成五连。
    const threat = analyzeFast(board, { x: 4, y: 7 }, BLACK)
    expect(threat.five).toBe(true)

    // 同一件事换个写法也成立：isWinningPoint 同样只回答「假如这里是空的」。
    expect(isWinningPoint(board, { x: 4, y: 7 }, BLACK)).toBe(true)

    // 对**空点**问同样的问题，答案才是真话：
    // x=5..8 是四颗黑子，左端被白子堵死，所以唯一的成五点是 (9,7)。
    expect(isWinningPoint(board, { x: 9, y: 7 }, BLACK)).toBe(true)
    expect(isWinningPoint(board, { x: 10, y: 7 }, BLACK)).toBe(false)

    // 三个点里只有 (4,7) 那一格是**对方**的棋子，而只有它被答成了「成五」。
    expect(board[7 * 15 + 4]).toBe(WHITE)
  })
})
