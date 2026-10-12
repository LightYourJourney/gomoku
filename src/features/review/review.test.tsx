import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseBoundStore, StoreApi } from 'zustand'
import { BLACK, type Point } from '../../core/types'
import { createReplayStore, REPLAY_STEP_MS, type ReplayStore } from '../../store/replayStore'
import { createAnalysisStore } from '../../store/analysisStore'
import { memoryGameRecords, type GameRecord, type GameRecordsStorage } from '../../persist/gameRecords'
import type { AiEngine } from '../../ai/engine'
import { GameLibrary } from './GameLibrary'
import { ReplayBoard } from './ReplayBoard'
import { ReviewScreen } from './ReviewScreen'

type ReplayRecord = Omit<GameRecord, 'seq' | 'schemaVersion'>

const NINE_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 }, { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function nineMoveRecord(): ReplayRecord {
  return {
    moves: [...NINE_MOVES],
    firstPlayer: BLACK,
    mode: 'pve',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
  }
}

function threeMoveRecord(): ReplayRecord {
  return {
    moves: NINE_MOVES.slice(0, 3),
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: null,
  } as ReplayRecord
}

// ── GameLibrary ──────────────────────────────────────────────

describe('GameLibrary', () => {
  it('空库显示引导文案', async () => {
    render(<GameLibrary storage={memoryGameRecords()} onOpen={vi.fn()} />)

    expect(await screen.findByText('还没有保存的对局')).toBeInTheDocument()
  })

  it('列出棋谱按 seq 降序，点击回调用完整记录', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    const second = (await storage.put(threeMoveRecord())).record
    const onOpen = vi.fn()
    render(<GameLibrary storage={storage} onOpen={onOpen} />)

    const items = await screen.findAllByTestId(/^record-/)
    expect(items).toHaveLength(2)
    // 最近的（seq 大的）在前
    expect(items[0]).toHaveAttribute('data-testid', `record-${second.seq}`)

    fireEvent.click(items[0])
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ seq: second.seq }))
  })

  it('每条显示模式与手数', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<GameLibrary storage={storage} onOpen={vi.fn()} />)

    const item = (await screen.findAllByTestId(/^record-/))[0]!
    expect(within(item).getByText(/人机|双人/)).toBeInTheDocument()
    expect(within(item).getByText(/9 手/)).toBeInTheDocument()
  })
})


// ── ReplayBoard ──────────────────────────────────────────────

let replay: UseBoundStore<StoreApi<ReplayStore>>
const fullRecord = { seq: 1, schemaVersion: 1, ...nineMoveRecord() } as GameRecord

beforeEach(() => {
  replay = createReplayStore()
})

describe('ReplayBoard', () => {
  it('渲染派生局面与手数计数', () => {
    act(() => replay.getState().open(fullRecord))
    render(<ReplayBoard store={replay} onExit={vi.fn()} />)

    expect(screen.getByTestId('move-counter')).toHaveTextContent('0 / 9')
  })

  it('落子编号：stepNext 后第 1 手的位置出现编号标记', () => {
    act(() => replay.getState().open(fullRecord))
    render(<ReplayBoard store={replay} onExit={vi.fn()} />)

    act(() => replay.getState().stepNext())

    const first = fullRecord.moves[0]!
    expect(screen.getByTestId(`board-mark-${first.x}-${first.y}`)).toBeInTheDocument()
  })

  it('不可交互：悬停不出现落子预览（回放棋盘是只读的）', () => {
    act(() => replay.getState().open(fullRecord))
    render(<ReplayBoard store={replay} onExit={vi.fn()} />)

    // 空交叉点悬停：可交互棋盘会画落子预览，回放棋盘不该有。
    // 这是 interactive 的**可见**差异——只断言「点击后游标不动」是无效的，
    // onPlay 是空实现时它两边都成立（变异测试证实过）。
    const empty = fullRecord.moves.find(
      (move) => !fullRecord.moves.some((other) => other.x === move.x && other.y === move.y - 1),
    )!
    fireEvent.mouseEnter(screen.getByTestId(`intersection-${empty.x}-${empty.y - 1}`))
    expect(screen.queryByTestId('hover-stone')).not.toBeInTheDocument()
  })

  it('cursor=0 时「上一步」禁用；到尾时「下一步」禁用', () => {
    act(() => replay.getState().open(fullRecord))
    render(<ReplayBoard store={replay} onExit={vi.fn()} />)

    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled()

    act(() => replay.getState().goTo(9))
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
  })

  it('卸载后自动播放定时器不再推进（Review Focus 第 4 条）', () => {
    vi.useFakeTimers()
    try {
      act(() => replay.getState().open(fullRecord))
      const { unmount } = render(<ReplayBoard store={replay} onExit={vi.fn()} />)

      // 组件内的「自动播放」按钮触发 play
      fireEvent.click(screen.getByRole('button', { name: '自动播放' }))
      expect(replay.getState().playing).toBe(true)

      unmount()
      // 卸载后推进大量时间：游标必须停在原地
      vi.advanceTimersByTime(REPLAY_STEP_MS * 10)
      expect(replay.getState().cursor).toBe(0)
      expect(replay.getState().playing).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── ReviewScreen 组装 ────────────────────────────────────────

describe('ReviewScreen 的地标', () => {
  it('列表与回放两条路径都有 main', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)

    // 列表
    expect(await screen.findByRole('main')).toBeInTheDocument()

    // 点开一局后仍是 main（回放换的是内容，不是地标）
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    await screen.findByTestId('move-counter')
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})

describe('ReviewScreen 三段流转', () => {
  it('从列表点开一局 → 回放器出现', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)

    const item = (await screen.findAllByTestId(/^record-/))[0]!
    fireEvent.click(item)

    expect(await screen.findByTestId('move-counter')).toHaveTextContent('0 / 9')
    expect(screen.getByRole('button', { name: /回到棋谱列表/ })).toBeInTheDocument()
  })

  it('分析面板标注引擎档位、预算与版本（结论的出处）', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    const source = await screen.findByTestId('analysis-source')
    expect(source).toHaveTextContent(/ms/)
    expect(source).toHaveTextContent(/引擎 search-1/)
  })

  it('点「开始分析」后进入分析中状态，进度可见', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    fireEvent.click(screen.getByRole('button', { name: '开始分析' }))

    expect(await screen.findByTestId('analysis-progress')).toHaveTextContent('0 / 9')
  })
})

/** 永不 resolve 的引擎：让「分析中」状态稳定可断言。 */
function idleEngine(): AiEngine {
  return {
    search: () => new Promise(() => {}),
    handleResponse() {},
    handleError() {},
    dispose() {},
  }
}

describe('ReviewScreen 离开页面时停掉后台工作', () => {
  it('卸载后分析被停止——不再占着与对局共用的 Worker', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())

    const injectedReplay = createReplayStore()
    const injectedAnalysis = createAnalysisStore()
    const { unmount } = render(
      <ReviewScreen
        storage={storage}
        engine={idleEngine()}
        stores={{ replay: injectedReplay, analysis: injectedAnalysis }}
      />,
    )
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    expect(injectedAnalysis.getState().running).toBe(true)

    unmount()

    expect(injectedAnalysis.getState().running).toBe(false)
  })
})

