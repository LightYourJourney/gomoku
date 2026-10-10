import { BOARD_SIZE, type Point } from '../core/types'

/** 列字母：A..O。 */
export function columnLabel(x: number): string {
  return String.fromCharCode(65 + x)
}

/** 行号：从棋盘底部往上数，即内部 y = 0 对应最上面那行，标为 15。 */
export function rowLabel(y: number): string {
  return String(BOARD_SIZE - y)
}

/** 把内部坐标格式化成棋谱用的记号，例如 (7, 7) → H8。 */
export function formatPoint(point: Point): string {
  return `${columnLabel(point.x)}${rowLabel(point.y)}`
}
