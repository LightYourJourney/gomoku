import { cellAt, idx, inBounds } from './board'
import { WIN_LENGTH, type Board, type MoveError, type Point } from './types'

/** 需要检查的四个方向：横、竖、主对角线（↘）、副对角线（↗）。 */
const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
]

/**
 * 落子合法性。只判断位置本身，不判断是否轮到该方、棋局是否已结束
 * ——那两件事属于 game 状态机。
 */
export function validateMove(board: Board, p: Point): MoveError | null {
  if (!inBounds(p.x, p.y)) return 'out_of_bounds'
  if (board[idx(p.x, p.y)] !== 0) return 'occupied'
  return null
}

/**
 * 从最后一手出发判断是否成五，自由规则（长连有效、无禁手）。
 *
 * 只检查最后一手所在的四条线：不在最后一步落点上形成的连线，不可能
 * 是在这一手才刚成立的。返回该线上的整段连续同色棋子（长连时长度大于 5），
 * 顺序为沿连线的负方向端到正方向端。
 */
export function findWinLine(board: Board, last: Point): Point[] | null {
  const player = cellAt(board, last.x, last.y)
  if (player === 0) return null

  for (const dir of DIRECTIONS) {
    const line: Point[] = [{ x: last.x, y: last.y }]

    for (let step = 1; ; step++) {
      const point = { x: last.x - dir.x * step, y: last.y - dir.y * step }
      if (cellAt(board, point.x, point.y) !== player) break
      line.unshift(point)
    }

    for (let step = 1; ; step++) {
      const point = { x: last.x + dir.x * step, y: last.y + dir.y * step }
      if (cellAt(board, point.x, point.y) !== player) break
      line.push(point)
    }

    if (line.length >= WIN_LENGTH) return line
  }

  return null
}

export function isBoardFull(board: Board): boolean {
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) return false
  }
  return true
}
