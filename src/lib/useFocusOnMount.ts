import { useEffect, useRef, type RefObject } from 'react'

/**
 * 「挂载即受焦」的正文容器 ref。
 *
 * **为什么需要它**：换页之后焦点会掉在 `<body>` 上——读屏不播报新页面，
 * 键盘用户也不知道自己到了哪，得从头 Tab 一遍。这是单页应用里很常见的坑，
 * 而组件卸载时浏览器就是这么做的（被点的那个按钮连同整棵树一起没了）。
 *
 * **什么时候会重跑**：`useEffect` 跟着挂载走，所以判据是「`PageShell` 有没有被
 * 卸载重建」——
 *
 * - `App.tsx` 按 `view` 条件渲染，换页必然重建 ✓
 * - 教学列表 → 讲解：`LearnScreen` 直接 `return <LessonView>`（**根类型变了**），
 *   `LessonView` 里的 `PageShell` 也是新建的 ✓
 * - 复盘列表 → 回放：**同一个** `ReviewScreen` 只是换了它返回的 `<PageShell>`
 *   （同类型、同位置），React 会**复用实例**，effect **不重跑** ✗
 *
 * 最后那种由调用方自己解决——`ReviewScreen` 给两个 `<PageShell>` 各带一个不同的
 * `key`，把它们变成两棵树。
 *
 * 容器要配 `tabIndex={-1}`：可编程聚焦，但**不进 Tab 顺序**
 * （Tab 直接落到正文里的第一个控件，不会在容器上多停一次）。
 * 也要配 `outline-none`——给容器画焦点环是纯噪音，它不是可交互元素。
 */
export function useFocusOnMount<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    /*
     * **必须带 `preventScroll`。** 不带的话浏览器会把焦点元素滚进视口——
     * 而正文容器从顶栏**之后**才开始，于是页面当场滚过顶栏（移动端约 113px）。
     * 这条被两条移动端用例一起抓住：`手机在棋盘上拖动不会滚页面` 报
     * `window.scrollY` 是 113`，`触摸点按的落子位置与交叉点一致` 因为
     * 页面整体位移而把触摸坐标打偏、棋子没落下去。**先有它们，才发现的。**
     */
    ref.current?.focus({ preventScroll: true })
  }, [])

  return ref
}
