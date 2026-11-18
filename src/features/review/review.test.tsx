import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseBoundStore, StoreApi } from 'zustand'
import { BLACK, BOARD_SIZE, type Point } from '../../core/types'
import { createReplayStore, REPLAY_STEP_MS, type ReplayStore } from '../../store/replayStore'
import { createAnalysisStore } from '../../store/analysisStore'
import { memoryGameRecords, type GameRecord, type GameRecordsStorage } from '../../persist/gameRecords'
import type { AiEngine } from '../../ai/engine'
import type { SearchRequest } from '../../ai/types'
import { GameLibrary } from './GameLibrary'
import { CURRENT_STEP_RADIUS, PLAIN_STEP_RADIUS, ReplayBoard } from './ReplayBoard'
import { ReviewScreen } from './ReviewScreen'
import { useNavigationStore } from '../../store/navigationStore'

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
    createdAt: null,
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
    createdAt: null,
  } as ReplayRecord
}

// ── GameLibrary ──────────────────────────────────────────────

describe('GameLibrary', () => {
  it('空库显示引导文案', async () => {
    render(<GameLibrary storage={memoryGameRecords()} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    expect(await screen.findByText('还没有保存的对局')).toBeInTheDocument()
  })

  it('列出棋谱按 seq 降序，点击回调用完整记录', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    const second = (await storage.put(threeMoveRecord())).record
    const onOpen = vi.fn()
    render(<GameLibrary storage={storage} onOpen={onOpen} onStartBattle={vi.fn()} />)

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
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    const item = (await screen.findAllByTestId(/^record-/))[0]!
    expect(within(item).getByText(/人机|双人/)).toBeInTheDocument()
    expect(within(item).getByText(/9 手/)).toBeInTheDocument()
  })

  /**
   * F-UI-22：人机局要标出**难度档**——棋谱里最能解释「这局为什么长这样」的就是它，
   * 而它本来就在 `record.difficulty` 里躺着。
   */
  it('人机局标出难度档', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord()) // difficulty: 'easy'
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    const item = (await screen.findAllByTestId(/^record-/))[0]!
    expect(within(item).getByText(/人机 · 初级 · 9 手/)).toBeInTheDocument()
  })

  /**
   * 双人局**不标**难度：那里根本没有 AI，硬写一个「入门」是在编。
   */
  it('双人局不标难度——那时没有 AI 难度可标', async () => {
    const storage = memoryGameRecords()
    await storage.put({ ...nineMoveRecord(), seq: 2, mode: 'pvp' } as GameRecord)
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    const item = (await screen.findAllByTestId(/^record-/))[0]!
    expect(within(item).getByText(/双人 · 9 手/)).toBeInTheDocument()
    expect(within(item).queryByText(/初级|入门|中级|高级|专家/)).not.toBeInTheDocument()
  })
})


// ── ReplayBoard ──────────────────────────────────────────────

let replay: UseBoundStore<StoreApi<ReplayStore>>
const fullRecord = { seq: 1, schemaVersion: 1, ...nineMoveRecord() } as GameRecord

beforeEach(() => {
  replay = createReplayStore()
  // 子页面跟着地址走（`/review/<棋谱号>`），而导航 store 是单例：每条用例从棋谱库开始。
  useNavigationStore.getState().navigate({ page: 'review', sub: null }, { replace: true })
})

