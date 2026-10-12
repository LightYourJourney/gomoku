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
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'exact' })

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
    setup({ candidates: SUGGESTIONS, urgency: 'win', confidence: 'exact' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('必胜')
  })

  it('必须防守时显示防守徽标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'mustBlock', confidence: 'exact' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('必须防守')
  })

  it('对手有活四威胁时显示危险徽标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'danger', confidence: 'exact' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('危险')
  })

  it('没有紧急情况时不虚张声势', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'exact' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('一般')
  })

  it('标注提示不保证最优', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'exact' })

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

  it('有候选时才说明这份提示是怎么算出来的', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'exact' })

    expect(screen.getByText(/短预算/)).toBeInTheDocument()
  })

  it('给出精确结论时标明是精确的', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'exact' })

    expect(screen.getByTestId('hint-confidence')).toHaveTextContent('精确')
  })

  it('超时回退时必须如实标成启发式', () => {
    // 提示固定 800 ms 短预算，专家档几乎必然搜不完。把启发式结论说成精确的，
    // 就是在骗玩家。
    setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'heuristic' })

    expect(screen.getByTestId('hint-confidence')).toHaveTextContent('启发式')
    expect(screen.getByTestId('hint-confidence')).toHaveTextContent(/不保证最优/)
  })

  it('还没算过提示时不显示可靠度', () => {
    setup()

    expect(screen.queryByTestId('hint-confidence')).not.toBeInTheDocument()
  })

  it('可以收起已经展示的候选', () => {
    const { onClear } = setup({ candidates: SUGGESTIONS, urgency: 'normal', confidence: 'exact' })

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
    setup({ candidates: SUGGESTIONS, urgency, confidence: 'exact' })

    expect(screen.getByTestId('hint-urgency').className).toContain(tone)
  })
})
