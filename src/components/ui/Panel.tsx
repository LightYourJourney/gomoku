import type { ReactNode } from 'react'
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
}

export function Panel({
  title,
  children,
  className,
  bodyClassName,
  padding = 'normal',
}: PanelProps) {
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
          <h2 className="text-sm font-semibold text-muted">{title}</h2>
        </header>
      )}
      <div className={cx(PADDING_CLASS[padding], bodyClassName)}>{children}</div>
    </section>
  )
}