describe('GameLibrary —— 时间、分批、删除（阶段 D）', () => {
  it('每局显示下完的时间；没有时间的写「时间未知」，不编造', async () => {
    const storage = memoryGameRecords()
    await storage.put({ ...nineMoveRecord(), createdAt: new Date(2026, 10, 18, 15, 30).getTime() })
    await storage.put({ ...threeMoveRecord(), createdAt: null })
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    const items = await screen.findAllByTestId(/^record-/)
    // 本地时区显示：断言用形状，不写死时区换算后的字面量
    expect(items[1]).toHaveTextContent(/2026-11-18 \d{2}:\d{2}/)
    expect(items[0]).toHaveTextContent('时间未知')
  })

  it('一次只显示 50 局，「再显示」按批追加；5,000 局时首屏也只有 50 条', async () => {
    const storage = memoryGameRecords()
    for (let i = 0; i < 5_000; i++) await storage.put(nineMoveRecord())
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    expect(await screen.findAllByTestId(/^record-/)).toHaveLength(50)
    fireEvent.click(screen.getByRole('button', { name: /再显示 50 局/ }))
    expect(screen.getAllByTestId(/^record-/)).toHaveLength(100)
  })

  it('不足一批时没有「再显示」', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    await screen.findAllByTestId(/^record-/)
    expect(screen.queryByRole('button', { name: /再显示/ })).not.toBeInTheDocument()
  })

  it('删除要二次确认：取消不删；确认后这一局从列表消失，库里也没了', async () => {
    const storage = memoryGameRecords()
    const keep = (await storage.put(threeMoveRecord())).record
    const gone = (await storage.put(nineMoveRecord())).record
    const del = vi.spyOn(storage, 'delete').mockResolvedValue({ persisted: true })
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)
    await screen.findAllByTestId(/^record-/)

    fireEvent.click(screen.getByRole('button', { name: `删除棋谱 ${gone.seq}` }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(del).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: `删除棋谱 ${gone.seq}` }))
    fireEvent.click(screen.getByRole('button', { name: `确认删除棋谱 ${gone.seq}` }))

    await waitFor(() => expect(screen.queryByTestId(`record-${gone.seq}`)).not.toBeInTheDocument())
    expect(del).toHaveBeenCalledWith(gone.seq)
    expect(screen.getByTestId(`record-${keep.seq}`)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已删除')
  })

  it('库不可用、只删了内存里的：如实说「可能仍在」，列表不动', async () => {
    const storage = memoryGameRecords()
    const record = (await storage.put(nineMoveRecord())).record
    vi.spyOn(storage, 'delete').mockResolvedValue({ persisted: false })
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)
    await screen.findAllByTestId(/^record-/)

    fireEvent.click(screen.getByRole('button', { name: `删除棋谱 ${record.seq}` }))
    fireEvent.click(screen.getByRole('button', { name: `确认删除棋谱 ${record.seq}` }))

    expect(await screen.findByRole('alert')).toHaveTextContent('可能仍在')
    expect(screen.getByTestId(`record-${record.seq}`)).toBeInTheDocument()
  })

  it('删除失败：报出原因，列表不动', async () => {
    const storage = memoryGameRecords()
    const record = (await storage.put(nineMoveRecord())).record
    vi.spyOn(storage, 'delete').mockRejectedValue(new Error('棋谱库删除被中止'))
    render(<GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />)
    await screen.findAllByTestId(/^record-/)

    fireEvent.click(screen.getByRole('button', { name: `删除棋谱 ${record.seq}` }))
    fireEvent.click(screen.getByRole('button', { name: `确认删除棋谱 ${record.seq}` }))

    expect(await screen.findByRole('alert')).toHaveTextContent('棋谱库删除被中止')
    expect(screen.getByTestId(`record-${record.seq}`)).toBeInTheDocument()
  })
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

  it('从当前回放手创建分支并把配置交给 store 回调', async () => {
    const storage = memoryGameRecords()
    await storage.put(threeMoveRecord())
    const onStartBranch = vi.fn(() => ({ ok: true } as const))
    const analysis = createAnalysisStore()
    const stopAnalysis = vi.spyOn(analysis.getState(), 'stop')
    render(
      <ReviewScreen
        storage={storage}
        engine={idleEngine()}
        stores={{ replay: createReplayStore(), analysis }}
        onStartBranch={onStartBranch}
      />,
    )
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    fireEvent.change(screen.getByLabelText('回放手数'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '从这里继续对弈' }))
    expect(await screen.findByTestId('branch-dialog')).toHaveTextContent('2 / 3 手')

    fireEvent.change(screen.getByLabelText('分支对弈模式'), { target: { value: 'pvp' } })
    const start = screen.getByRole('button', { name: '开始探索' })
    fireEvent.click(start)
    fireEvent.click(start)

    expect(onStartBranch).toHaveBeenCalledTimes(1)
    expect(onStartBranch).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 2, mode: 'pvp' }),
    )
    expect(stopAnalysis).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByTestId('branch-dialog')).not.toBeInTheDocument(),
    )
  })

  it('分析面板标注引擎档位、预算与版本（结论的出处）', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    const source = await screen.findByTestId('analysis-source')
    expect(source).toHaveTextContent(/ms/)
    expect(source).toHaveTextContent(/引擎 search-1/)

    // §八 点名要有「分数的含义和局限」：没有这句，「分差约 3 子」会被当成精确值
    const caveat = screen.getByTestId('analysis-caveat')
    expect(caveat).toHaveTextContent('不是精确子数')
    expect(caveat).toHaveTextContent('不算分差')
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

describe('ReviewScreen —— 子页面跟着地址走（阶段 C）', () => {
  const nav = () => useNavigationStore.getState()

  it('从列表点开一局：地址变成 /review/<棋谱号>', async () => {
    const storage = memoryGameRecords()
    const { record } = await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)

    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    expect(window.location.pathname).toBe(`/review/${record.seq}`)
  })

  it('直达 /review/<棋谱号>：按号读出那一局直接回放', async () => {
    const storage = memoryGameRecords()
    const { record } = await storage.put(nineMoveRecord())
    nav().navigate({ page: 'review', sub: { kind: 'record', seq: record.seq } }, { replace: true })

    render(<ReviewScreen storage={storage} engine={idleEngine()} />)

    expect(await screen.findByTestId('move-counter')).toHaveTextContent('0 / 9')
  })

  it('地址里的棋谱号不存在：回到棋谱库，地址也换回 /review', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    nav().navigate({ page: 'review', sub: { kind: 'record', seq: 999 } }, { replace: true })

    render(<ReviewScreen storage={storage} engine={idleEngine()} />)

    expect(await screen.findAllByTestId(/^record-/)).not.toHaveLength(0)
    expect(window.location.pathname).toBe('/review')
  })

  it('直达 /review/editor：打开局面编辑器', async () => {
    nav().navigate({ page: 'review', sub: { kind: 'editor' } }, { replace: true })

    render(<ReviewScreen storage={memoryGameRecords()} engine={idleEngine()} />)

    expect(await screen.findByRole('heading', { level: 1, name: '局面研究' })).toBeInTheDocument()
  })

  it('不经按钮离开回放（后退）：停分析、关回放，分支弹窗不带到下一局', async () => {
    const storage = memoryGameRecords()
    const first = (await storage.put(threeMoveRecord())).record
    const second = (await storage.put(nineMoveRecord())).record
    const analysis = createAnalysisStore()
    const stopAnalysis = vi.spyOn(analysis.getState(), 'stop')
    const injectedReplay = createReplayStore()
    render(
      <ReviewScreen
        storage={storage}
        engine={idleEngine()}
        stores={{ replay: injectedReplay, analysis }}
        onStartBranch={() => ({ ok: true }) as const}
      />,
    )
    act(() => nav().navigate({ page: 'review', sub: { kind: 'record', seq: first.seq } }))
    await screen.findByTestId('move-counter')
    fireEvent.click(screen.getByRole('button', { name: '从这里继续对弈' }))
    expect(await screen.findByTestId('branch-dialog')).toBeInTheDocument()
    stopAnalysis.mockClear()

    // 相当于后退：地址直接换走，不经「← 棋谱列表」
    act(() => nav().navigate({ page: 'review', sub: null }, { replace: true }))
    await screen.findAllByTestId(/^record-/)

    expect(stopAnalysis).toHaveBeenCalled()
    expect(injectedReplay.getState().record).toBeNull()

    act(() => nav().navigate({ page: 'review', sub: { kind: 'record', seq: second.seq } }))
    expect(await screen.findByTestId('move-counter')).toHaveTextContent('0 / 9')
    expect(screen.queryByTestId('branch-dialog')).not.toBeInTheDocument()
  })
})

