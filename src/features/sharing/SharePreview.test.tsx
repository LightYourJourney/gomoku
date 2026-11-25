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
    createdAt: null,
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

describe('SharePreview —— 保存结果的播报与焦点', () => {
  function renderWith(games = memoryGameRecords()) {
    return render(
      <SharePreview token={gameShare()} games={games} positions={memoryPositions()} now={() => 1} onExit={vi.fn()} />,
    )
  }

  /*
   * `role="status"` 若随内容一起挂载，部分读屏不播报第一次出现的内容
   * （`FeedbackBanner` 的约定）：播报区要常驻，只换里面的字。
   */
  it('保存状态区在点保存之前就在（空的），结果写进同一个节点', async () => {
    renderWith()

    const region = await screen.findByTestId('share-save-state')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toBeEmptyDOMElement()

    fireEvent.click(screen.getByTestId('share-save'))
    await waitFor(() => expect(region).toHaveTextContent('内存兜底'))
    expect(screen.getByTestId('share-save-state')).toBe(region)
  })

  it('保存失败用 danger 色（§2.2：错误用 danger）', async () => {
    const games = { ...memoryGameRecords(), importMany: () => Promise.reject(new Error('quota')) }
    renderWith(games)

    fireEvent.click(await screen.findByTestId('share-save'))
    await waitFor(() => expect(screen.getByTestId('share-save-state')).toHaveTextContent('保存失败'))
    expect(screen.getByTestId('share-save-state')).toHaveClass('text-danger')
    expect(screen.getByTestId('share-save-state')).not.toHaveClass('text-muted')
  })

  /* 内存兜底不是失败（这次会话里确实存下了），是「刷新后可能丢」的警示：warn，与数据管理面板的同一句同色 */
  it('只写进内存兜底用 warn 色', async () => {
    renderWith()

    fireEvent.click(await screen.findByTestId('share-save'))
    await waitFor(() => expect(screen.getByTestId('share-save-state')).toHaveTextContent('内存兜底'))
    expect(screen.getByTestId('share-save-state')).toHaveClass('text-warn')
    expect(screen.getByTestId('share-save-state')).not.toHaveClass('text-muted')
  })

  /* 「保存」按下去当场禁用（保存中 / 已保存），焦点掉到 body。落点是结果那一行。 */
  it('按下保存后焦点落到结果状态区，保存完还在那里', async () => {
    const base = memoryGameRecords()
    const games = {
      ...base,
      importMany: async (...args: Parameters<typeof base.importMany>) => ({
        ...(await base.importMany(...args)),
        persisted: true,
      }),
    }
    renderWith(games)

    const save = await screen.findByTestId('share-save')
    save.focus()
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByTestId('share-save-state')).toHaveTextContent('已保存'))

    expect(save).toBeDisabled()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(screen.getByTestId('share-save-state'))
  })
})
