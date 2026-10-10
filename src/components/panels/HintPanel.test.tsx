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
  const onAsk = vi.fn()
  const onClear = vi.fn()
  const props: HintPanelProps = {
    candidates: null,
    urgency: null,
    thinking: false,
    error: null,
    canAsk: true,
    onAsk,
    onClear,
    ...overrides,
  }

  return { onAsk, onClear, ...render(<HintPanel {...props} />) }
}

function ask(): void {
  fireEvent.click(screen.getByRole('button', { name: '求提示' }))
}

describe('HintPanel —— 请求', () => {
  it('未求过提示时显示引导文案', () => {
    setup()

    expect(screen.getByRole('button', { name: '求提示' })).toBeEnabled()
    expect(screen.getByText(/不会替你落子/)).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^hint-candidate-/)).toHaveLength(0)
  })

  it('点击按钮发起提示请求', () => {
    const { onAsk } = setup()

    ask()

    expect(onAsk).toHaveBeenCalledTimes(1)
  })

  it('计算中禁用按钮并给出提示', () => {
    setup({ thinking: true })

    expect(screen.getByRole('button', { name: '求提示' })).toBeDisabled()
    expect(screen.getByText(/正在计算/)).toBeInTheDocument()
  })

  it('轮不到自己时禁用按钮', () => {
    setup({ canAsk: false })

    expect(screen.getByRole('button', { name: '求提示' })).toBeDisabled()
  })

  it('提示请求失败时显示错误且不显示候选', () => {
    setup({ error: '提示超时', candidates: null, urgency: null })

    expect(screen.getByRole('alert')).toHaveTextContent('提示超时')
    expect(screen.queryAllByTestId(/^hint-candidate-/)).toHaveLength(0)
  })
})

describe('HintPanel —— 候选', () => {
  it('展示最多三个候选与坐标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal' })

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
    setup({ candidates: SUGGESTIONS, urgency: 'win' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('必胜')
  })

  it('必须防守时显示防守徽标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'mustBlock' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('必须防守')
  })

  it('对手有活四威胁时显示危险徽标', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'danger' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('危险')
  })

  it('没有紧急情况时不虚张声势', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal' })

    expect(screen.getByTestId('hint-urgency')).toHaveTextContent('一般')
  })

  it('标注提示不保证最优', () => {
    setup({ candidates: SUGGESTIONS, urgency: 'normal' })

    expect(screen.getByText(/不保证最优/)).toBeInTheDocument()
  })

  it('可以收起已经展示的候选', () => {
    const { onClear } = setup({ candidates: SUGGESTIONS, urgency: 'normal' })

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
    setup({ candidates: SUGGESTIONS, urgency })

    expect(screen.getByTestId('hint-urgency').className).toContain(tone)
  })
})
