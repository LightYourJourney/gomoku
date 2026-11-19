import { inBounds } from '../core/board'
import type { Player, Point } from '../core/types'

/**
 * 读库、读文件共用的小守卫。原先 `storage` / `positions` / `gameRecords` / `transfer` 各写一份
 * （`isPlayer` 四份、坐标解析三份），5 行以内的重复 jscpd 抓不到，只能靠收口。
 */
export function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPlayer(value: unknown): value is Player {
  return value === 1 || value === 2
}

export function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
}

/**
 * 一个棋盘内的落点（`inBounds` 同时查整数与 0–14）；只取 `x` / `y`，多余字段丢掉。
 * 不用 `isObj`：它排除数组，这里沿用三处原写法（数组没有数值的 `x` / `y`，结果一样是 null）。
 */
export function parsePoint(value: unknown): Point | null {
  if (typeof value !== 'object' || value === null) return null

  const { x, y } = value as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!inBounds(x, y)) return null

  return { x, y }
}
