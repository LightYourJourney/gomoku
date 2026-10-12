import { useId, useState, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

/** 内容区留白。三档够用：常规、紧凑（列表）、宽松（空状态）。 */
export type PanelPadding = 'normal' | 'tight' | 'roomy'

const PADDING_CLASS: Record<PanelPadding, string> = {
  normal: 'p-3',
  tight: 'p-2',
  roomy: 'p-8',
}

export interface PanelProps {
  title?: string
  children: ReactNode
  className?: string
  /**
   * 内容区的**排布**类（间距、对齐），例如 `space-y-3 text-center`。
   *
   * **内边距不要写在这里**，用 `padding`。原因不是洁癖：Tailwind 的同名工具类
   * 之间没有优先级，谁在生成的 CSS 里靠后谁赢——实测 `.p-2.5` 排在 `.p-3.5`
   * 之前，所以 `bodyClassName="p-2.5"` 会被面板自带的 `p-3.5` 静默盖掉，
   * 而 `p-8` 恰好排在后面所以生效。同一个 API 一处生效一处不生效，
   * 查起来要翻构建产物。
   */
  bodyClassName?: string
  padding?: PanelPadding
  /**
   * 标题行变成可折叠的开关。默认 `false`——未传参的调用点行为逐字不变。
   *
   * 只有对战页左栏那两组设置用它（`SettingsPanel`）。为此给 `Panel` 加一个属性
   * 是刻意的：另一条路是在调用方自己搭一套折叠头，那会把面板的边框、标题字号、
   * 内边距复制一份出去，而「这几种 CSS 不能各写一遍」正是这个组件存在的理由。
   *
   * 层级是 **`<h2><button>`**，不是 `<button><h2>`——后者不合法（`<button>` 只接受
   * 短语内容），而且会让标题在无障碍树里失去 heading 角色。
   */
  collapsible?: boolean
  /** 初始展开与否。只读一次，之后由用户操作决定。 */
  defaultOpen?: boolean
}

export function Panel({
  title,
  children,
  className,
  bodyClassName,
  padding = 'normal',
  collapsible = false,
  defaultOpen = false,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  const expanded = !collapsible || open

  return (
    <section
      className={cx(
        'overflow-hidden rounded-xl border border-border bg-surface shadow-panel',
        className,
      )}
    >
      {title !== undefined && (
        <header className="border-b border-border px-3 py-2">
          {/*
            标题是 14px 而不是更小：它比面板**里面**的正文还小的话，容器的标签
            弱于内容，层级就是反的。字号提上来、颜色压到 muted，
            与正文（14px / text-fg）靠字重与颜色区分，不靠字号。
          */}
          <h2 className="text-sm font-semibold text-muted">
            {collapsible ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setOpen((value) => !value)}
                // `min-h-7`（28px）：探针的 `smallTargets` 量到过 20px——
                // 标题文字本身只有 20px 高，**低于 WCAG 2.5.8 的 24px 下限**。
                // 判据是「under24 里只允许剩下棋盘交叉点」，由 `yarn ui:probe` 守。
                className="flex min-h-7 w-full items-center gap-2 text-left transition hover:text-fg"
              >
                {title}
                <Chevron open={open} />
              </button>
            ) : (
              title
            )}
          </h2>
        </header>
      )}
      {expanded && (
        <div id={bodyId} className={cx(PADDING_CLASS[padding], bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  )
}

/** 折叠指示。`aria-hidden`——开合状态由 `aria-expanded` 表达，不需要念两遍。 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cx(
        'ml-auto h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none',
        open && 'rotate-180',
      )}
    >
      <path
        d="M4 6.5 8 10.5 12 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
