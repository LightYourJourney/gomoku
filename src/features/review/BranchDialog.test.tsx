import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BLACK, WHITE, type Point } from '../../core/types'
import type { GameRecord } from '../../persist/gameRecords'
import { BranchDialog } from './BranchDialog'

const MOVES: readonly Point[] = [
  { x: 3, y: 7 },
  { x: 3, y: 9 },
  { x: 4, y: 7 },
  { x: 4, y: 9 },
  { x: 5, y: 7 },
]

function record(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    seq: 7,
    schemaVersion: 1,
    moves: MOVES,
    firstPlayer: BLACK,
    mode: 'pve',
    humanColor: WHITE,
    difficulty: 'easy',
    resignedBy: null,
    winner: null,
    ...overrides,
  }
}

const WIN_MOVES: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 3, y: 0 },
  { x: 3, y: 1 },
  { x: 4, y: 0 },
]

describe('BranchDialog —— 分支确认', () => {
  it('显示分支点、下一手，并回传选择的配置', () => {
    const onConfirm = vi.fn()
    render(
      <BranchDialog
        record={record()}
        cursor={2}
        error={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByTestId('branch-dialog')).toHaveTextContent('2 / 5 手')
    expect(screen.getByTestId('branch-dialog')).toHaveTextContent('黑棋')
    fireEvent.change(screen.getByLabelText('分支对弈模式'), {
      target: { value: 'pvp' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始探索' }))

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'pvp',
      humanColor: WHITE,
      difficulty: 'easy',
    })
  })

  it('人机模式可切换执子与难度，并回传实际配置', () => {
    const onConfirm = vi.fn()
    render(
      <BranchDialog
        record={record()}
        cursor={2}
        error={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.change(screen.getByLabelText('分支玩家执子'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('分支 AI 难度'), { target: { value: 'hard' } })
    fireEvent.click(screen.getByRole('button', { name: '开始探索' }))

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'hard',
    })
  })

  it('五连终局明确阻止，确认按钮禁用', () => {
    render(
      <BranchDialog
        record={record({ moves: WIN_MOVES, winner: BLACK })}
        cursor={WIN_MOVES.length}
        error={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByTestId('branch-blocked')).toHaveTextContent('五连终局')
    expect(screen.getByRole('button', { name: '开始探索' })).toBeDisabled()
  })

  it('取消关闭对话框，不提交', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <BranchDialog
        record={record()}
        cursor={1}
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('展示 store 返回的错误', () => {
    render(
      <BranchDialog
        record={record()}
        cursor={1}
        error="接管失败"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByTestId('branch-error')).toHaveTextContent('接管失败')
  })
})
