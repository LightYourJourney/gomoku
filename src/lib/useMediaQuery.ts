import { useCallback, useSyncExternalStore } from 'react'

/**
 * 视口断点查询。
 *
 * **为什么对战页的三栏断点（1440）要用 JS 而不是一个 CSS 媒体查询**：
 * 它决定的不是样式，而是**设置面板渲染在哪一栏**。用 CSS 各写一份、
 * 靠 `display:none` 切换的话，同一组表单控件在 DOM 里会有两份——
 * 两组 `role="radiogroup"`、两个「对战模式」，读屏软件会看到两套，
 * `getByRole` 会匹配到两个，jsdom 下更是连 CSS 都不加载、两份全都「可见」。
 * 宁可要这 20 行，也不要两套控件。**代价是断点值只能有一个出处**：
 * 用在哪、值是多少，都写在调用处的常量里（见 `BattleScreen` 的 `WIDE_QUERY`）。
 *
 * `useSyncExternalStore` 在客户端首次渲染时**同步**读取 `matches`，
 * 所以不存在「先按窄档渲染一帧再跳成宽档」的闪烁。
 *
 * jsdom 没有 `matchMedia`（调用即抛错）。没有就返回 `false`——即窄档。
 * 这里**不往全局塞桩**：单元测试要的是「不炸」，宽窄两档的真实行为由
 * Playwright 在真浏览器里守着（`e2e/layout.spec.ts`）。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = mediaQueryList(query)
      if (list === null) return () => {}
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => mediaQueryList(query)?.matches ?? false, [query])

  return useSyncExternalStore(subscribe, getSnapshot)
}

function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}