describe('ReviewScreen —— 本阶段新增的几处（Phase 06）', () => {
  it('详情页有一级标题——此前整页只有 h2', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    await screen.findByTestId('move-counter')

    // FINDINGS 的标题表记着这条：复盘回放页「只有 h2 回放 / h2 引擎分析，没有 h1」
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('棋谱回放')
    // 而且**只有**一个一级标题
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('空状态的「开始一局对战」真的会切页面', async () => {
    // 任务书 §二 的原话：「不得渲染只有外观、没有实际效果的按钮」
    const onStartBattle = vi.fn()
    render(
      <GameLibrary
        storage={memoryGameRecords()}
        onOpen={vi.fn()}
        onStartBattle={onStartBattle}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '开始一局对战' }))

    expect(onStartBattle).toHaveBeenCalledTimes(1)
  })

  it('回放棋盘上当前手那一枚编号半径更大，其余保持原样', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    await screen.findByTestId('move-counter')
    // 点击前必须先停在 0——否则下面分不清是「走多了」还是「一开就没归零」
    expect(screen.getByTestId('move-counter')).toHaveTextContent('0 / 9')

    // `data-testid` 挂在标记的 `<g>` 上，半径在它里面那个 `<circle>` 上
    const radii = () =>
      screen
        .getAllByTestId(/^board-mark-/)
        .map((mark) => Number(mark.querySelector('circle')?.getAttribute('r')))

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    // 先把游标钉死，再谈半径——否则半径不对时分不清是"标错了"还是"没走到"
    expect(screen.getByTestId('move-counter')).toHaveTextContent('1 / 9')
    // 走到第 1 手：只有它，且是「当前手」那一档
    expect(radii()).toHaveLength(1)
    const current = radii()[0]!

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    /*
     * 走到第 2 手：新那枚「当前手」与刚才同档，上一枚退回常规档。
     *
     * **数值和关系都要断。** 只断「一大一小」的话，谁把两档都改成默认的 0.4
     * 也不会红——而那等于把「当前手更突出」这件事弄没了。
     * （半径是设计参数，F-UI-14 那轮从 0.26/0.32 调到 0.30/0.34；
     * 所以断言从常量取，而不是把字面量再抄一遍。）
     */
    const [plain, now] = radii()
    expect(now).toBe(current)
    expect(now).toBe(CURRENT_STEP_RADIUS)
    expect(plain).toBe(PLAIN_STEP_RADIUS)
    expect(CURRENT_STEP_RADIUS).toBeGreaterThan(PLAIN_STEP_RADIUS)
  })
})

