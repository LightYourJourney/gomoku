import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPill } from './StatusPill'

/** 转圈那个元素。`animate-spin` 是 Tailwind 的动画类，全站只有这一处用它。 */
function spinner(): HTMLElement | null {
  return document.querySelector('[data-testid="status-pill"] .animate-spin')
}

describe('StatusPill', () => {
  it('给出状态文案', () => {
    render(<StatusPill status={{ tone: 'playing', label: '轮到你落子', player: 1 }} />)

    expect(screen.getByTestId('status-pill')).toHaveTextContent('轮到你落子')
  })

  it('正在思考时转圈', () => {
    render(
      <StatusPill status={{ tone: 'thinking', label: 'AI 思考中…', player: 2 }} busy />,
    )

    expect(spinner()).not.toBeNull()
  })

  /**
   * **发现 F-UI-06。** `describeStatus` 在人机模式下**只要轮到 AI 就返回
   * `tone: 'thinking'`**——包括「轮到 AI」但根本没有请求在飞的时候
   * （引擎报错后卡住、点重试之前）。照着 `tone` 渲染转圈的话，转圈的语义
   * 「正在进行」就变成了假话：实测截图里药丸写着「轮到 AI」而圈照转，
   * 同一屏的引擎面板是红的。**反馈在撒谎，玩家会继续等，而不是去点「重试」。**
   *
   * 判据必须挂在 `aiThinking` 上，不是挂在 `tone` 上。
   */
  it('只是轮到 AI、并没有在思考时，不转圈', () => {
    render(<StatusPill status={{ tone: 'thinking', label: '轮到 AI', player: 2 }} busy={false} />)

    expect(spinner()).toBeNull()
  })

  it('不转圈时仍然说得出轮到谁——用棋子点补上', () => {
    render(<StatusPill status={{ tone: 'thinking', label: '轮到 AI', player: 2 }} busy={false} />)

    expect(screen.getByTestId('status-pill')).toHaveTextContent('轮到 AI')
    // 圆点是 aria-hidden 的装饰，这里只确认它渲染了（黑/白靠颜色区分）
    expect(document.querySelector('[data-testid="status-pill"] span[aria-hidden]')).not.toBeNull()
  })

  it('终局不转圈', () => {
    render(<StatusPill status={{ tone: 'result', label: '你赢了', player: 1 }} busy={false} />)

    expect(spinner()).toBeNull()
  })
})
