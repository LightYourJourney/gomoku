import type { ReactNode } from 'react'

/**
 * 棋盘容器：容器查询 + 正方形约束 + 圆角边框。对战、课程、残局三处共用。
 *
 * 抽出来是因为这几行 CSS 有几处**不能各写一遍**的硬约束：
 * `container-type: size` 是 `min(100cqw, 100cqh)` 能生效的前提，落下一个
 * 棋盘就不再自适应；移动端的 `order-1` / 固定高度决定了棋盘出现在面板之前、
 * 且最多占半屏高。散成三份，改一处忘两处只是时间问题。
 */
export function BoardStage({ children }: { children: ReactNode }) {
  return (
    <section
      className="order-1 flex h-[min(calc(100vw-1.5rem),56dvh)] items-center justify-center px-3 py-3 lg:order-2 lg:h-auto lg:min-h-0 lg:px-6 lg:py-6"
      style={{ containerType: 'size' }}
    >
      <div className="aspect-square w-[min(100cqw,100cqh)] overflow-hidden rounded-2xl border border-board-edge/40 shadow-panel">
        {children}
      </div>
    </section>
  )
}
