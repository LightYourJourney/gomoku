import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface PanelProps {
  title?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Panel({ title, children, className, bodyClassName }: PanelProps) {
  return (
    <section
      className={cx(
        'overflow-hidden rounded-xl border border-border bg-surface shadow-panel',
        className,
      )}
    >
      {title !== undefined && (
        <header className="border-b border-border px-3.5 py-2.5">
          <h2 className="text-xs font-semibold tracking-wide text-muted">{title}</h2>
        </header>
      )}
      <div className={cx('p-3.5', bodyClassName)}>{children}</div>
    </section>
  )
}
