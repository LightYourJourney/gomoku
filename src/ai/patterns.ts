import { DIRECTIONS, idx, inBounds, opponentOf } from '../core/board'
import { WIN_LENGTH, type Board, type Player, type Point } from '../core/types'
import { WIN_SCORE, type ThreatKind } from './types'

export type { ThreatKind }

export interface DirectionThreat {
  readonly kind: ThreatKind
  /** 该方向上全部能立刻成五的空点 */
  readonly winningPoints: readonly Point[]
}

/**
 * 搜索热路径专用的廉价档：只判成五与活四 / 冲四。
 *
 * 判「三」需要对该方向每个空位试放一子再重数成五点，单点约多出六百次读格；
 * 而 `moveOrderScore` 在每个节点都要对全部候选各算两次，一乘就是十万量级。
 * 所以三的精确判定只留给 `analyzePoint`（提示与威胁展示用），不进这里。
 */
export interface FastThreat {
  readonly five: boolean
  /** 同一方向上有两个及以上成五点——对手堵不住 */
  readonly openFour: boolean
  /** 有任何方向存在成五点 */
  readonly four: boolean
  /**
   * 全部能立刻成五的空点（跨方向去重）。
   *
   * 这是最权威的信号：长度 ≥2 就说明对手已经堵不住了，无论这来自一个活四
   * 还是两个方向各一个冲四（双四）。`openFour` / `four` 只是方便读的标签。
   */
  readonly winningPoints: readonly Point[]
}

/** 某一手在四个方向上分别形成的棋型计数。 */
export interface ShapeCount {
  five: number
  openFour: number
  four: number
  openThree: number
  three: number
  openTwo: number
  two: number
}

const SHAPE_VALUE = {
  openFour: 120_000,
  four: 14_000,
  openThree: 10_000,
  three: 700,
  openTwo: 500,
  two: 80,
} as const

/** 以落点为中心、沿某个方向取多长的窗口。两端各 4 格足够覆盖任何五连。 */
const WINDOW_RADIUS = 4
const WINDOW_SIZE = WINDOW_RADIUS * 2 + 1
/** 窗口里第几格是落点本身。 */
const CENTER = WINDOW_RADIUS

/** 窗口内的格子：1 = 己方，0 = 空，-1 = 被堵（对手子或棋盘外面）。 */
type Line = Int8Array

function createShapeCount(): ShapeCount {
  return { five: 0, openFour: 0, four: 0, openThree: 0, three: 0, openTwo: 0, two: 0 }
}

/**
 * 沿 `dir` 取以 `point` 为中心的一行，并**假定 `player` 已经落在 `point` 上**。
 *
 * 棋盘外面记为「被堵」而不是「空」——外面放不下棋子，对一条连线来说那和
 * 对手挡着是一回事。这个区别正是「贴边的 mmmm. 是冲四而不是活四」的由来。
 */
function buildLine(board: Board, point: Point, player: Player, dir: Point): Line {
  const line = new Int8Array(WINDOW_SIZE)

  for (let i = 0; i < WINDOW_SIZE; i++) {
    const step = i - CENTER
    const x = point.x + dir.x * step
    const y = point.y + dir.y * step

    if (!inBounds(x, y)) {
      line[i] = -1
      continue
    }

    const cell = board[idx(x, y)]
    line[i] = cell === 0 ? 0 : cell === player ? 1 : -1
  }

  line[CENTER] = 1
  return line
}

interface LineScan {
  readonly five: boolean
  /** 能让这一行凑成五连的空格下标（已去重） */
  readonly winningIndices: readonly number[]
}

/**
 * 枚举全部**包含落点**的五连窗口（共 5 个），统计成五点。
 *
 * 窗口里只要有对手子或棋盘外面就作废——那一段被堵死了。
 * 剩下「恰好 4 己方 + 1 空」的窗口，那个空格就是成五点。隔子型
 * （`mm.mm`）正是靠这个被识别出来的：它的空位就在窗口中间。
 */
