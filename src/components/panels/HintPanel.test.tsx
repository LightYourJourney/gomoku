import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MoveSuggestion, Urgency } from '../../ai/types'
import { HintPanel, type HintPanelProps } from './HintPanel'

const SUGGESTIONS: readonly MoveSuggestion[] = [
  { move: { x: 7, y: 7 }, score: 130_000, attack: 'openFour', defense: 'none' },
  { move: { x: 6, y: 6 }, score: 22_000, attack: 'openThree', defense: 'four' },
  { move: { x: 8, y: 8 }, score: 11_000, attack: 'three', defense: 'openThree' },
  { move: { x: 4, y: 4 }, score: 900, attack: 'none', defense: 'none' },
]

function setup(overrides: Partial<HintPanelProps> = {}) {
  const onClear = vi.fn()
  const props: HintPanelProps = {
    candidates: null,
    urgency: null,
    confidence: null,
    thinking: false,
    error: null,
    onClear,
    ...overrides,
  }

  return { onClear, ...render(<HintPanel {...props} />) }
}

/**
 * **「求提示」不在这个面板里。** 它是棋盘下方工具栏那一颗——同一个请求有两个入口
 * 迟早会各触发一次。面板只负责展示结果与「收起」。
 * 按钮本身的禁用条件（轮不到自己、正在算）在 `ControlBar.test.tsx` 里。
 */
describe('HintPanel —— 空态与引导', () => {
  it('未求过提示时显示引导文案，并指向工具栏那个入口', () => {
    setup()

    expect(screen.getByText(/不会替你落子/)).toBeInTheDocument()
    expect(screen.getByText(/求提示/)).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^hint-candidate-/)).toHaveLength(0)
  })

  it('面板里没有第二个「求提示」入口', () => {
    setup()

    expect(screen.queryByRole('button', { name: '求提示' })).not.toBeInTheDocument()
  })

  it('计算中给出提示', () => {
    setup({ thinking: true })

    expect(screen.getByText(/正在计算/)).toBeInTheDocument()
  })

  it('提示请求失败时显示错误且不显示候选', () => {
    setup({ error: '提示超时', candidates: null, urgency: null })

    expect(screen.getByRole('alert')).toHaveTextContent('提示超时')
    expect(screen.queryAllByTestId(/^hint-candidate-/)).toHaveLength(0)
  })
})

