/**
 * 「?」展开按钮。
 *
 * `DESIGN_SYSTEM.md` §7 定的渐进披露形态：面板标题右侧一个「?」，
 * 点开是一块内联的技术说明。**用「?」而不是纯折叠**——收起来的内容
 * 最经典的失败模式就是没人找得到，一个带问号的按钮比一个光秃秃的箭头可发现得多。
 *
 * 为什么只有按钮、没有配套的「详情块」组件：**按钮在面板头部、内容在面板体里**，
 * 两者不在同一棵子树，状态只能由调用方持有。把状态藏进这个组件、
 * 再让调用方去别处渲染内容，只会得到一个到处传 `open` 的中间人。
 * 所以这里只出按钮，`open` / `onToggle` / `controls` 由调用方给。
 *
 * 两条无障碍约定：
 *
 * - **`aria-controls` 只在展开时输出。** 收起时内容被卸载，留一个指向不存在元素的
 *   IDREF 是无效 ARIA（与 `Panel` 的折叠按钮同一条规矩）。
 * - **命中区 28×28。** 尺寸是 7（`h-7 w-7`）= 28px，高于 WCAG 2.5.8 的 24px 下限。
 *   `Panel` 的标题按钮当初就是因为只有 20px 而被探针的 `smallTargets` 抓出来过
 *   （判据：`under24` 里只允许剩下棋盘交叉点）。
 */
export interface InfoButtonProps {
  /** 展开与否，由调用方持有。 */
  open: boolean
  onToggle: () => void
  /**
   * 无障碍名。**不要只写「?」**——读屏软件念一个问号等于没念。
   * 写清楚它展开的是什么，例如「AI 引擎的技术详情」。
   */
  label: string
  /** 展开时指向详情块的 `id`；收起时传 `undefined`。 */
  controls?: string
}

export function InfoButton({ open, onToggle, label, controls }: InfoButtonProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold text-muted transition hover:border-border-strong hover:text-fg"
    >
      ?
    </button>
  )
}