function scanLine(line: Line): LineScan {
  const winningIndices: number[] = []

  for (let start = 0; start <= CENTER; start++) {
    let own = 0
    let emptyIndex = -1
    let blocked = false

    for (let i = start; i < start + WIN_LENGTH; i++) {
      const cell = line[i]
      if (cell === 1) {
        own++
      } else if (cell === 0) {
        // 一个窗口里出现两个空位就凑不成五连，直接作废。
        if (emptyIndex >= 0) {
          blocked = true
          break
        }
        emptyIndex = i
      } else {
        blocked = true
        break
      }
    }

    if (blocked) continue
    if (own === WIN_LENGTH) return { five: true, winningIndices: [] }
    if (own === WIN_LENGTH - 1 && !winningIndices.includes(emptyIndex)) {
      winningIndices.push(emptyIndex)
    }
  }

  return { five: false, winningIndices }
}

function indexToPoint(point: Point, dir: Point, index: number): Point {
  const step = index - CENTER
  return { x: point.x + dir.x * step, y: point.y + dir.y * step }
}

/**
 * 单方向棋型判定。
 *
 * 五与四用成五点计数：两个及以上成五点即活四（对手堵一个还剩一个），
 * 恰好一个即成五点即冲四。
 *
 * 三用「试放一子后重数」：能让该方向出现**两个**成五点的空位就是活三点
 * （补上它能做成活四），只能做出一个的是眠三点。这一步比前两步贵得多，
 * 所以只在 `analyzePoint` 这条路径上跑。
 */
export function analyzeDirection(
  board: Board,
  point: Point,
  player: Player,
  dir: Point,
): DirectionThreat {
  const line = buildLine(board, point, player, dir)
  const scan = scanLine(line)

  if (scan.five) return { kind: 'five', winningPoints: [] }

  const winningPoints = scan.winningIndices.map((index) => indexToPoint(point, dir, index))
  if (winningPoints.length >= 2) return { kind: 'openFour', winningPoints }
  if (winningPoints.length === 1) return { kind: 'four', winningPoints }

  let hasOpenThree = false
  let hasThree = false

  for (let i = 0; i < WINDOW_SIZE; i++) {
    if (line[i] !== 0) continue

    line[i] = 1
    const after = scanLine(line)
    line[i] = 0

    if (after.winningIndices.length >= 2) {
      hasOpenThree = true
      break
    }
    if (after.winningIndices.length === 1) {
      hasThree = true
    }
  }

  if (hasOpenThree) return { kind: 'openThree', winningPoints: [] }
  if (hasThree) return { kind: 'three', winningPoints: [] }
  return { kind: 'none', winningPoints: [] }
}

export function analyzeFast(board: Board, point: Point, player: Player): FastThreat {
  const winningPoints: Point[] = []
  let five = false
  let maxWinningInOneDirection = 0

  for (const dir of DIRECTIONS) {
    const line = buildLine(board, point, player, dir)
    const scan = scanLine(line)

    if (scan.five) {
      five = true
      break
    }

    if (scan.winningIndices.length > maxWinningInOneDirection) {
      maxWinningInOneDirection = scan.winningIndices.length
    }

    for (const index of scan.winningIndices) {
      const candidate = indexToPoint(point, dir, index)
      if (!winningPoints.some((q) => q.x === candidate.x && q.y === candidate.y)) {
        winningPoints.push(candidate)
      }
    }
  }

  if (five) {
    return { five: true, openFour: false, four: false, winningPoints: [] }
  }

  // openFour 与 four 互斥：活四本身就是一种四，两个都为真会让调用方
  // 在 switch 式的分支里把它算两次。
  const openFour = maxWinningInOneDirection >= 2

  return {
    five: false,
    openFour,
    four: !openFour && winningPoints.length > 0,
    winningPoints,
  }
}

/**
 * 便宜的连续口径：只数「连续同色 + 两端可延展」，**不判五与四**。
 *
 * 五与四已经由精确口径负责，这里重复计一遍会让同一个形状算两次分。
 * 三及以下仍然用它——排序只需要知道「这里有个活三」，不需要知道它是
 * 连续三还是跳三，为此付出精确判定的代价不划算。
 */
