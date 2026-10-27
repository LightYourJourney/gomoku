import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BLACK, type Point } from '../../core/types'
import { applyEdit, createPosition } from '../../core/position'
import { memoryGameRecords } from '../../persist/gameRecords'
import { memoryPositions } from '../../persist/positions'
import { createGameShare, createPositionShare } from '../../sharing/link'
import { SharePreview } from './SharePreview'

const MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 },
  { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 },
  { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function gameShare() {
  const result = createGameShare({
    seq: 9,
    schemaVersion: 1,
    moves: MOVES,
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
  })
  if (!result.ok) throw new Error(result.message)
  return result.token
}

function positionShare() {
  const position = applyEdit(createPosition(), { x: 7, y: 7 }, 'black')
  const result = createPositionShare(position, '分享测试', null)
  if (!result.ok) throw new Error(result.message)
  return result.token
}

describe('SharePreview —— 只读预览与显式导入', () => {
  it('打开棋谱链接不写库；点击保存后才写入', async () => {
    const games = memoryGameRecords()
    render(
      <SharePreview
        token={gameShare()}
        games={games}
        positions={memoryPositions()}
        now={() => 1_000}
        onExit={vi.fn()}
      />,
    )

    expect(await screen.findByTestId('share-kind')).toHaveTextContent('单盘棋谱')
    expect((await games.list()).records).toHaveLength(0)

    fireEvent.click(screen.getByTestId('share-save'))
    await waitFor(() => expect(screen.getByTestId('share-save-state')).toHaveTextContent('内存兜底'))
    expect((await games.list()).records).toHaveLength(1)
  })

  it('重复打开同一链接再保存会提示已存在', async () => {
    const games = memoryGameRecords()
    const token = gameShare()
    const first = render(
      <SharePreview token={token} games={games} positions={memoryPositions()} now={() => 1} onExit={vi.fn()} />,
    )
    fireEvent.click(await screen.findByTestId('share-save'))
    await waitFor(() => expect(screen.getByTestId('share-save-state')).toHaveTextContent('内存兜底'))
    first.unmount()

    render(
      <SharePreview token={token} games={games} positions={memoryPositions()} now={() => 1} onExit={vi.fn()} />,
    )
    fireEvent.click(await screen.findByTestId('share-save'))
    await waitFor(() =>
      expect(screen.getByTestId('share-save-state')).toHaveTextContent('已经在本地'),
    )
  })

  it('局面链接导入到局面库；不动棋谱库', async () => {
    const games = memoryGameRecords()
    const positions = memoryPositions()
    render(
      <SharePreview
        token={positionShare()}
        games={games}
        positions={positions}
        now={() => 1_000}
        onExit={vi.fn()}
      />,
    )
    expect(await screen.findByTestId('share-kind')).toHaveTextContent('自定义局面')
    fireEvent.click(screen.getByTestId('share-save'))
    await waitFor(() => expect(screen.getByTestId('share-save-state')).toHaveTextContent('内存兜底'))
    expect((await positions.list()).records).toHaveLength(1)
    expect((await games.list()).records).toHaveLength(0)
  })

  it('损坏链接显示错误页，不白屏', () => {
    render(
      <SharePreview
        token="1.00000000.***"
        games={memoryGameRecords()}
        positions={memoryPositions()}
        now={() => 1}
        onExit={vi.fn()}
      />,
    )
    expect(screen.getByTestId('share-error')).toBeInTheDocument()
    expect(screen.getByText('分享链接格式不完整')).toBeInTheDocument()
  })
})