describe('分析面板 —— 没结论的手不能被说成有结论', () => {
  /*
   * `analysisStore` 在**引擎答「无棋可走」**时会主动跳过两手：那一手没有
   * 可比的首选着法（拼不出结论），而它**前面**那一手的「走完之后」评分
   * 正是这个局面，也拼不出来。store 的注释写着「不给一个编出来的结论」。
   *
   * 面板原先却对「没有结论」一律说「与引擎一致，没有亏损」——store 拒绝
   * 编造，界面替它编了。
   */
  it('没有结论的那一手如实说，不替 store 说成「与引擎一致」', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())

    const injectedReplay = createReplayStore()
    const injectedAnalysis = createAnalysisStore()
    render(
      <ReviewScreen
        storage={storage}
        engine={noMoveAtEngine(5)}
        stores={{ replay: injectedReplay, analysis: injectedAnalysis }}
      />,
    )
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(injectedAnalysis.getState().running).toBe(false))

    // 前提：局面 5 无棋可走 → 手 5 与手 4 都没有结论
    expect(injectedAnalysis.getState().verdicts.has(4)).toBe(false)
    expect(injectedAnalysis.getState().verdicts.has(5)).toBe(false)

    // 把游标拖到第 5 手（那一手没有结论）
    fireEvent.change(screen.getByRole('slider', { name: '回放手数' }), {
      target: { value: '5' },
    })

    const current = screen.getByTestId('analysis-current')
    expect(current).toHaveTextContent('当前第 5 手')
    expect(current).not.toHaveTextContent('与引擎一致，没有亏损。')
  })

  it('后续局面没搜满的手：当前手一行说「未算分差」，榜单里没有它', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())

    const injectedReplay = createReplayStore()
    const injectedAnalysis = createAnalysisStore()
    render(
      <ReviewScreen
        storage={storage}
        engine={scriptedEngine([2])}
        stores={{ replay: injectedReplay, analysis: injectedAnalysis }}
      />,
    )
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(injectedAnalysis.getState().running).toBe(false))

    /*
     * 手 1 的着法与引擎不同，它的分差要比「走完实际着法之后」（局面 2）与
     * 「走完引擎首选之后」（对照）两个评分。局面 2 预算内没搜满——两边可能停在
     * 不同层，相减没有意义。原先这里算出一个数再标「（启发式）」；现在如实说没算。
     */
    fireEvent.change(screen.getByRole('slider', { name: '回放手数' }), {
      target: { value: '2' },
    })
    const current = screen.getByTestId('analysis-current')
    expect(current).toHaveTextContent('当前第 2 手')
    expect(current).toHaveTextContent('未算分差')
    expect(current).not.toHaveTextContent('启发式')

    // 没算出分差的手不是「亏损最多的几手」
    expect(screen.queryByTestId('verdict-1')).not.toBeInTheDocument()
  })
})