function analyzeRuns(board: Board, point: Point, player: Player): ShapeCount {
  const counts = createShapeCount()

  const isEmptyAt = (x: number, y: number): boolean => inBounds(x, y) && board[idx(x, y)] === 0
  const isOwn = (x: number, y: number): boolean =>
    inBounds(x, y) && board[idx(x, y)] === player

  for (const dir of DIRECTIONS) {
    let forward = 0
    while (isOwn(point.x + dir.x * (forward + 1), point.y + dir.y * (forward + 1))) forward++

    let backward = 0
    while (isOwn(point.x - dir.x * (backward + 1), point.y - dir.y * (backward + 1))) backward++

    const total = forward + backward + 1
    const openEnds =
      (isEmptyAt(point.x + dir.x * (forward + 1), point.y + dir.y * (forward + 1)) ? 1 : 0) +
      (isEmptyAt(point.x - dir.x * (backward + 1), point.y - dir.y * (backward + 1)) ? 1 : 0)

    if (total === 3) {
      if (openEnds === 2) counts.openThree++
      else if (openEnds === 1) counts.three++
    } else if (total === 2) {
      if (openEnds === 2) counts.openTwo++
      else if (openEnds === 1) counts.two++
    }
  }

  return counts
}

/**
 * 完整棋型计数，含隔子型的三。
 *
 * **只用于提示与威胁展示**，不要在搜索的每节点路径上调用它——
 * 判三要对每个方向逐空位试放，单点比 `analyzeFast` 贵数倍。
 */
export function analyzePoint(board: Board, point: Point, player: Player): ShapeCount {
  const counts = createShapeCount()

  for (const dir of DIRECTIONS) {
    switch (analyzeDirection(board, point, player, dir).kind) {
      case 'five':
        counts.five++
        break
      case 'openFour':
        counts.openFour++
        break
      case 'four':
        counts.four++
        break
      case 'openThree':
        counts.openThree++
        break
      case 'three':
        counts.three++
        break
      case 'none':
        break
    }
  }

  // 二沿用便宜口径：它只影响排序与展示的细节，不值得为它做窗口枚举。
  const runs = analyzeRuns(board, point, player)
  counts.openTwo = runs.openTwo
  counts.two = runs.two

  return counts
}

/** 把四个方向的棋型计数压成「最高的那一档」，供提示界面显示。 */
export function dominantThreat(counts: ShapeCount): ThreatKind {
  if (counts.five > 0) return 'five'
  if (counts.openFour > 0) return 'openFour'
  if (counts.four > 0) return 'four'
  if (counts.openThree > 0) return 'openThree'
  if (counts.three > 0) return 'three'
  return 'none'
}

/**
 * 把棋型计数折算成可直接比较的分值。
 *
 * 除逐方向累加外，还对「同时存在多个方向威胁」加成——双四、四三、双活三
 * 才是真正决定胜负的组合，单看某一个方向会严重低估它们。
 */
export function shapeScore(counts: ShapeCount): number {
  if (counts.five > 0) return WIN_SCORE

  let score =
    counts.openFour * SHAPE_VALUE.openFour +
    counts.four * SHAPE_VALUE.four +
    counts.openThree * SHAPE_VALUE.openThree +
    counts.three * SHAPE_VALUE.three +
    counts.openTwo * SHAPE_VALUE.openTwo +
    counts.two * SHAPE_VALUE.two

  const fours = counts.openFour + counts.four
  if (fours >= 2) score += 110_000
  if (fours >= 1 && counts.openThree >= 1) score += 100_000
  if (counts.openThree >= 2) score += 90_000

  return score
}

/**
 * 着法排序用的分值：先用精确口径判五与四（能看见隔子型且很便宜），
 * 都没命中时退回便宜口径看三与二。两条路径互斥，不会重复计分。
 *
 * 搜索内部请用 `threatScoreWith` 并把已经算好的 `FastThreat` 传进来——
 * 那里每个节点都要对全部候选各算两次，重复扫描是主要的开销来源。
 */
export function threatScoreWith(
  board: Board,
  point: Point,
  player: Player,
  fast: FastThreat,
): number {
  if (fast.five) return WIN_SCORE
  if (fast.openFour) return SHAPE_VALUE.openFour
  if (fast.four) return SHAPE_VALUE.four

  return shapeScore(analyzeRuns(board, point, player))
}

export function threatAt(board: Board, point: Point, player: Player): number {
  return threatScoreWith(board, point, player, analyzeFast(board, point, player))
}

/** 该点的攻防综合价值：我下在这里的价值，加上对手下在这里对我的威胁。 */
export function moveOrderScore(board: Board, point: Point, player: Player): number {
  return threatAt(board, point, player) + threatAt(board, point, opponentOf(player))
}

/** 这一手是否让 `player` 立刻连成五子。 */
export function isWinningPoint(board: Board, point: Point, player: Player): boolean {
  return analyzeFast(board, point, player).five
}
