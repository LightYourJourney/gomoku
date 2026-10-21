import { DIRECTIONS, idx, inBounds } from '../core/board'
import { BOARD_SIZE, WIN_LENGTH, type Board, type Player, type Point } from '../core/types'
import { countCall } from './metrics'
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
 * 而 `threatAt` 在每个节点都要对全部候选各算两次，一乘就是十万量级。
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
 * 沿 `dir` 取以 `point` 为中心的一行，写入调用方给的 `line`，并**假定
 * `player` 已经落在 `point` 上**。
 *
 * 棋盘外面记为「被堵」而不是「空」——外面放不下棋子，对一条连线来说那和
 * 对手挡着是一回事。这个区别正是「贴边的 mmmm. 是冲四而不是活四」的由来。
 *
 * 边界与索引在这里直接展开，不走 `inBounds` / `idx`：这两个函数在剖析里合计
 * 占 15% 的自耗时，而逐个候选、逐个方向、逐个格子的调用点让每次调用都在做
 * 同一件事。展开后行为不变——非整数坐标落到 `board[小数下标]` 得到 `undefined`，
 * 与 `inBounds` 判假一样记为 -1。
 */
function buildLine(
  board: Board,
  point: Point,
  player: Player,
  dir: Point,
  line: Line,
): void {
  for (let i = 0; i < WINDOW_SIZE; i++) {
    const step = i - CENTER
    const x = point.x + dir.x * step
    const y = point.y + dir.y * step

    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
      line[i] = -1
      continue
    }

    const cell = board[y * BOARD_SIZE + x]
    line[i] = cell === 0 ? 0 : cell === player ? 1 : -1
  }

  line[CENTER] = 1
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
 * 一个方向上「有没有五 / 成五点在哪」。
 *
 * `winningSteps` 是**相对落点的步数**（-4..4），不是行内下标（0..8）——
 * 两个单位都只是裸 `number`，类型名与注释是唯一的区分手段。
 */
interface DirectionScan {
  readonly five: boolean
  readonly winningSteps: readonly number[]
}

/**
 * 与 `buildLine` + `scanLine` 同义，但**不物化那一行**。
 *
 * 搜索热路径只关心「这条线上有没有五、成五点在哪」，中间那 9 格数组没有第二个
 * 读者；而 `analyzeDirection` 要拿它逐格试放，所以那边保留数组版本。
 *
 * 两处必然有重复的窗口逻辑，`patterns.test.ts` 用随机棋盘把两条路径逐项对齐
 * （包括界外落点）。
 */