describe('ReviewScreen —— 和棋', () => {
  it('满盘和棋：回放状态栏说「和棋」，不说「对局中」', async () => {
    const storage = memoryGameRecords()
    await storage.put(drawRecord())
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)

    // 列表这一行已经说「和棋」了
    const row = (await screen.findAllByTestId(/^record-/))[0]!
    expect(row).toHaveTextContent('和棋')

    fireEvent.click(row)
    await screen.findByTestId('move-counter')

    // 打开时停在空盘，那一帧「对局中」是对的——棋局确实还没走完。
    expect(screen.getByTestId('replay-status')).toHaveTextContent('对局中')

    // 推到终局：这时 `position.status` 才是 `'draw'`。早先这里只认
    // `'won'` 与 `'resigned'`，`'draw'` 落进 else，于是这一页和它上面
    // 那条列表行自相矛盾——列表说「和棋」，回放状态栏说「对局中」。
    fireEvent.click(screen.getByRole('button', { name: '终局' }))

    const status = screen.getByTestId('replay-status')
    expect(status).toHaveTextContent('和棋')
    expect(status).not.toHaveTextContent('对局中')
  })
})

describe('ReviewScreen —— 0 手认输局', () => {
  it('一步都没走，不摆一颗点了没反应的「开始分析」', async () => {
    const storage = memoryGameRecords()
    // `winner` 不用写：`put()` 会按 moves + resignedBy 重算（0 手 + 黑认输 → 白胜）
    await storage.put({
      moves: [],
      firstPlayer: BLACK,
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: BLACK,
    })
    render(<ReviewScreen storage={storage} engine={idleEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    await screen.findByTestId('move-counter')

    // 空盘上没有可分析的手：按钮点下去只会回到原样（`start` 立刻收尾，
    // `verdicts` 仍为空，面板又渲染回这颗按钮）——那就是一颗
    // 「只有外观、没有实际效果」的按钮。
    expect(screen.queryByRole('button', { name: '开始分析' })).not.toBeInTheDocument()
    expect(screen.getByTestId('analysis-empty')).toHaveTextContent('没有落子')
  })
})

describe('ReviewScreen —— 分析失败', () => {
  it('失败要说出来，并给一颗「重新分析」', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={failingEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))

    expect(await screen.findByTestId('analysis-error')).toHaveTextContent('引擎炸了')
    expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument()
  })

  it('换到另一局之后不留着上一局的错误', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    await storage.put(threeMoveRecord())

    render(<ReviewScreen storage={storage} engine={failingEngine()} />)
    // 列表按 seq 降序：先点开的是后存进去的那局
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    await screen.findByTestId('analysis-error')

    // 回列表、换一局
    fireEvent.click(screen.getByRole('button', { name: '← 棋谱列表' }))
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)

    await screen.findByTestId('move-counter')
    expect(screen.queryByTestId('analysis-error')).not.toBeInTheDocument()
  })
})

/** 永不 resolve 的引擎：让「分析中」状态稳定可断言。 */
function idleEngine(): AiEngine {
  return {
    search: () => new Promise(() => {}),
    handleResponse() {},
    handleError() {},
    cancel() {},
    dispose() {},
  }
}

