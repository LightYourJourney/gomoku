import type { Page } from '../../lib/routes'
import { lazyPage } from './lazyPage'

/*
 * 按页加载（评估报告 §4.4）：对战页随入口；教学、残局、复盘（含编辑器、数据管理）与分享预览
 * 各自成块。启动时先下好地址要去的那一页再挂载（`main.tsx`），其余几页随后在后台下——
 * 入口包变小、首屏更快，切页时分块通常已经在了（理由见 `lazyPage.ts`）。
 */
export const LearnScreen = lazyPage(() => import('../learn/LearnScreen').then((m) => m.LearnScreen))
export const PuzzleScreen = lazyPage(() => import('../puzzles/PuzzleScreen').then((m) => m.PuzzleScreen))
export const ReviewScreen = lazyPage(() => import('../review/ReviewScreen').then((m) => m.ReviewScreen))
export const SharePreview = lazyPage(() => import('../sharing/SharePreview').then((m) => m.SharePreview))

const BY_PAGE = { learn: LearnScreen, puzzles: PuzzleScreen, review: ReviewScreen } as const

/** 下好某一页的分块；对战页随入口，无事可做。失败不抛——留给那一页的错误边界去说。 */
export function preloadPage(page: Page | 'share'): Promise<void> {
  const target = page === 'share' ? SharePreview : page === 'battle' ? null : BY_PAGE[page]
  if (target === null) return Promise.resolve()
  return target.preload().then(
    () => undefined,
    () => undefined,
  )
}

/** 在后台下好其余所有页面的分块。 */
export function preloadAllPages(): void {
  for (const page of ['learn', 'puzzles', 'review', 'share'] as const) void preloadPage(page)
}
