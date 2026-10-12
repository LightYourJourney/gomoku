import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: string
  /** 标题右侧的计数或状态，例如「已完成 5 / 8 节」。 */
  meta?: ReactNode
  /** 标题下方的一段说明。 */
  description?: ReactNode
}

/**
 * 页面标题区。教学 / 残局 / 复盘三个列表页共用。
 *
 * **必须 `flex-wrap`**：标题与右侧说明挤在同一行时，`flex` 会把标题压缩——
 * 复盘页原先就是「复」「盘」各占一行，两个字被拆成竖排。
 * 换行是这里唯一正确的降级方式，截断或缩小字号都会让页面标题失去意义。
 */
export function PageHeader({ title, meta, description }: PageHeaderProps) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {meta !== undefined && <span className="text-xs text-faint">{meta}</span>}
      </div>
      {description !== undefined && <p className="mt-2 text-body text-muted">{description}</p>}
    </header>
  )
}
