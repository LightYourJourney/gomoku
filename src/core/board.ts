import {
  BOARD_SIZE,
  CELL_COUNT,
  type Board,
  type Cell,
  type Player,
  type Point,
} from './types'

/** 0-based 坐标 → 一维索引（行主序）。 */
export function idx(x: number, y: number): number {
  return y * BOARD_SIZE + x
}

/** 一维索引 → 坐标。 */
export function pointFromIdx(i: number): Point {
  return { x: i % BOARD_SIZE, y: Math.floor(i / BOARD_SIZE) }
}

/** 坐标是否落在棋盘内。非整数、NaN、Infinity 一律视为界外。 */
export function inBounds(x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < BOARD_SIZE &&
    y >= 0 &&
    y < BOARD_SIZE
  )
}

export function createBoard(): Board {
  return new Uint8Array(CELL_COUNT)
}

/**
 * 读取交叉点。界外一律返回 0（空）。
 *
 * 这样扫描连线与棋型时可以省掉边界判断：「对方的棋子」和「棋盘外面」
 * 对一条连线而言是同一个终止条件。要区分二者请直接用 inBounds。
 */
export function cellAt(board: Board, x: number, y: number): Cell {
  if (!inBounds(x, y)) return 0
  return board[idx(x, y)] as Cell
}

export function opponentOf(player: Player): Player {
  return player === 1 ? 2 : 1
}