describe('ReviewScreen 离开页面时停掉后台工作', () => {
  it('卸载后分析被停止——不再占着只读 Worker、挡住之后的提示', async () => {
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
    // 手 1 的同视界分差是 500：半子以下不说成「分差约 0 子」
    expect(rows[0]).toHaveTextContent('不足 1 子')
    // 卡片第三行说引擎首选是怎么来的：常规搜索、搜满了
    expect(rows[0]).toHaveTextContent('搜满档位深度')
    expect(screen.queryByTestId('analysis-no-loss')).not.toBeInTheDocument()
  })

  it('分析跑完、榜单为空：说一句没有算出亏损的手，不留一片空白', async () => {
    const storage = memoryGameRecords()
    await storage.put(threeMoveRecord())

    const injectedAnalysis = createAnalysisStore()
    render(
      <ReviewScreen
        storage={storage}
        engine={echoEngine()}
        stores={{ replay: createReplayStore(), analysis: injectedAnalysis }}
      />,
    )
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    // 还没分析：没有榜单可言，也就没有「空榜」
    expect(screen.queryByTestId('analysis-no-loss')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(injectedAnalysis.getState().running).toBe(false))

    expect(screen.queryAllByTestId(/^verdict-/)).toHaveLength(0)
    expect(screen.getByTestId('analysis-no-loss')).toHaveTextContent('这一局没有算出亏损的手。')
  })
})

describe('分析结论列表：空榜说明只在跑完之后出现', () => {
  it('分析进行中不说「没有算出亏损的手」——还没跑完，谈不上有没有', async () => {
    const storage = memoryGameRecords()
    await storage.put(threeMoveRecord())

    render(<ReviewScreen storage={storage} engine={idleEngine()} />)
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))

    expect(screen.getByTestId('analysis-progress')).toHaveTextContent('0 / 3')
    expect(screen.queryByTestId('analysis-no-loss')).not.toBeInTheDocument()
  })
})

/**
 * 分析管线对「着法与引擎首选不同」的手会多发一个**对照请求**（走完引擎首选之后的局面），
 * 它与局面请求的 `moveIndex` 相同。区分办法：局面 i 盘上有 i 颗子，对照有 i + 1 颗。
 */
function isAlternative(request: SearchRequest): boolean {
  const stones = request.board.reduce((count, cell) => (cell === 0 ? count : count + 1), 0)
  return stones === (request.moveIndex ?? 0) + 1
}

/** 每个局面都回棋谱里实际走的那一手：没有任何一手与引擎不同。 */
function echoEngine(): AiEngine {
  return {
    search(request) {
      const index = request.moveIndex ?? 0
      return Promise.resolve({
        requestId: request.requestId,
        gameVersion: request.gameVersion,
        moveIndex: index,
        move: NINE_MOVES[index] ?? { x: 13, y: 13 },
        score: 0,
        depth: 1,
        nodes: 1,
        elapsedMs: 1,
        confidence: 'complete' as const,
        reason: 'search' as const,
        candidates: [],
        urgency: 'normal' as const,
      })
    },
    handleResponse() {},
    handleError() {},
    cancel() {},
    dispose() {},
  }
}

/**
 * 按 moveIndex 给出脚本化响应的引擎：手 0 与引擎首选相同，手 1 走亏。
 * `timeoutAt` 里的**局面**答「预算内没搜满」。
 *
 * 手 1 的分差 = 局面 2 的评分 (0) − 手 1 对照的评分 (−500) = 500。
 * **对照的分数必须按手给**：别的手若也回负数，它们会一起进亏损榜。
 */
function scriptedEngine(timeoutAt: readonly number[] = []): AiEngine {
  return {
    search(request) {
      const index = request.moveIndex ?? 0
      const replies: Record<number, { move: { x: number; y: number }; score: number }> = {
        0: { move: { x: 3, y: 7 }, score: 1_000_000 }, // 捷径：与玩家手 0 相同
        1: { move: { x: 9, y: 9 }, score: 500 }, // 引擎要下 (9,9)，玩家下了别的
        2: { move: { x: 2, y: 2 }, score: 0 },
      }
      const alternative = isAlternative(request)
      const picked = alternative
        ? { move: { x: 13, y: 13 }, score: index === 1 ? -500 : 0 }
        : (replies[index] ?? { move: { x: 2, y: 2 }, score: 0 })
      const timedOut = !alternative && timeoutAt.includes(index)
      return Promise.resolve({
        requestId: request.requestId,
        gameVersion: request.gameVersion,
        moveIndex: index,
        move: picked.move,
        score: picked.score,
        depth: 1,
        nodes: 1,
        elapsedMs: 1,
        confidence: timedOut ? ('partial' as const) : ('complete' as const),
        reason: timedOut ? ('timeout' as const) : ('search' as const),
        candidates: [],
        urgency: 'normal' as const,
      })
    },
    handleResponse() {},
    handleError() {},
    cancel() {},
    dispose() {},
  }
}

