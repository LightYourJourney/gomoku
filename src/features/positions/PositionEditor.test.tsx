import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiEngine } from '../../ai/engine'
import type { SearchResponse } from '../../ai/types'
import { BLACK } from '../../core/types'
import { memoryGameRecords } from '../../persist/gameRecords'
import { memoryPositions } from '../../persist/positions'
import { PositionEditor } from './PositionEditor'

function engineThat(response: (request: { requestId: number; gameVersion: number }) => SearchResponse): AiEngine {
  return {
    search: vi.fn(async (request) => response(request)),
    handleResponse() {},
    handleError() {},
    dispose() {},
  }
}

const idle = engineThat((request) => ({
  requestId: request.requestId,
  gameVersion: request.gameVersion,
  move: { x: 7, y: 7 },
  score: 12,
  depth: 5,
  nodes: 321,
  elapsedMs: 42,
  confidence: 'exact',
  reason: 'search',
  candidates: [
    { move: { x: 7, y: 7 }, score: 12, attack: 'three', defense: 'none' },
    { move: { x: 8, y: 8 }, score: 8, attack: 'three', defense: 'none' },
  ],
  urgency: 'normal',
}))

function setup(overrides: Partial<Parameters<typeof PositionEditor>[0]> = {}) {
  const positions = memoryPositions()
  const records = memoryGameRecords()
  return render(
    <PositionEditor
      engine={idle}
      records={records}
      positions={positions}
      onExit={vi.fn()}
      now={() => Date.UTC(2026, 9, 23, 1, 2, 3)}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('PositionEditor —— 编辑', () => {
  it('点击空点放黑棋，切换工具后放白棋，擦除', () => {
    setup()
    expect(screen.getByTestId('position-kind')).toHaveTextContent('自由摆盘')

    fireEvent.click(screen.getByTestId('intersection-7-7'))
    expect(screen.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')

    fireEvent.click(screen.getByRole('button', { name: '工具：白棋' }))
    fireEvent.click(screen.getByTestId('intersection-8-8'))
    expect(screen.getByTestId('stone-8-8')).toHaveAttribute('data-player', '2')

    fireEvent.click(screen.getByRole('button', { name: '工具：擦除' }))
    fireEvent.click(screen.getByTestId('intersection-8-8'))
    expect(screen.queryByTestId('stone-8-8')).not.toBeInTheDocument()
  })

  it('键盘回车在焦点格落子', () => {
    setup()
    const cell = screen.getByTestId('intersection-7-7')
    fireEvent.focus(cell)
    fireEvent.keyDown(cell, { key: 'Enter' })
    expect(screen.getByTestId('stone-7-7')).toBeInTheDocument()
  })

  it('撤销与重做', () => {
    setup()
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.queryByTestId('stone-7-7')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByTestId('stone-7-7')).toBeInTheDocument()
  })

  it('设置下一手会立即反映到棋盘语义', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '下一手：白棋' }))
    expect(screen.getByRole('button', { name: '下一手：白棋' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '工具：黑棋' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('PositionEditor —— 分析', () => {
  it('合法局面调用引擎并显示候选/深度/节点/耗时/可靠度', async () => {
    setup()
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '工具：白棋' }))
    fireEvent.click(screen.getByTestId('intersection-8-8'))

    fireEvent.click(screen.getByRole('button', { name: '分析当前局面' }))
    const panel = await screen.findByTestId('position-analysis')
    expect(panel).toHaveTextContent('深度 5 层')
    expect(panel).toHaveTextContent('节点 321')
    expect(panel).toHaveTextContent('42 ms')
    expect(panel).toHaveTextContent('精确')
    expect(panel).toHaveTextContent('H8')
  })

  it('已有胜利连线时不调用引擎，给出原因', () => {
    const engine = engineThat(() => { throw new Error('不该调用') })
    setup({ engine })
    for (const x of [0, 1, 2, 3, 4]) {
      fireEvent.click(screen.getByTestId(`intersection-${x}-0`))
    }
    expect(screen.getByTestId('position-issues')).toHaveTextContent('已结束')
    expect(screen.getByRole('button', { name: '分析当前局面' })).toBeDisabled()
  })

  it('所选档位随请求发出，结果显示实际档位，预算在技术细节里', async () => {
    const search = vi.fn(idle.search)
    const engine: AiEngine = { ...idle, search }
    setup({ engine })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '工具：白棋' }))
    fireEvent.click(screen.getByTestId('intersection-8-8'))

    fireEvent.change(screen.getByLabelText('分析档位'), { target: { value: 'hard' } })
    fireEvent.click(screen.getByRole('button', { name: '分析当前局面' }))
    const panel = await screen.findByTestId('position-analysis')
    expect(search.mock.calls[0]![0].difficulty).toBe('hard')
    expect(search.mock.calls[0]![0].budgetMs).toBeUndefined()
    expect(panel).toHaveTextContent('高级')
    expect(screen.getByTestId('position-analysis-budget')).toHaveTextContent('1600ms')
  })
})

