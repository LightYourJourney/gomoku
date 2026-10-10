/** 拼接类名，顺手过滤掉条件为假的项。 */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