describe('GameLibrary —— 读不出棋谱时如实说明', () => {
  /*
   * 这一组原先注入的是一个**会 reject** 的假存储，钉的是「list() 失败就退成空库」。
   *
   * 那条路径在生产里**不可达**——`indexedDbGameRecords` 的每一步失败都落内存兜底、
   * 绝不向上抛，没有任何一个 `list()` 会 reject。于是它守着一个虚构的分支，
   * 而真实的两种「下过棋却看不到」一个都没测到。
   *
   * 现在 `list()` 把这两件事分开报：`degraded`（存储不可用）与
   * `skipped`（读到了但没通过校验）。下面钉的就是界面怎么把它们说出来。
   */
  const skippingStorage: GameRecordsStorage = {
    list: () => Promise.resolve({ records: [], degraded: false, skipped: 2 }),
    get: () => Promise.resolve(null),
    put: () => Promise.reject(new Error('测试里用不到')),
    putReplacing: () => Promise.reject(new Error('测试里用不到')),
    delete: () => Promise.resolve({ persisted: true }),
    importMany: () => Promise.resolve({ imported: 0, duplicates: 0, persisted: true, storage: 'indexeddb' as const }),
  }

  it('存储降级时明说，而不是假装用户没下过棋', async () => {
    render(
      <GameLibrary
        storage={memoryGameRecords(true)}
        onOpen={vi.fn()}
        onStartBattle={vi.fn()}
      />,
    )

    // 空状态的标题还在（探针等的就是它），下面多一句如实的说明
    expect(await screen.findByText('还没有保存的对局')).toBeInTheDocument()
    expect(screen.getByTestId('library-degraded')).toBeInTheDocument()
    expect(screen.queryByText('正在读取棋谱…')).not.toBeInTheDocument()
  })

  it('有记录被跳过时给出条数', async () => {
    render(
      <GameLibrary storage={skippingStorage} onOpen={vi.fn()} onStartBattle={vi.fn()} />,
    )

    const notice = await screen.findByTestId('library-skipped')
    expect(notice).toHaveTextContent('2')
  })

  it('读取还没回来时说「正在读取棋谱…」，不假装成空库', () => {
    // 任务书 §十一.4 要「棋谱**加载**与错误状态」——加载中那一帧此前没有用例，
    // 而它恰恰是最容易被写成「一眼空库」的一帧
    const pending: GameRecordsStorage = {
      list: () => new Promise(() => {}),
      get: () => Promise.resolve(null),
      put: () => Promise.reject(new Error('测试里用不到')),
      putReplacing: () => Promise.reject(new Error('测试里用不到')),
      delete: () => Promise.resolve({ persisted: true }),
      importMany: () => Promise.resolve({ imported: 0, duplicates: 0, persisted: true, storage: 'indexeddb' as const }),
    }

    render(<GameLibrary storage={pending} onOpen={vi.fn()} onStartBattle={vi.fn()} />)

    expect(screen.getByText('正在读取棋谱…')).toBeInTheDocument()
    expect(screen.queryByText('还没有保存的对局')).not.toBeInTheDocument()
  })

  it('库里有棋谱时，降级提示换成对得上事实的措辞', async () => {
    const storage = memoryGameRecords(true)
    await storage.put(nineMoveRecord())

    render(
      <GameLibrary storage={storage} onOpen={vi.fn()} onStartBattle={vi.fn()} />,
    )

    // 列表照常出来
    expect(await screen.findByTestId('record-1')).toBeInTheDocument()
    // 空状态那句不出现，但降级这件事照样要说——而且说的是「下面这些」
    expect(screen.queryByText('还没有保存的对局')).not.toBeInTheDocument()
    expect(screen.getByTestId('library-degraded')).toHaveTextContent('本次会话')
  })
})

/** 一上来就失败的引擎：钉「分析失败」这条路径的界面。 */
function failingEngine(): AiEngine {
  return {
    search: () => Promise.reject(new Error('引擎炸了')),
    handleResponse() {},
    handleError() {},
    cancel() {},
    dispose() {},
  }
}

