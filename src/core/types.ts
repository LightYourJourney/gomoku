/** 棋盘边长。15×15 自由规则。 */
export const BOARD_SIZE = 15

/** 交叉点总数。 */
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE

/** 连成多少枚算胜。自由规则下「五枚或更多」均判胜，即长连有效。 */
export const WIN_LENGTH = 5

/** 1 = 黑（先手），2 = 白。 */
export type Player = 1 | 2

/** 0 = 空，其余为落子方。 */
export type Cell = 0 | Player

/** 一维棋盘，索引 = y * BOARD_SIZE + x。 */
export type Board = Uint8Array

/** 0-based 坐标，左上角为 (0, 0)。 */
export interface Point {
  readonly x: number
  readonly y: number
}

export type GameStatus = 'playing' | 'won' | 'draw' | 'resigned'

export type MoveError = 'out_of_bounds' | 'occupied' | 'game_over'

export const BLACK: Player = 1
export const WHITE: Player = 2
