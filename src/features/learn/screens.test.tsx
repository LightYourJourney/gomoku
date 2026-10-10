import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_PROGRESS } from '../../persist/progress'
import { LESSONS } from '../../learn/lessons'
import { PUZZLES } from '../../learn/puzzles'
import { useLearnStore } from '../../store/learnStore'
import { PuzzleScreen } from '../puzzles/PuzzleScreen'
import { LearnScreen } from './LearnScreen'

beforeEach(() => {
  useLearnStore.setState({ progress: EMPTY_PROGRESS, loaded: true, view: 'learn' })
})

const openLesson = (id: string): void => {
  fireEvent.click(screen.getByTestId(`lesson-${id}`))
}

describe('LearnScreen —— 课程列表', () => {
  it('列出全部 8 节课', () => {
    render(<LearnScreen />)

    for (const lesson of LESSONS) {
      expect(screen.getByTestId(`lesson-${lesson.id}`)).toBeInTheDocument()
    }
  })

  it('显示完成进度，已完成的打勾', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'] },
      loaded: true,
      view: 'learn',
    })
    render(<LearnScreen />)

    expect(screen.getByTestId('learn-progress')).toHaveTextContent(`1 / ${LESSONS.length}`)
    expect(screen.getByTestId('lesson-rules')).toHaveAttribute('data-done', 'true')
    expect(screen.getByTestId('lesson-two')).toHaveAttribute('data-done', 'false')
  })

  it('点一节课进入它，并从第一页讲解开始', () => {
    render(<LearnScreen />)

    openLesson('three')

    expect(screen.getByText(LESSONS[2]!.steps[0]!.title)).toBeInTheDocument()
    expect(screen.getByText(LESSONS[2]!.steps[0]!.body)).toBeInTheDocument()
  })

  it('翻讲解页直到最后一页之后进入练习', () => {
    render(<LearnScreen />)
    openLesson('rules')

    const lesson = LESSONS[0]!
    for (let i = 0; i < lesson.steps.length; i++) {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    }

    expect(screen.getByText(lesson.practice.prompt)).toBeInTheDocument()
  })

  it('做完练习后回到列表，那一节已经打勾', async () => {
    render(<LearnScreen />)
    openLesson('rules')

    const lesson = LESSONS[0]!
    for (let i = 0; i < lesson.steps.length; i++) {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    }

    // 这一节的解法是补满横排四子
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    await waitFor(() => expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'true'))

    fireEvent.click(screen.getByRole('button', { name: '← 课程列表' }))

    expect(screen.getByTestId('lesson-rules')).toHaveAttribute('data-done', 'true')
    expect(useLearnStore.getState().progress.completedLessons).toContain('rules')
  })

  it('存在上次停留的课程时，直接展开那一节', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, lastVisited: { kind: 'lesson', id: 'defense' } },
      loaded: true,
      view: 'learn',
    })

    render(<LearnScreen />)

    const lesson = LESSONS.find((entry) => entry.id === 'defense')!
    expect(screen.getByText(lesson.steps[0]!.title)).toBeInTheDocument()
  })

  it('上次停留的课程 id 已经不存在时，退回列表而不是白屏', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, lastVisited: { kind: 'lesson', id: '已经删掉的课' } },
      loaded: true,
      view: 'learn',
    })

    render(<LearnScreen />)

    expect(screen.getByTestId('lesson-rules')).toBeInTheDocument()
  })
})

describe('LearnScreen —— 讲解里的棋盘演示', () => {
  it('有手顺的讲解页显示演示控件，没有的不显示', () => {
    render(<LearnScreen />)
    openLesson('rules')

    // 第一页没有 sequence
    expect(screen.queryByTestId('sequence-progress')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByTestId('sequence-progress')).toHaveTextContent('0 / 9')
  })

  it('点「下一步」逐手摆子，走到末手后禁用', () => {
    render(<LearnScreen />)
    openLesson('rules')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    const stones = (): number => screen.queryAllByTestId(/^stone-/).length
    expect(stones()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '下一手' }))
    expect(stones()).toBe(1)

    for (let i = 0; i < 8; i++) {
      const next = screen.getByRole('button', { name: '下一手' })
      if ((next as HTMLButtonElement).disabled) break
      fireEvent.click(next)
    }

    expect(screen.getByTestId('sequence-progress')).toHaveTextContent('9 / 9')
    expect(screen.getByRole('button', { name: '下一手' })).toBeDisabled()
  })

  it('点「上一手」可以退回去', () => {
    render(<LearnScreen />)
    openLesson('rules')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '下一手' }))
    fireEvent.click(screen.getByRole('button', { name: '下一手' }))
    fireEvent.click(screen.getByRole('button', { name: '下一手' }))

    fireEvent.click(screen.getByRole('button', { name: '上一手' }))

    expect(screen.getByTestId('sequence-progress')).toHaveTextContent('2 / 9')
  })
})

describe('PuzzleScreen —— 残局列表', () => {
  it('按分类列出全部题目', () => {
    render(<PuzzleScreen />)

    for (const puzzle of PUZZLES) {
      expect(screen.getByTestId(`puzzle-${puzzle.id}`)).toBeInTheDocument()
    }
  })

  it('显示通过进度', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: ['win-h', 'win-diag'] },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)

    expect(screen.getByTestId('puzzle-progress')).toHaveTextContent(`2 / ${PUZZLES.length}`)
    expect(screen.getByTestId('puzzle-win-h')).toHaveAttribute('data-done', 'true')
  })

  it('做对一题之后标记为已通过，进度加一', async () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    fireEvent.click(screen.getByTestId('intersection-4-7'))

    await waitFor(() =>
      expect(useLearnStore.getState().progress.solvedPuzzles).toContain('win-h'),
    )
    expect(await screen.findByText('这一题已经通过。')).toBeInTheDocument()
  })

  it('「再来一次」把棋盘清回初始局面', async () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    await screen.findByText('这一题已经通过。')

    fireEvent.click(screen.getByRole('button', { name: '再来一次' }))

    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId(/^board-mark-/)).toHaveLength(0)
  })

  it('「← 残局列表」回到列表', () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    fireEvent.click(screen.getByRole('button', { name: '← 残局列表' }))

    expect(screen.getByTestId('puzzle-progress')).toBeInTheDocument()
  })
})
