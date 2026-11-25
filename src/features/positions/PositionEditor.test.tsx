import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiEngine } from '../../ai/engine'
import type { SearchResponse } from '../../ai/types'
import { ENGINE_VERSION } from '../../ai/version'
import { BLACK } from '../../core/types'
import { memoryGameRecords } from '../../persist/gameRecords'
import { memoryPositions } from '../../persist/positions'
import { MAX_IMPORT_BYTES } from '../../persist/transfer/validate'
import { FALLBACK_WARNING } from '../../lib/confidence-labels'
import { PositionEditor } from './PositionEditor'

function engineThat(response: (request: { requestId: number; gameVersion: number }) => SearchResponse): AiEngine {
  return {
    search: vi.fn(async (request) => response(request)),
    handleResponse() {},
    handleError() {},
    cancel() {},
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
  confidence: 'complete',
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

describe('PositionEditor —— 导入边界', () => {
  it('超过大小上限的文件在读入前就被拒绝', async () => {
    setup()
    const file = new File(['{}'], 'huge.json', { type: 'application/json' })
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_BYTES + 1 })
    const text = vi.fn()
    Object.defineProperty(file, 'text', { value: text })

    fireEvent.change(screen.getByTestId('position-file'), {
      target: { files: [file] },
    })

    expect(await screen.findByTestId('position-error')).toHaveTextContent('文件超过')
    expect(text).not.toHaveBeenCalled()
  })
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

describe('PositionEditor —— 分享', () => {
  it('在 /review/editor 里生成的链接指向应用根，不带页面地址', async () => {
    window.history.replaceState(null, '', '/review/editor')
    setup()
    fireEvent.click(screen.getByTestId('intersection-7-7'))

    fireEvent.click(screen.getByRole('button', { name: '分享局面' }))
    fireEvent.click(await screen.findByRole('button', { name: /分享当前局面/ }))

    const link = new URL((await screen.findByTestId('share-link') as HTMLInputElement).value)
    expect(link.pathname).toBe('/')
    expect(link.hash).toMatch(/^#share=/)
    window.history.replaceState(null, '', '/')
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
    expect(panel).toHaveTextContent('结论 搜满档位深度')
    expect(panel).not.toHaveTextContent('不保证最优')
    expect(panel).toHaveTextContent('H8')
    // 分析结论必须注明引擎（AGENTS）；复盘页早就这么做，编辑器曾经漏了。
    expect(panel).toHaveTextContent(`引擎 ${ENGINE_VERSION}`)
  })

  it('离开编辑器时取消在飞的分析，不让它留在只读 Worker 上挡住之后的提示', () => {
    const cancel = vi.fn()
    const pendingEngine: AiEngine = {
      ...idle,
      search: vi.fn(() => new Promise<SearchResponse>(() => {})),
      cancel,
    }
    const view = setup({ engine: pendingEngine })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '工具：白棋' }))
    fireEvent.click(screen.getByTestId('intersection-8-8'))
    fireEvent.click(screen.getByRole('button', { name: '分析当前局面' }))
    const requestId = vi.mocked(pendingEngine.search).mock.calls[0]![0].requestId

    view.unmount()

    expect(cancel).toHaveBeenCalledWith(requestId)
  })

  it('一层都没搜完的结论带警示语，其余不带', async () => {
    const fallback = engineThat((request) => ({
      requestId: request.requestId,
      gameVersion: request.gameVersion,
      move: { x: 7, y: 6 },
      score: 12,
      depth: 0,
      nodes: 0,
      elapsedMs: 800,
      confidence: 'fallback',
      reason: 'timeout',
      candidates: [{ move: { x: 7, y: 6 }, score: 12, attack: 'three', defense: 'none' }],
      urgency: 'normal',
    }))
    setup({ engine: fallback })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '工具：白棋' }))
    fireEvent.click(screen.getByTestId('intersection-8-8'))

    fireEvent.click(screen.getByRole('button', { name: '分析当前局面' }))
    const panel = await screen.findByTestId('position-analysis')
    expect(panel).toHaveTextContent('结论 一步贪心兜底')
    expect(panel).toHaveTextContent(FALLBACK_WARNING)
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
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(screen.getByTestId('stone-7-7')).toBeInTheDocument()
  })

  /**
   * 下拉框**只记录所选**，不直接覆盖盘面。
   *
   * 原先 `onChange` 即 `loadSaved`：键盘在下拉框上按方向键会逐条触发 change，
   * 当前盘面被一条条覆盖，而编辑器的撤销撤不回「打开」。
   */
  it('在下拉里换选不覆盖当前盘面，点「打开」才载入；未选时「打开」禁用', async () => {
    const positions = memoryPositions()
    setup({ positions })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.change(screen.getByLabelText('局面名称'), { target: { value: '旧局面' } })
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)

    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    fireEvent.click(screen.getByTestId('intersection-3-3'))

    const select = screen.getByLabelText('打开已保存局面')
    fireEvent.change(select, { target: { value: '' } })
    expect(screen.getByRole('button', { name: '打开' })).toBeDisabled()

    fireEvent.change(select, { target: { value: String((await positions.list()).records[0]!.id) } })
    // 只是选中：盘面还是刚摆的那一手
    expect(screen.getByTestId('stone-3-3')).toBeInTheDocument()
    expect(screen.queryByTestId('stone-7-7')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(screen.getByTestId('stone-7-7')).toBeInTheDocument()
    expect(screen.queryByTestId('stone-3-3')).not.toBeInTheDocument()
  })

  it('下拉里选了别的但还没「打开」时，不显示针对当前那条的删除——免得以为删的是新选的', async () => {
    const positions = memoryPositions()
    setup({ positions })
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.change(screen.getByLabelText('局面名称'), { target: { value: '旧局面' } })
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)
    expect(screen.getByRole('button', { name: '删除已保存局面' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('打开已保存局面'), { target: { value: '' } })

    expect(screen.queryByRole('button', { name: '删除已保存局面' })).not.toBeInTheDocument()
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

  /*
    「确认删除」「取消」按下去，按钮自己被卸载（删成功时整块都没了），焦点掉到 body。
    先 focus() 再点，模拟键盘按下——`fireEvent.click` 自己不移焦点。
  */
  it('取消删除后焦点回到「删除已保存局面」，不掉到 body', async () => {
    setup()
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)

    fireEvent.click(screen.getByRole('button', { name: '删除已保存局面' }))
    const cancel = screen.getByRole('button', { name: '取消' })
    cancel.focus()
    fireEvent.click(cancel)

    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByRole('button', { name: '删除已保存局面' })).toHaveFocus()
  })

  it('确认删除后焦点落到「打开已保存局面」下拉框，不掉到 body', async () => {
    setup()
    fireEvent.click(screen.getByTestId('intersection-7-7'))
    fireEvent.click(screen.getByRole('button', { name: '保存局面' }))
    await screen.findByText(/只写进了内存兜底/)

    fireEvent.click(screen.getByRole('button', { name: '删除已保存局面' }))
    const confirm = screen.getByRole('button', { name: '确认删除' })
    confirm.focus()
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(screen.getByTestId('position-notice')).toHaveTextContent('只删了本次会话'),
    )
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByLabelText('打开已保存局面')).toHaveFocus()
  })
})
