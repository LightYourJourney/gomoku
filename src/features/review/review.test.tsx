import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseBoundStore, StoreApi } from 'zustand'
import { BLACK, BOARD_SIZE, type Point } from '../../core/types'
import { createReplayStore, REPLAY_STEP_MS, type ReplayStore } from '../../store/replayStore'
import { createAnalysisStore } from '../../store/analysisStore'
import { memoryGameRecords, type GameRecord, type GameRecordsStorage } from '../../persist/gameRecords'
import type { AiEngine } from '../../ai/engine'
import { GameLibrary } from './GameLibrary'
import { CURRENT_STEP_RADIUS, PLAIN_STEP_RADIUS, ReplayBoard } from './ReplayBoard'
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

    // §八 点名要有「分数的含义和局限」：没有这句，「分差约 3 子」会被当成精确值
    const caveat = screen.getByTestId('analysis-caveat')
    expect(caveat).toHaveTextContent('不是精确子数')
    expect(caveat).toHaveTextContent('启发式')
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

  it('当前手是启发式的就标出来——caveat 指的标签每一处都要有', async () => {
    const storage = memoryGameRecords()
    await storage.put(nineMoveRecord())

    const injectedReplay = createReplayStore()
    const injectedAnalysis = createAnalysisStore()
    render(
      <ReviewScreen
        storage={storage}
        engine={scriptedEngine([1])}
        stores={{ replay: injectedReplay, analysis: injectedAnalysis }}
      />,
    )
    fireEvent.click((await screen.findAllByTestId(/^record-/))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }))
    await waitFor(() => expect(injectedAnalysis.getState().running).toBe(false))

    /*
     * 手 1 的局面请求（局面 1）没搜完。原先 `emit` 只报这一半的 confidence，
     * 而 loss 的另一半来自局面 2——现在取两者较差，这一手整体算启发式。
     * 同时钉住 loss=500 不再说成「分差约 0 子」。
     */
    fireEvent.change(screen.getByRole('slider', { name: '回放手数' }), {
      target: { value: '2' },
    })
    const current = screen.getByTestId('analysis-current')
    expect(current).toHaveTextContent('（启发式）')
    expect(current).toHaveTextContent('不足 1 子')
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
function scriptedEngine(heuristicAt: readonly number[] = []): AiEngine {
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
        confidence: heuristicAt.includes(index) ? ('heuristic' as const) : ('exact' as const),
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
    delete: () => Promise.resolve(),
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
      delete: () => Promise.resolve(),
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
        depth: 0,
        nodes: 0,
        elapsedMs: 1,
        confidence: 'exact' as const,
        reason: index === 1 ? ('win' as const) : ('search' as const),
        candidates: [],
        urgency: 'normal' as const,
      })
    },
    handleResponse() {},
    handleError() {},
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
    // 原始度量照常显示：读者能自己看出这一手没展开搜索
    expect(card).toHaveTextContent('深度 0')
    expect(card).toHaveTextContent('节点 0')
  })
})
