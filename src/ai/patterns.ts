import { cellAt, inBounds, idx, opponentOf } from '../core/board'
import { WIN_LENGTH, type Board, type Player, type Point } from '../core/types'
import { WIN_SCORE } from './types'

/** 四个方向：横、竖、主对角线（↘）、副对角线（↗）。 */
export const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
]

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

/**
 * 棋型分值。
 *
 * 数值只需保证相对大小正确：活四已经不可阻挡，所以远高于冲四；
 * 冲四是立刻见胜负的一手，略高于活三；眠型只作为排序参考。
 */
const SHAPE_VALUE = {
  openFour: 120_000,
  four: 14_000,
  openThree: 10_000,
  three: 700,
  openTwo: 500,
  two: 80,
} as const

/** 判空时把「棋盘外面」与「已有棋子」同等对待——两者都无法落子。 */
function isEmptyAt(board: Board, x: number, y: number): boolean {
  return inBounds(x, y) && board[idx(x, y)] === 0
}

function createShapeCount(): ShapeCount {
  return { five: 0, openFour: 0, four: 0, openThree: 0, three: 0, openTwo: 0, two: 0 }
}

/**
 * 假定 `player` 在 `point` 落一手，统计四个方向上形成的棋型。
 *
 * 只做「连续同色 + 两端是否可延展」的判断，不识别隔一子的跳型
 * （那需要完整的模式串匹配，属于 Phase 2）。对「能不能立刻成五」「要不要堵」
 * 「哪一手更厚」这些判断，这个粒度是够的，且不会误报。
 */
export function analyzePoint(board: Board, point: Point, player: Player): ShapeCount {
  const counts = createShapeCount()

  for (const dir of DIRECTIONS) {
    let forward = 0
    while (
      cellAt(board, point.x + dir.x * (forward + 1), point.y + dir.y * (forward + 1)) === player
    ) {
      forward++
    }

    let backward = 0
    while (
      cellAt(board, point.x - dir.x * (backward + 1), point.y - dir.y * (backward + 1)) === player
    ) {
      backward++
    }

    const total = forward + backward + 1
    const openEnds =
      (isEmptyAt(board, point.x + dir.x * (forward + 1), point.y + dir.y * (forward + 1)) ? 1 : 0) +
      (isEmptyAt(board, point.x - dir.x * (backward + 1), point.y - dir.y * (backward + 1)) ? 1 : 0)

    if (total >= WIN_LENGTH) {
      counts.five++
    } else if (total === 4) {
      if (openEnds === 2) counts.openFour++
      else if (openEnds === 1) counts.four++
    } else if (total === 3) {
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
 * 把棋型计数折算成一个可直接比较的分值。
 * 除了逐方向的累加，还对「同时存在多个方向威胁」给出额外加成——双四、四三、双活三
 * 才是真正决定胜负的组合。
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

/** 这一手是否让 `player` 立刻连成五子。 */
export function isWinningPoint(board: Board, point: Point, player: Player): boolean {
  return analyzePoint(board, point, player).five > 0
}

/** 这一手对 `player` 的威胁值；用于「对手下在这里会有多危险」。 */
export function threatAt(board: Board, point: Point, player: Player): number {
  return shapeScore(analyzePoint(board, point, player))
}

/** 该点的攻防综合价值，用于着法排序。 */
export function moveOrderScore(board: Board, point: Point, player: Player): number {
  return threatAt(board, point, player) + threatAt(board, point, opponentOf(player))
}
