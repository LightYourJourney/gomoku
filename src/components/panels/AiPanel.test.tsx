import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AiInfo } from '../../store/gameStore'
import { AiPanel, type AiPanelProps } from './AiPanel'

const INFO: AiInfo = {
  depth: 2,
  nodes: 42,
  elapsedMs: 3,
  score: -700,
  confidence: 'exact',
  reason: 'search',
  move: { x: 7, y: 7 },
}

function setup(overrides: Partial<AiPanelProps> = {}) {
  const onRetry = vi.fn()
  const onDismissError = vi.fn()
  const props: AiPanelProps = {
    thinking: false,
    info: null,
    error: null,
    canRetry: false,
    onRetry,
    onDismissError,
    ...overrides,
  }

  return { onRetry, onDismissError, ...render(<AiPanel {...props} />) }
}

/** 点开标题右侧的「?」。 */
function openInfo() {
  fireEvent.click(screen.getByRole('button', { name: 'AI 引擎的技术详情' }))
}

describe('AiPanel —— 思考与结果', () => {
  /**
   * 任务书 §七 给默认层举的例就是「AI 正在分析局面……」；
   * `DESIGN_SYSTEM.md` §7 的禁用清单里**第一个例子是 Web Worker**。
   * 这句话此前正是「正在 Web Worker 中搜索，主线程不受影响…」。
   */
  it('思考中说人话，不暴露 Web Worker 这类实现细节', () => {
    setup({ thinking: true })

    expect(screen.getByText('AI 正在分析局面…')).toBeInTheDocument()
    expect(screen.queryByText(/Web Worker/)).not.toBeInTheDocument()
  })

  it('没有结果时说明尚未分析', () => {
    setup()

    expect(screen.getByText('尚未产生分析结果。')).toBeInTheDocument()
  })

  /**
   * **常驻技术介绍是发现 F-UI-03 的一半。** 那段讲 Negamax / Zobrist 的说明原先
   * 无条件挂在面板底部——开局第一眼看到的就是它。
   */
  it('没有结果时不显示那段算法说明', () => {
    setup()

    expect(screen.queryByText(/Negamax/)).not.toBeInTheDocument()
  })

  it('思考中也不显示算法说明——那时同样没有结果', () => {
    setup({ thinking: true })

    expect(screen.queryByText(/Negamax/)).not.toBeInTheDocument()
  })

  it('没有结果时连「?」都不摆——没有可展开的东西', () => {
    setup()

    expect(screen.queryByRole('button', { name: 'AI 引擎的技术详情' })).not.toBeInTheDocument()
  })
})

/**
 * Phase 03 的两级信息（任务书 §七）。
 *
 * 这一组防的是**「收起来了但没人找得到」**与**「收起来了却还在默认层」**两个方向。
 */
describe('AiPanel —— 两级信息', () => {
  it('默认层说清 AI 这一手是怎么来的，不出现任何搜索指标', () => {
    setup({ info: INFO })

    expect(screen.getByTestId('ai-player-view')).toHaveTextContent('AI 完整搜索后选了这一手。')
    expect(screen.getByTestId('ai-move')).toHaveTextContent('H8')
    // 指标全都进了展开层
    expect(screen.queryByText('2 层')).not.toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(screen.queryByText('3 ms')).not.toBeInTheDocument()
    expect(screen.queryByText(/Negamax/)).not.toBeInTheDocument()
  })

  it.each([
    ['win', 'AI 看到一条连成五子的必胜路线，走了它的第一步。'],
    ['block', 'AI 在防守：你下一手能连成五子，它先堵住。'],
    ['opening', '开局第一手，AI 占了天元。'],
    ['search', 'AI 完整搜索后选了这一手。'],
    ['timeout', '时间到了还没搜完，这一手是启发式兜底。'],
    ['no_move', '棋盘已满，AI 没有可落子的位置。'],
  ] as const)('reason=%s 时默认层给的是引擎确实说过的那句话', (reason, sentence) => {
    setup({ info: { ...INFO, reason } })

    expect(screen.getByTestId('ai-player-view')).toHaveTextContent(sentence)
  })

  it('展开后才说明引擎是怎么跑的', () => {
    setup({ info: INFO })
    openInfo()

    expect(screen.getByText(/Negamax/)).toBeInTheDocument()
  })

  it('展开后才展示深度、节点、耗时、评分与结论可靠度', () => {
    setup({ info: INFO })
    openInfo()

    expect(screen.getByText('2 层')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('3 ms')).toBeInTheDocument()
    expect(screen.getByText('-700')).toBeInTheDocument()
    expect(screen.getByText('搜索结果')).toBeInTheDocument()
    expect(screen.getByText('精确')).toBeInTheDocument()
  })

  it('「?」用 aria-expanded 与 aria-controls 表达开合，收起时不留悬空的 IDREF', () => {
    setup({ info: INFO })

    const button = screen.getByRole('button', { name: 'AI 引擎的技术详情' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')

    openInfo()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const controls = button.getAttribute('aria-controls')
    expect(document.getElementById(controls ?? '')).not.toBeNull()

    // 再点一次收回去
    openInfo()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Negamax/)).not.toBeInTheDocument()
  })

  it('启发式结论会额外声明不保证最优——这条恒在默认层，不随折叠藏起来', () => {
    setup({ info: { ...INFO, confidence: 'heuristic', reason: 'timeout' } })

    expect(screen.getByText(/不保证最优/)).toBeInTheDocument()
  })

  it('展开技术详情也不会让启发式的免责声明显得像是精确结论', () => {
    setup({ info: { ...INFO, confidence: 'heuristic', reason: 'timeout' } })
    openInfo()

    expect(screen.getByText('启发式')).toBeInTheDocument()
    expect(screen.queryByText('精确')).not.toBeInTheDocument()
  })
})

describe('AiPanel —— 引擎失败', () => {
  it('报错时显示错误信息', () => {
    setup({ error: 'Worker 挂了' })

    expect(screen.getByRole('alert')).toHaveTextContent('Worker 挂了')
  })

  it('AI 还没落子时提供重试入口，点击触发 onRetry', () => {
    const { onRetry } = setup({ error: 'Worker 挂了', canRetry: true })

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('不该 AI 走的时候不提供重试按钮', () => {
    setup({ error: 'Worker 挂了', canRetry: false })

    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('关掉错误提示之后，重试入口不能跟着消失', () => {
    const onRetry = vi.fn()
    const onDismissError = vi.fn()
    const { rerender } = render(
      <AiPanel
        thinking={false}
        info={null}
        error="Worker 挂了"
        canRetry
        onRetry={onRetry}
        onDismissError={onDismissError}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onDismissError).toHaveBeenCalled()

    // 模拟父组件把 aiError 清空：AI 仍然欠着一手，重试入口必须还在。
    rerender(
      <AiPanel
        thinking={false}
        info={null}
        error={null}
        canRetry
        onRetry={onRetry}
        onDismissError={onDismissError}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('AI 欠着一手但还没报错时，也要给出重试入口', () => {
    const { onRetry } = setup({ canRetry: true })

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('知道了只负责关掉提示', () => {
    const { onDismissError } = setup({ error: 'Worker 挂了', canRetry: true })

    fireEvent.click(screen.getByRole('button', { name: '知道了' }))

    expect(onDismissError).toHaveBeenCalledTimes(1)
  })
})