/**
 * 在第 `nullAt` 号局面回「无棋可走」的引擎。
 *
 * 真实引擎只在**满盘**时这么答（`core` 判 `draw` 的条件），而满盘要 225 手
 * 才造得出来。这里直接让它答，测的是**收到这个应答之后**的行为。
 */
function noMoveAtEngine(nullAt: number): AiEngine {
  return {
    search(request) {
      const index = request.moveIndex ?? 0
      return Promise.resolve({
        requestId: request.requestId,
        gameVersion: request.gameVersion,
        moveIndex: index,
        move: index === nullAt ? null : { x: 9, y: 9 },
        score: 1,
        depth: 1,
        nodes: 1,
        elapsedMs: 1,
        confidence: 'complete' as const,
        reason: 'search' as const,
        candidates: [],
        urgency: 'normal' as const,
      })
    },
    handleResponse() {},
    handleError() {},
    cancel() {},
    dispose() {},
  }
}

/**
 * 满盘和棋的棋谱（225 手，`winner` 为 `null`）。
 *
 * **「和棋」只有这一个来源**：`core` 只在棋盘填满且无人成五时判 `draw`，
 * 不真的填满就造不出这个终局——列表按 `winner === null` 说「和棋」，
 * 回放页则要等 `position.status === 'draw'`。
 *
 * 填充模式 `(x + 2y) % 4 < 2` 与 `core/game.test.ts` 的 `drawOrder()` 同源：
 * 横、竖、两条对角线上的最长同色连续都只有 2，终局不含五连。没有再抽一份
 * 共享 fixture——两处用途不同（那边测 core 的判和规则，这边测界面把和棋
 * 说成什么），而它是个稳定的数学构造。
 */
function drawRecord(): ReplayRecord {
  const black: Point[] = []
  const white: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const side = (x + 2 * y) % 4 < 2 ? black : white
      side.push({ x, y })
    }
  }

  const moves: Point[] = []
  for (let i = 0; i < black.length; i += 1) {
    moves.push(black[i]!)
    const mate = white[i]
    if (mate !== undefined) moves.push(mate)
  }

  return {
    moves,
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: null,
    createdAt: null,
  }
}


/**
 * Phase 09A：规则 / 快速路径确定的着手，不许再显示「搜索完成」。
 *
 * 构造：除手 1 外，引擎推荐都与玩家实际着法相同（loss 0）；手 1 的引擎
 * 推荐不同，且 reason 是 `win`（直接成五的捷径），深度 / 节点都是 0。
 * 结论卡片必须说「规则/快速路径判定」。
 */
function shortcutEngine(): AiEngine {
  return {
    search(request) {
      const index = request.moveIndex ?? 0
      const played = NINE_MOVES[index] ?? { x: 7, y: 7 }
      return Promise.resolve({
        requestId: request.requestId,
        gameVersion: request.gameVersion,
        moveIndex: index,
        move: index === 1 ? { x: 9, y: 9 } : played,
        score: index === 1 ? 500 : 1_000_000,
        // 只有 1 号局面是捷径（深度 0）；其余是搜满一层的常规搜索，夹具要与 `confidenceOf` 自洽
        depth: index === 1 ? 0 : 1,
        nodes: index === 1 ? 0 : 1,
        elapsedMs: 1,
        confidence: index === 1 ? ('shortcut' as const) : ('complete' as const),
        reason: index === 1 ? ('win' as const) : ('search' as const),
        candidates: [],
        urgency: 'normal' as const,
      })
    },
    handleResponse() {},
    handleError() {},
    cancel() {},
    dispose() {},
  }
}

describe('ReviewScreen —— 搜索路径的措辞（Phase 09A）', () => {
  it('规则 / 快速路径判定不说成「搜索完成」', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())
    render(<ReviewScreen storage={storage} engine={shortcutEngine()} />)

    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))

    const card = await screen.findByTestId('verdict-1')
    expect(card).toHaveTextContent('规则/快速路径判定')
    expect(card).not.toHaveTextContent('搜索完成')
    expect(card).not.toHaveTextContent('搜满')
    // 原始度量照常显示：读者能自己看出这一手没展开搜索
    expect(card).toHaveTextContent('深度 0')
    expect(card).toHaveTextContent('节点 0')
  })
})
