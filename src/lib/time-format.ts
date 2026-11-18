/**
 * 本地时间到分钟：`YYYY-MM-DD HH:mm`。局面库与棋谱库共用这一种写法。
 * 不是有效时刻时返回 null——由调用方决定怎么说「不知道」，不用 1970 年假装知道。
 */
export function formatLocalMinute(millis: number): string | null {
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return null
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `Date` 能表示的最大毫秒时间戳（ECMAScript 规定 ±8.64e15）。更大的数 `toISOString` 会抛。 */
const MAX_TIME = 8.64e15

/**
 * 一个能当时间用的毫秒数（非负安全整数、`Date` 表示得了）；否则 null。
 * 时间是附属信息：调用方拿到 null 就当「不知道」，不连累整条记录。
 */
export function millisOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME ? value : null
}

/** 文件里的时间只认 `toISOString` 的形状（UTC、毫秒可选），不用宽松的 `Date.parse`。 */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

/** ISO 时间字符串 → 毫秒；形状不对或不是真实存在的时刻（`2026-13-40…`）返回 null。 */
export function isoToMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return null
  const millis = millisOrNull(Date.parse(value))
  // `Date.parse` 会把 2 月 30 日之类「滚」到下个月：往返一次对不上就不是真实时刻。
  return millis !== null && new Date(millis).toISOString().slice(0, 19) === value.slice(0, 19) ? millis : null
}

