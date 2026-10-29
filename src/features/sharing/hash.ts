/** 只有「从分享预览回到普通页面」才续走 AI；普通页面之间换 hash 不触发。 */
export function shouldResumeAiAfterHashChange(
  previous: string | null,
  next: string | null,
): boolean {
  return previous !== null && next === null
}
