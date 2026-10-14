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

  /**
   * **无解的题，第三级也不能说「棋盘上标出了」。**
   *
   * 那种情况下 `solveMove` 返回 null，棋盘上一个标记都没有——这句话若只按
   * **提示级数**显示，又成了「文字在一处、标记在另一处」，正是本阶段在修的那类毛病
   * （两轴审查指出：当时的条件确实只看级数）。现在它绑在 `solution` 上，
   * 与标记用的是同一个变量。
   *
   * 题库自检（`content.test.ts`）钉住 15 道题都有解，所以这条路径今天不可达；
   * 但**内容可以增删**，而「不可达所以不管」的缺口本仓吃过好几次
   * （`no_move`、`resolveNext` 的优先分支都是同类）。
   */
  it('题目无解时，第三级也不说「棋盘上标出了」', () => {
    setup({
      // 黑棋只有三个孤子，连四连都没有 —— 任何一手都成不了五，`solveMove` 返回 null
      board: {
        lines: [
          '...............',
          '...............',
          '...............',
          '...............',
          '...............',
          '...............',
          '...............',
          '...B.B.B.......',
          '...............',
          '...............',
          '...............',
          '...............',
          '...............',
          '...............',
          '...............',
        ],
      },
      goal: { kind: 'win' },
    })

    const hintButton = () => screen.getByRole('button', { name: /提示|再具体一点/ })
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())

    expect(screen.queryByText(/棋盘上标出了/)).not.toBeInTheDocument()
    expect(screen.queryAllByTestId(/^board-mark-/)).toHaveLength(0)
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

/**
 * 另一道题：黑棋在**竖线**上四连（x=7、y=3..6），成五点是 (7,2) 与 (7,7)。
 * 与 `WIN_IN_ONE` 的成五点完全不重合，而且 (7,7) 在 `WIN_IN_ONE` 的盘面上
 * 是一颗**已有的黑子**——两道题互换时不会互相蒙对。
 */
const VERTICAL_FOUR: Practice = {
  prompt: '竖线上补满五子。',
  board: {
    lines: [
      '...............',
      '...............',
      '...............',
      '.......B.......',
      '.......B.......',
      '.......B.......',
      '.......B.......',
      '...............',
      '...............',
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
  hints: ['看这一列。', '上方那一格。'],
  solution: '在四子的任意一端补子。',
}

/**
 * 换题时**组件自己**必须复位，不能把正确性寄托在调用方换 `key` 上。
 *
 * 两个生产调用点（`LessonView` / `PuzzleScreen`）目前都靠 `key` 强制重建，
 * 所以这条路径在生产里走不到——但那是调用方的写法，不是组件的保证。
 * 这里直接用新 `practice` 重渲染（**不换 key**）来走通它。
 */
describe('PracticeBoard —— 换题时复位', () => {
  it('换题清掉上一题的判定结果', () => {
    const onSolved = vi.fn()
    const { rerender } = render(<PracticeBoard practice={WIN_IN_ONE} onSolved={onSolved} />)

    play(0, 0) // 在上一题上做错一次，制造一条反馈
    expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'false')

    rerender(<PracticeBoard practice={VERTICAL_FOUR} onSolved={onSolved} />)

    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument()
  })

  it('换题清掉上一题的提示级数', () => {
    const onSolved = vi.fn()
    const { rerender } = render(<PracticeBoard practice={WIN_IN_ONE} onSolved={onSolved} />)

    fireEvent.click(screen.getByRole('button', { name: /要提示/ }))
    expect(screen.getByTestId('hint')).toBeInTheDocument()

    rerender(<PracticeBoard practice={VERTICAL_FOUR} onSolved={onSolved} />)

    expect(screen.queryByTestId('hint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /要提示/ })).toBeInTheDocument()
  })

  it('上一题做对之后换题，新题做对仍然会回调 onSolved', () => {
    const onSolved = vi.fn()
    const { rerender } = render(<PracticeBoard practice={WIN_IN_ONE} onSolved={onSolved} />)

    play(4, 7) // 上一题的成五点之一
    expect(onSolved).toHaveBeenCalledTimes(1)

    rerender(<PracticeBoard practice={VERTICAL_FOUR} onSolved={onSolved} />)
    play(7, 7) // 新题的成五点之一

    // `reported` 这道闸门如果没被复位，这里会停在 1——新题做对了却不上报
    expect(onSolved).toHaveBeenCalledTimes(2)
  })
})

/**
 * F-UI-12：判题标记必须带**含义明确的符号**。
 *
 * 此前它只给 `tone` 不给 `label`，`Board` 于是走 `String(index + 1)` 的兜底——
 * 棋盘上出现一个写着「**1**」、含义不明的红/绿圆。
 * 那个兜底是给回放编号用的（那里的序号就是含义），判题反馈不该搭便车。
 */
describe('PracticeBoard —— 判题标记（F-UI-12）', () => {
  it('走对了写「对」，不是一个含义不明的序号', () => {
    setup()

    play(4, 7) // 四连的左端，成五

    const mark = screen.getByTestId('board-mark-4-7')
    expect(mark).toHaveTextContent('对')
    expect(mark).toHaveAttribute('data-tone', 'good')
    expect(mark).not.toHaveTextContent('1')
  })

  it('走错了写「错」', () => {
    setup()

    play(0, 0) // 离四连十万八千里

    const marks = screen.getAllByTestId(/^board-mark-/)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('错')
    expect(marks[0]).toHaveAttribute('data-tone', 'bad')
  })

  /**
   * **判错之后「解」不许跟着消失。**
   *
   * 原先写成 `else if`：一落子就撤掉解法标记，而提示面板上还写着
   * 「棋盘上标出了其中一种解法」——文字在一处、标记在另一处。
   * 这条钉的就是那个一致性（任务书 §六）。
   */
  it('用满三级提示之后走错：解法标记仍然在棋盘上', () => {
    setup()

    const hintButton = () => screen.getByRole('button', { name: /提示|再具体一点/ })
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())

    const solutionId = screen.getAllByTestId(/^board-mark-/)[0]!.getAttribute('data-testid')!

    play(0, 0) // 走一个跟解法无关的地方

    expect(screen.getByTestId('board-mark-0-0')).toHaveTextContent('错')
    expect(screen.getByTestId(solutionId)).toHaveTextContent('解')
    expect(screen.getAllByTestId(/^board-mark-/)).toHaveLength(2)
  })

  it('走对了就只剩「对」——那时解法点与落子点是同一个，两个标记只会叠在一起', () => {
    setup()

    const hintButton = () => screen.getByRole('button', { name: /提示|再具体一点/ })
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())
    fireEvent.click(hintButton())

    const solutionId = screen.getAllByTestId(/^board-mark-/)[0]!.getAttribute('data-testid')!
    const [, x, y] = /board-mark-(\d+)-(\d+)/.exec(solutionId)!
    play(Number(x), Number(y))

    const marks = screen.getAllByTestId(/^board-mark-/)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('对')
  })
})
