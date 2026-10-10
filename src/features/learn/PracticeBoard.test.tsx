import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Practice } from '../../learn/types'
import { PracticeBoard } from './PracticeBoard'

/** 黑棋四连横排，两端都能成五——故意留两个解，好验证「判定看棋谱不看坐标」。 */
const WIN_IN_ONE: Practice = {
  prompt: '补上一点，连成五子。',
  board: {
    lines: [
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '....W..........',
      '.....BBBB......',
      '....W..........',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
    ],
  },
  player: 1,
  goal: { kind: 'win' },
  hints: ['看这一排的两头。', '两端都能成五。'],
  solution: '在四子的任意一端补子，连成五子。',
}

function setup(overrides: Partial<Practice> = {}) {
  const onSolved = vi.fn()
  const practice = { ...WIN_IN_ONE, ...overrides }

  return { onSolved, ...render(<PracticeBoard practice={practice} onSolved={onSolved} />) }
}

const play = (x: number, y: number): void => {
  fireEvent.click(screen.getByTestId(`intersection-${x}-${y}`))
}

describe('PracticeBoard —— 判定', () => {
  it('走对了给出通过反馈与解法说明', () => {
    const { onSolved } = setup()

    play(4, 7)

    const feedback = screen.getByTestId('feedback')
    expect(feedback).toHaveAttribute('data-ok', 'true')
    expect(feedback).toHaveTextContent(WIN_IN_ONE.solution)
    expect(onSolved).toHaveBeenCalledTimes(1)
  })

  it('两端都能成五时，两边都算对', () => {
    // 判定是局面谓词而不是答案表，多解是自然结果。
    const { onSolved } = setup()

    play(9, 7)

    expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')
    expect(onSolved).toHaveBeenCalledTimes(1)
  })

  it('走错了给出理由，并在那一手的位置打上标记', () => {
    const { onSolved } = setup()

    play(10, 10)

    const feedback = screen.getByTestId('feedback')
    expect(feedback).toHaveAttribute('data-ok', 'false')
    expect(feedback.textContent!.length).toBeGreaterThan(6)
    expect(screen.getByTestId('board-mark-10-10')).toHaveAttribute('data-tone', 'bad')
    expect(onSolved).not.toHaveBeenCalled()
  })

  it('走错之后锁盘：再点别的交叉点不会有反应', () => {
    const { onSolved } = setup()

    play(10, 10)
    play(4, 7)

    expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'false')
    expect(onSolved).not.toHaveBeenCalled()
  })

  it('点「重试」清掉反馈与标记，可以重新走', () => {
    const { onSolved } = setup()

    play(10, 10)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument()
    expect(screen.queryByTestId('board-mark-10-10')).not.toBeInTheDocument()

    play(4, 7)
    expect(onSolved).toHaveBeenCalledTimes(1)
  })

  it('走对之后不再允许落子，也不显示重试', () => {
    setup()

    play(4, 7)

    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
    play(9, 7)
    expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')
  })
})

describe('PracticeBoard —— 三级提示', () => {
  it('没点之前不显示提示', () => {
    setup()

    expect(screen.queryByTestId('hint')).not.toBeInTheDocument()
  })

  it('第一级给题目自带的点拨', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: '要提示' }))

    expect(screen.getByTestId('hint')).toHaveTextContent(WIN_IN_ONE.hints[0]!)
    expect(screen.queryByTestId(/^board-mark-/)).not.toBeInTheDocument()
  })

  it('第二级给更具体的点拨，仍然不出坐标', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: '要提示' }))
    fireEvent.click(screen.getByRole('button', { name: /再具体一点/ }))

    expect(screen.getByTestId('hint')).toHaveTextContent(WIN_IN_ONE.hints[1]!)
    expect(screen.queryByTestId(/^board-mark-/)).not.toBeInTheDocument()
  })

  it('第三级才在棋盘上标出点位，并且之后再点也没用了', () => {
    setup()

    const hintButton = () => screen.getByRole('button', { name: /提示|再具体一点/ })
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())

    // 点位由引擎算出，不写死在题目里
    const marks = screen.getAllByTestId(/^board-mark-/)
    expect(marks).toHaveLength(1)
    expect(['board-mark-4-7', 'board-mark-9-7']).toContainEqual(
      marks[0]!.getAttribute('data-testid'),
    )
    expect(hintButton()).toBeDisabled()
  })

  it('标出点位不等于替玩家通关', () => {
    const { onSolved } = setup()

    const hintButton = () => screen.getByRole('button', { name: /提示|再具体一点/ })
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())

    expect(onSolved).not.toHaveBeenCalled()
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument()
  })
})