describe('分析结论列表：只列真有亏损的手', () => {
  it('与引擎一致的着手不占亏损榜——哪怕它的分差被捷径评分撑得很大', async () => {
    // 真实对局里出现过的情形：引擎走捷径（必胜/必防，±WIN_SCORE 量纲），
    // 玩家照走了同一手。旧实现按 loss 排序把这手排到最前，榜单三行
    // 全是「与引擎一致」。修法必须落在**界面实际用的那条路径**上
    // （buildSummary），而不是只改一个没人调用的函数。
    const storage = memoryGameRecords()
    // 3 手：黑 (3,7) → 白 (3,9) → 黑 (4,7)，第 3 手成五不成立，这里只要一个终局
    const record = threeMoveRecord()
    await storage.put(record)

    const injectedReplay = createReplayStore()
    const injectedAnalysis = createAnalysisStore()
    render(
      <ReviewScreen
        storage={storage}
        engine={scriptedEngine()}
        stores={{ replay: injectedReplay, analysis: injectedAnalysis }}
      />,
    )
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))

    // 等分析跑完
    await waitFor(() => expect(injectedAnalysis.getState().running).toBe(false))

    const rows = screen.queryAllByTestId(/^verdict-/)
    // 手 0 与引擎首选相同（loss 强制 0）、手 2 是终局手（loss 0）——
    // 只有手 1 真有亏损，榜单应当只有它。
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-testid', 'verdict-1')
  })
})

/** 按 moveIndex 给出脚本化响应的引擎：手 0 与引擎首选相同，手 1 走亏。 */
function scriptedEngine(): AiEngine {
  return {
    search(request) {
      const index = request.moveIndex ?? 0
      const replies: Record<number, { move: { x: number; y: number }; score: number }> = {
        0: { move: { x: 3, y: 7 }, score: 1_000_000 }, // 捷径：与玩家手 0 相同
        1: { move: { x: 9, y: 9 }, score: 500 }, // 引擎要下 (9,9)，玩家下了别的
        2: { move: { x: 2, y: 2 }, score: 0 },
      }
      const picked = replies[index] ?? { move: { x: 2, y: 2 }, score: 0 }
      return Promise.resolve({
        requestId: request.requestId,
        gameVersion: request.gameVersion,
        moveIndex: index,
        move: picked.move,
        score: picked.score,
        depth: 1,
        nodes: 1,
        elapsedMs: 1,
        confidence: 'exact' as const,
        reason: 'search' as const,
        candidates: [],
        urgency: 'normal' as const,
      })
    },
    handleResponse() {},
    handleError() {},
    dispose() {},
  }
}

describe('GameLibrary —— 读取失败', () => {
  /**
   * `GameLibrary.tsx:35-37` 在 `list()` reject 时退成空列表。
   * 这里注入一个**一定会失败**的存储来钉住它——不能用 `memoryGameRecords()`，
   * 它的 `list()` 恒 resolve，永远走不到这条分支。
   */
  const failingStorage: GameRecordsStorage = {
    list: () => Promise.reject(new Error('棋谱库坏了')),
    get: () => Promise.resolve(null),
    put: () => Promise.reject(new Error('棋谱库坏了')),
    delete: () => Promise.resolve(),
  }

  it('list() 失败时退成空库文案，不白屏也不一直转圈', async () => {
    render(<GameLibrary storage={failingStorage} onOpen={vi.fn()} />)

    expect(await screen.findByText('还没有保存的对局')).toBeInTheDocument()
    expect(screen.queryByText('正在读取棋谱…')).not.toBeInTheDocument()
  })
})