describe('HintPanel —— 候选', () => {
  it('展示最多三个候选与坐标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'complete' })

    const items = screen.getAllByTestId(/^hint-candidate-/)
    expect(items).toHaveLength(3)

    // 坐标用棋谱记号：H8 是中央天元
    expect(items[0]).toHaveTextContent('H8')
    expect(items[1]).toHaveTextContent('G9')
    expect(items[2]).toHaveTextContent('I7')

    // 第四个候选被截掉
    expect(screen.queryByTestId('hint-candidate-4-4')).not.toBeInTheDocument()
  })

  it('给出攻防两面的棋型说明', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal' })

    expect(screen.getByTestId('hint-candidate-7-7')).toHaveTextContent('活四')
    expect(screen.getByTestId('hint-candidate-6-6')).toHaveTextContent('活三')
    expect(screen.getByTestId('hint-candidate-6-6')).toHaveTextContent('冲四')
  })

  it('必胜时显示必胜徽标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'win', confidence: 'complete' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('必胜')
  })

  it('必须防守时显示防守徽标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'mustBlock', confidence: 'complete' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('必须防守')
  })

  it('对手有活四威胁时显示危险徽标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'danger', confidence: 'complete' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('危险')
  })

  it('没有紧急情况时不虚张声势', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'complete' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('一般')
  })

  /**
   * 这条此前传的是「精确」那一档（当时还是二值的可靠度），却断言出现「不保证最优」——
   * 它**靠脚注里那句「它只是建议，不保证最优」蒙对的**，而不是靠可信度标注。
   * 脚注收进「?」之后它立刻露馅。修成它真正想测的那一档。
   */
  it('贪心兜底的提示明确标注不保证最优', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'fallback' })

    expect(screen.getByText(/不保证最优/)).toBeInTheDocument()
  })

  /**
   * **常驻技术说明是发现 F-UI-03 的一半**：那段脚注原来无条件渲染，
   * 里面直接印着内部预算 `800 ms`，而 `DESIGN_SYSTEM.md` §7 明令默认界面不出现
   * 这类内部参数。任务书 §六 也要求「没有分析结果时不显示大段常驻技术介绍」。
   */
  it('没有候选时不显示技术脚注', () => {
    setup()

    expect(screen.queryByText(/短预算/)).not.toBeInTheDocument()
  })

  it('只出错、没有候选时也不显示技术脚注', () => {
    setup({ error: '提示超时' })

    expect(screen.queryByText(/短预算/)).not.toBeInTheDocument()
  })

  /**
   * Phase 03：脚注从「有候选就出现」再收一层，进标题右侧的「?」。
   * 判据是 `DESIGN_SYSTEM.md` §7——「内部参数（预算毫秒数、候选宽度）」属于
   * 默认界面不出现的东西，`800 ms` 正是预算毫秒数。
   */
  it('有候选时不直接把预算毫秒数印在默认界面，而是给一个「?」', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'complete' })

    expect(screen.queryByText(/短预算/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提示是怎么算出来的' })).toBeInTheDocument()
  })

  it('点开「?」之后读得到那份说明，再点一次收回去', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'complete' })
    const button = screen.getByRole('button', { name: '提示是怎么算出来的' })

    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/短预算/)).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByText(/短预算/)).not.toBeInTheDocument()
  })

  it('没有候选时连「?」都不摆——没有可展开的东西', () => {
    setup()

    expect(screen.queryByRole('button', { name: '提示是怎么算出来的' })).not.toBeInTheDocument()
  })

  it('搜满档位深度：如实说搜满了，不叫「精确」', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'complete' })

    const line = screen.getByTestId('hint-confidence')
    expect(line).toHaveTextContent('结论：搜满档位深度')
    expect(line).not.toHaveTextContent('精确')
    expect(line).not.toHaveClass('text-warn')
  })

  it('限时内没搜满但搜完了若干层：中性色，不说「不保证最优」', () => {
    // 提示固定 800 ms 短预算，专家档几乎必然搜不满——但它交出来的是已经完整搜完的
    // 那一层的结果，不是兜底。以前这一档顶着警示色与「启发式，不保证最优」。
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'partial' })

    const line = screen.getByTestId('hint-confidence')
    expect(line).toHaveTextContent('结论：限时内未搜满，取已搜完的层')
    expect(line).not.toHaveTextContent('不保证最优')
    expect(line).not.toHaveClass('text-warn')
  })

  it('一层都没搜完：警示色，并明说不保证最优', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'fallback' })

    const line = screen.getByTestId('hint-confidence')
    expect(line).toHaveTextContent('结论：一步贪心兜底，不保证最优')
    expect(line).toHaveClass('text-warn')
  })

  it('结论行在默认层，里面不出现层数这类搜索指标', () => {
    for (const confidence of ['shortcut', 'complete', 'partial', 'fallback'] as const) {
      const { unmount } = setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence })
      expect(screen.getByTestId('hint-confidence').textContent).not.toMatch(/\d/)
      unmount()
    }
  })

  it('还没算过提示时不显示可靠度', () => {
    setup()

    expect(screen.queryByTestId('hint-confidence')).not.toBeInTheDocument()
  })

  it('可以收起已经展示的候选', () => {
    const { onClear } = setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'complete' })

    fireEvent.click(screen.getByRole('button', { name: '收起提示' }))

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('没有候选时不显示收起按钮', () => {
    setup()

    expect(screen.queryByRole('button', { name: '收起提示' })).not.toBeInTheDocument()
  })
})

describe('HintPanel —— 徽标配色', () => {
  const CASES: ReadonlyArray<readonly [Urgency, string]> = [
    ['win', 'accent'],
    ['mustBlock', 'danger'],
    ['danger', 'warn'],
  ]

  it.each(CASES)('%s 用 %s 色调', (urgency, tone) => {
    setup({ candidates: SUGGESTIONS, urgency, confidence: 'complete' })

    expect(screen.getByTestId('hint-urgency').className).toContain(tone)
  })
})
