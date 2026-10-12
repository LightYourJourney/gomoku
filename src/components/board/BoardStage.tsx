import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface BoardStageProps {
  children: ReactNode
  /**
   * 追加的布局类。**位置（`order`）与占位（`flex-1`）属于父布局，不属于这里**——
   * 同一个 `order-1` 在「棋盘在前」的页面是对的，在对战页的新中列里会把棋盘
   * 排到工具栏后面去。所以这个组件只说「我是一个正方形棋盘容器」，
   * 不说「我排第几」。
   */
  className?: string
}

/**
 * 棋盘容器：容器查询 + 正方形约束 + 圆角边框。对战、课程、残局、复盘四处共用。
 *
 * 抽出来是因为这几行 CSS 有几处**不能各写一遍**的硬约束：
 * `container-type: size` 是 `min(100cqw, 100cqh)` 能生效的前提，落下一个
 * 棋盘就不再自适应；窄屏的固定高度决定了棋盘出现在面板之前、且最多占半屏高。
 * 散成四份，改一处忘三处只是时间问题。
 *
 * **≥1024 时高度由父容器决定**（`lg:h-auto` + 调用方给的 `lg:flex-1` 或栅格行高），
 * 而且父容器的高度必须是**确定的**——`container-type: size` 遇上 `auto` 高度会
 * 循环求值，棋盘会塌成 0。窄屏那档固定高度就是为这件事存在的。
 */
export function BoardStage({ children, className }: BoardStageProps) {
  return (
    <section
      className={cx(
        // `lg:py-2` 而不是 `lg:py-3`：对战页中列的纵向开销直接压棋盘，而棋盘在 ≥1440
        // 是被高度卡住的（见 `BattleScreen` 的注释）。**这个值只能改在这里**——
        // 调用方用 `className` 传 `lg:py-2` 是没用的，Tailwind 的同名工具类之间
        // 没有优先级，谁在生成的 CSS 里靠后谁赢，实测自带的那条会赢。
        'flex h-[min(calc(100vw-1.5rem),56dvh)] items-center justify-center px-3 py-3 lg:h-auto lg:min-h-0 lg:px-6 lg:py-2',
        className,
      )}
      style={{ containerType: 'size' }}
    >
      <div className="aspect-square w-[min(100cqw,100cqh)] overflow-hidden rounded-2xl border border-board-edge/40 shadow-panel">
        {children}
      </div>
    </section>
  )
}