function scanDirection(
  board: Board,
  point: Point,
  player: Player,
  dir: Point,
): DirectionScan {
  /*
   * 界外落点退回数组版：`base + stride * step` 在 x 越界时仍可能落在 0..224 里，
   * 于是会读到**无关行**的格子。生产调用点全部来自界内的 `candidateMoves`，
   * 但公开函数没有这条前置条件，两条实现就必须对同样的输入给同样的答案。
   * 这个分支在热路径上恒定不成立，成本可忽略。
   */
  if (point.x < 0 || point.x >= BOARD_SIZE || point.y < 0 || point.y >= BOARD_SIZE) {
    const line = new Int8Array(WINDOW_SIZE)
    buildLine(board, point, player, dir, line)
    const scan = scanLine(line)
    return {
      five: scan.five,
      winningSteps: scan.winningIndices.map((index) => index - CENTER),
    }
  }

  const dx = dir.x
  const dy = dir.y
  // 该方向上还能走几格；两个轴取较小者（与棋盘边界的距离，含落点所在格）。
  const forwardSteps = Math.min(
    dx > 0 ? BOARD_SIZE - 1 - point.x : dx < 0 ? point.x : BOARD_SIZE,
    dy > 0 ? BOARD_SIZE - 1 - point.y : dy < 0 ? point.y : BOARD_SIZE,
  )
  const backwardSteps = Math.min(
    dx > 0 ? point.x : dx < 0 ? BOARD_SIZE - 1 - point.x : BOARD_SIZE,
    dy > 0 ? point.y : dy < 0 ? BOARD_SIZE - 1 - point.y : BOARD_SIZE,
  )
  const base = point.y * BOARD_SIZE + point.x
  const stride = dy * BOARD_SIZE + dx
  const winningSteps: number[] = []

  for (let start = -WINDOW_RADIUS; start <= 0; start++) {
    // 窗口只要有一格在棋盘外就作废——与「棋盘外记为被堵」是同一件事。
    if (start < -backwardSteps || start + WIN_LENGTH - 1 > forwardSteps) continue

    let own = 0
    let emptyStep = -1
    let blocked = false

    for (let k = 0; k < WIN_LENGTH; k++) {
      const step = start + k
      // 落点无条件当成己方已落下（`buildLine` 的 `line[CENTER] = 1`）。
      if (step === 0) {
        own++
        continue
      }

      const cell = board[base + stride * step]
      if (cell === player) {
        own++
      } else if (cell === 0) {
        if (emptyStep >= 0) {
          blocked = true
          break
        }
        emptyStep = step
      } else {
        blocked = true
        break
      }
    }

    if (blocked) continue
    if (own === WIN_LENGTH) return { five: true, winningSteps: [] }
    if (own === WIN_LENGTH - 1 && !winningSteps.includes(emptyStep)) {
      winningSteps.push(emptyStep)
    }
  }

  return { five: false, winningSteps }
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
  const line = new Int8Array(WINDOW_SIZE)
  buildLine(board, point, player, dir, line)
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

/**
 * **只对空点调用。**
 *
 * 内部按「`player` 已经落在 `point` 上」来算（见 `buildLine`），所以对一颗
 * **已有棋子**的点调用，得到的是「假如这里是空的、落了会怎样」——
 * 一个看起来合理但毫无意义的答案，不会抛错也不会返回空。
 *
 * 当前全部生产调用点都满足这个前提：取点来源只有 `candidateMoves`
 * （它只收 `board[index] === 0` 的空位）与 `threat.ts:284` 那个显式的
 * `!== 0` 守卫。`patterns.test.ts` 里有一条用例把这个行为钉住——
 * 将来若真要改语义，会因为那条用例变红而变成一次刻意决定。
 */
export function analyzeFast(board: Board, point: Point, player: Player): FastThreat {
  countCall('analyzeFast')

  const winningPoints: Point[] = []
  let five = false
  let maxWinningInOneDirection = 0

  for (const dir of DIRECTIONS) {
    const scan = scanDirection(board, point, player, dir)

    if (scan.five) {
      five = true
      break
    }

    if (scan.winningSteps.length > maxWinningInOneDirection) {
      maxWinningInOneDirection = scan.winningSteps.length
    }

    for (const step of scan.winningSteps) {
      const candidate = { x: point.x + dir.x * step, y: point.y + dir.y * step }
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
 *
 * **同样只对空点调用**，理由见 `analyzeFast`。
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
 * 双重威胁的组合形态。
 *
 * 这是**领域概念**，不是打分细节：双四、四三、双活三才是真正决定胜负的
 * 组合，单看某一个方向会严重低估它们。教学里也按这三类讲，所以抽出来单独
 * 定义，让「打分」与「判题」对它们的理解不可能分叉。
 *
 * 注意「一个活四」不算双四——活四已经必胜，但它只出现在一个方向上；
 * 把它算成双四会让「构造活四」和「构造双四」两类题混为一谈。
 */
export interface DoubleThreat {
  readonly doubleFour: boolean
  readonly fourThree: boolean
  readonly doubleThree: boolean
}

export function doubleThreat(counts: ShapeCount): DoubleThreat {
  const fours = counts.openFour + counts.four

  return {
    doubleFour: fours >= 2,
    fourThree: fours >= 1 && counts.openThree >= 1,
    doubleThree: counts.openThree >= 2,
  }
}

export function hasDoubleThreat(counts: ShapeCount): boolean {
  const threat = doubleThreat(counts)
  return threat.doubleFour || threat.fourThree || threat.doubleThree
}

/**
 * 把棋型计数折算成可直接比较的分值。
 *
 * 除逐方向累加外，还对双重威胁加成——三类组合的分值可以叠加（双四同时
 * 又有活三），所以这里是三个独立的加法，而不是三选一。
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

  const threat = doubleThreat(counts)
  if (threat.doubleFour) score += 110_000
  if (threat.fourThree) score += 100_000
  if (threat.doubleThree) score += 90_000

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
  countCall('threatScoreWith')

  if (fast.five) return WIN_SCORE
  if (fast.openFour) return SHAPE_VALUE.openFour
  if (fast.four) return SHAPE_VALUE.four

  return shapeScore(analyzeRuns(board, point, player))
}

export function threatAt(board: Board, point: Point, player: Player): number {
  return threatScoreWith(board, point, player, analyzeFast(board, point, player))
}

/** 这一手是否让 `player` 立刻连成五子。**只对空点调用**，理由同 `analyzeFast`。 */
export function isWinningPoint(board: Board, point: Point, player: Player): boolean {
  return analyzeFast(board, point, player).five
}
