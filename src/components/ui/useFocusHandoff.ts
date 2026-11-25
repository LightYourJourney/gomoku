import { useEffect, useRef } from 'react'

interface PendingHandoff {
  readonly source: HTMLElement
  readonly target: () => HTMLElement | null
}

/**
 * 「按下去就会被禁用或卸载」的按钮用的焦点交接。
 *
 * 这类按钮（走到头的「下一步」、点完就消失的「收起」「知道了」……）一失去可聚焦性，
 * 浏览器就把焦点丢到 `<body>`，之后没人接回来——键盘用户得从页面开头重新 Tab，
 * 读屏也不知道该念什么。
 *
 * 用法：在 `onClick` 里 `handoff(event.currentTarget, () => 落点)`。这一下只是**登记**，
 * 不立刻搬焦点；之后每次渲染检查一次：
 *
 * - 按钮被禁用或已卸载、焦点无处可去 → 交给落点（`preventScroll`：窄屏上不跳页面）。
 * - 按钮仍然可用、焦点还在它上面 → 继续等（「自动播放」要走好几步才到头）。
 * - 焦点已被用户移走 → 登记作废，不抢。
 *
 * 只在按钮**真握着焦点**时登记：Safari 的鼠标点击不给按钮焦点，那就没有焦点可丢。
 * 落点写成函数，是因为它可能要等这次渲染之后才出现在 DOM 里。
 *
 * 与 `GameLibrary` 删除流程的 `pendingFocus` 同一个思路（登记 → 渲染后兑现），
 * 区别在于这里要等「按钮真的不能用了」——禁用可能晚于点击好几次渲染才发生。
 */
export function useFocusHandoff(): (source: HTMLElement, target: () => HTMLElement | null) => void {
  const pending = useRef<PendingHandoff | null>(null)

  useEffect(() => {
    const entry = pending.current
    if (entry === null) return
    const { source, target } = entry
    const active = document.activeElement
    const lost = !source.isConnected || source.matches(':disabled')
    if (!lost) {
      if (active !== source) pending.current = null
      return
    }
    pending.current = null
    // jsdom 里被禁用的按钮仍是 activeElement；Chrome 会把焦点改到 body。两种都算「无处可去」。
    const stranded =
      active === null || active === source || active === document.body || active === document.documentElement
    if (stranded) target()?.focus({ preventScroll: true })
  })

  return (source, target) => {
    if (document.activeElement === source) pending.current = { source, target }
  }
}