describe('PositionEditor —— 保存与载入', () => {
  it('保存后从下拉重新打开', async () => {
    const positions = memoryPositions()
    setup({ positions })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.change(screen.getByLabelText('局面名称'), { target: { value: '斜月研究' } })
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)

    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(screen.queryByTestId('stone-7-7')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('打开已保存局面'), {
      target: { value: String((await positions.list()).records[0]!.id) },
    })
    expect(screen.getByTestId('stone-7-7')).toBeInTheDocument()
  })

  it('载入合法棋谱第 N 手并标为已知手顺', async () => {
    const records = memoryGameRecords()
    await records.put({
      moves: [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 8, y: 8 }],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    })
    setup({ records })
    await waitFor(() => expect(screen.getByLabelText('棋谱')).toHaveTextContent('#1'))

    fireEvent.change(screen.getByLabelText('棋谱'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('载入手数'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '载入' }))

    expect(screen.getByTestId('position-kind')).toHaveTextContent('第 2 手')
    expect(screen.getByTestId('stone-7-7')).toBeInTheDocument()
    expect(screen.getByTestId('stone-7-8')).toBeInTheDocument()
  })

  it('保存后显示最近保存时间；删除需二次确认且不丢当前棋盘', async () => {
    const positions = memoryPositions()
    setup({ positions })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)

    expect(screen.getByTestId('position-saved-at')).toHaveTextContent(
      /最近保存：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
    )

    fireEvent.click(screen.getByRole('button', { name: '删除已保存局面' }))
    expect(screen.getByRole('button', { name: '确认删除' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() =>
      expect(screen.getByTestId('position-notice')).toHaveTextContent('只删了本次会话'),
    )
    expect(screen.queryByTestId('position-saved-at')).not.toBeInTheDocument()
    expect(screen.getByTestId('stone-7-7')).toBeInTheDocument()
    expect((await positions.list()).records).toHaveLength(0)
  })

  it('删除失败时保留当前选择并显式报错', async () => {
    const base = memoryPositions()
    const positions = {
      ...base,
      delete: vi.fn(async () => ({ deleted: false, persisted: false })),
    }
    setup({ positions })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)
    const savedId = (await positions.list()).records[0]!.id

    fireEvent.click(screen.getByRole('button', { name: '删除已保存局面' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() =>
      expect(screen.getByTestId('position-error')).toHaveTextContent('删除'),
    )
    expect(screen.getByTestId('position-saved-at')).toBeInTheDocument()
    expect(screen.getByLabelText('打开已保存局面')).toHaveValue(String(savedId))
    expect((await positions.list()).records).toHaveLength(1)
  })

  it('取消删除不会移除记录或清空当前选择', async () => {
    const positions = memoryPositions()
    setup({ positions })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)
    const savedId = (await positions.list()).records[0]!.id

    fireEvent.click(screen.getByRole('button', { name: '删除已保存局面' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument()
    expect(screen.getByTestId('position-saved-at')).toBeInTheDocument()
    expect(screen.getByLabelText('打开已保存局面')).toHaveValue(String(savedId))
    expect((await positions.list()).records).toHaveLength(1)
  })
})
