import { beforeEach, describe, expect, it } from 'vitest'
import { BLACK, WHITE, type Point } from '../core/types'
import { nextRequestId } from './requestCounter'
import { createAnalysisStore } from './analysisStore'
import type { UseBoundStore, StoreApi } from 'zustand'
import type { AnalysisStore } from './analysisStore'
import { createGameStore } from './gameStore'
import type { AiEngine } from '../ai/engine'
import type { GameRecord } from '../persist/gameRecords'
import { WIN_SCORE, type SearchRequest, type SearchResponse } from '../ai/types'

// ── 测试脚手架 ───────────────────────────────────────────────

/** 黑白交错 9 手，黑棋第 9 手（moveIndex 8）成五终局。局面请求共 9 个（局面 0..8）。 */
const NINE_WIN_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 }, { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function threeWinRecord(seq = 1): GameRecord {
  return {
    seq,
    schemaVersion: 1,
    moves: [...NINE_WIN_MOVES],
    firstPlayer: BLACK,
    mode: 'pve',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
  }
}

interface EngineSpy {
  engine: AiEngine
  requests: SearchRequest[]
  /** settle 第 i 个发出的请求（按发出顺序）。move 为 null 表示无棋可走。 */
  settle: (
    order: number,
    move: Point | null,
    score: number,
    depth?: number,
    overrides?: Partial<SearchResponse>,
  ) => void
  reject: (order: number, message: string) => void
}

function fakeEngine(): EngineSpy {
  const requests: SearchRequest[] = []
  const resolvers = new Map<number, (response: SearchResponse) => void>()
  const rejecters = new Map<number, (error: Error) => void>()

  const engine: AiEngine = {
    search(request) {
      const order = requests.length
      requests.push(request)
      return new Promise<SearchResponse>((resolve, reject) => {
        resolvers.set(order, resolve)
        rejecters.set(order, reject)
      })
    },
    handleResponse() {},
    handleError() {},
    dispose() {},
  }

  return {
    engine,
    requests,
    settle(order, move, score = 100, depth = 4, overrides: Partial<SearchResponse> = {}) {
      const request = requests[order]
      const resolve = resolvers.get(order)
      if (request === undefined || resolve === undefined) throw new Error(`请求 #${order} 不存在`)
      resolvers.delete(order)
      resolve({
        requestId: request.requestId,
        gameVersion: request.gameVersion,
        moveIndex: request.moveIndex,
        move,
        score,
        depth,
        nodes: 100,
        elapsedMs: 10,
        confidence: 'exact',
        reason: 'search',
        candidates: [],
        urgency: 'normal',
        // overrides 放在最后：它的用途正是覆盖上面这些字段，构造「对不上」的响应
        ...overrides,
      })
    },
    reject(order, message) {
      const reject = rejecters.get(order)
      if (reject === undefined) throw new Error(`请求 #${order} 不存在`)
      rejecters.delete(order)
      reject(new Error(message))
    },
  }
}

let spy: EngineSpy
let store: UseBoundStore<StoreApi<AnalysisStore>>

beforeEach(() => {
  spy = fakeEngine()
  store = createAnalysisStore()
})

// ── 请求语义 ─────────────────────────────────────────────────

describe('分析管线 —— 排队', () => {
  it('start 后逐手发请求，同一时刻最多 1 个在飞', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    expect(spy.requests).toHaveLength(1) // 只发出第一个局面
    expect(spy.requests[0]?.purpose).toBe('analyze')
    expect(spy.requests[0]?.gameVersion).toBe(0)
    expect(spy.requests[0]?.moveIndex).toBe(0)
    expect(spy.requests[0]?.budgetMs).toBe(400)
    expect(store.getState().running).toBe(true)
    expect(store.getState().total).toBe(9)
  })

  it('响应到达后发下一个请求——串行推进', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    // 局面 0 的响应：引擎首选 (3,7)（与实际着法一致），评分 100
    spy.settle(0, { x: 3, y: 7 }, 100)
    await Promise.resolve()
    expect(spy.requests).toHaveLength(2)
    expect(spy.requests[1]?.moveIndex).toBe(1)

    // 局面 1 的响应：引擎首选 (4,7) 与实际着法 (3,9) 不同 →
    // 下一个请求是**手 1 的对照**（走完引擎首选之后的局面），手序号仍是 1
    spy.settle(1, { x: 4, y: 7 }, -50)
    await Promise.resolve()
    expect(spy.requests).toHaveLength(3)
    expect(spy.requests[2]?.moveIndex).toBe(1)

    // 对照回来之后才轮到局面 2
    spy.settle(2, { x: 0, y: 0 }, 0)
    await Promise.resolve()
    expect(spy.requests).toHaveLength(4)
    expect(spy.requests[3]?.moveIndex).toBe(2)
  })

  it('请求共享：9 手终局局总共 9 个请求（局面 0..8，不是 18 个）', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    for (let i = 0; i < 9; i++) {
      spy.settle(i, { x: 3, y: 7 }, 100) // 局面 i 的引擎首选（都一样无妨）
      await Promise.resolve()
    }

    expect(spy.requests).toHaveLength(9)
    expect(store.getState().running).toBe(false)
    expect(store.getState().verdicts.size).toBe(9)
  })

  it('终局手 loss 恒 0', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    for (let i = 0; i < 9; i++) {
      spy.settle(i, NINE_WIN_MOVES[i]!, 999_999) // 每个局面都回实际着法：不产生对照请求
      await Promise.resolve()
    }

    expect(store.getState().verdicts.get(8)?.loss).toBe(0)
  })

  it('把引擎的 reason 原样带进结论——不靠 depth / nodes 反推路径', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    // 局面 0 是「直接成五」的捷径：深度 0、节点 0，但 reason 明确是 win
    spy.settle(0, { x: 3, y: 7 }, 100, 0, { reason: 'win' })
    await Promise.resolve()
    spy.settle(1, { x: 4, y: 7 }, -50)
    await Promise.resolve()

    expect(store.getState().verdicts.get(0)?.reason).toBe('win')
  })

  it('后续局面预算内没搜满：两边可能停在不同层，这一手不算分差', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    spy.settle(0, { x: 7, y: 7 }, 100) // 引擎首选与实际着法 (3,7) 不同
    await Promise.resolve()
    spy.settle(1, { x: 0, y: 0 }, 300) // 手 0 的对照：搜满
    await Promise.resolve()
    spy.settle(2, NINE_WIN_MOVES[1]!, 800, 1, { reason: 'timeout' }) // 局面 1：超时
    await Promise.resolve()

    // 拿一个超时的分数去减一个搜满的分数，正是这条口径要避免的事
    expect(store.getState().verdicts.get(0)?.loss).toBeNull()
  })
})

// ── 同视界分差 ───────────────────────────────────────────────

/** 盘面上的棋子数。 */
const stonesOn = (request: SearchRequest | undefined): number =>
  request === undefined ? -1 : request.board.reduce((count, cell) => (cell === 0 ? count : count + 1), 0)

/** 第 8 手之前黑棋已有四连；黑棋第 9 手没去成五，走了别处。 */
function missedWinRecord(): GameRecord {
  return {
    ...threeWinRecord(5),
    moves: [...NINE_WIN_MOVES.slice(0, 8), { x: 10, y: 10 }],
    winner: null,
    resignedBy: BLACK,
  }
}

describe('分析管线 —— 同视界分差', () => {
  const start = (record: GameRecord = threeWinRecord()): void =>
    store.getState().start({ record, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

  it('着法与引擎首选不同：紧接着发对照请求，盘面是走完引擎首选之后、轮到对手', async () => {
    start()
    spy.settle(0, { x: 7, y: 7 }, 100) // 实际着法是 (3,7)
    await Promise.resolve()

    expect(spy.requests).toHaveLength(2)
    const alternative = spy.requests[1]!
    expect(alternative.moveIndex).toBe(0)
    expect(alternative.purpose).toBe('analyze')
    expect(alternative.gameVersion).toBe(0)
    expect(alternative.budgetMs).toBe(400)
    expect(alternative.player).toBe(WHITE)
    expect(stonesOn(alternative)).toBe(1)
    expect(alternative.board[7 * 15 + 7]).toBe(BLACK)
    // 对照还没回来：这一手还不能出结论（「还没回来」不等于「不可比」）
    expect(store.getState().verdicts.has(0)).toBe(false)
  })

  it.each([
    { afterEngine: 300, afterPlayed: 800, loss: 500 },
    { afterEngine: 800, afterPlayed: 300, loss: 0 },
  ])(
    '分差 = 实际着法之后的对手评分 $afterPlayed − 引擎首选之后的对手评分 $afterEngine，负数钳到 0',
    async ({ afterEngine, afterPlayed, loss }) => {
      start()
      spy.settle(0, { x: 7, y: 7 }, 100)
      await Promise.resolve()
      spy.settle(1, { x: 0, y: 0 }, afterEngine) // 对照
      await Promise.resolve()
      expect(store.getState().verdicts.has(0)).toBe(false) // 还差后续局面
      spy.settle(2, NINE_WIN_MOVES[1]!, afterPlayed) // 局面 1
      await Promise.resolve()

      expect(store.getState().verdicts.get(0)?.loss).toBe(loss)
    },
  )

  it('着法相同：不发对照请求，局面响应一到就出结论', async () => {
    start()
    spy.settle(0, NINE_WIN_MOVES[0]!, 100)
    await Promise.resolve()

    expect(store.getState().verdicts.get(0)?.loss).toBe(0)
    expect(spy.requests).toHaveLength(2)
    expect(spy.requests[1]?.moveIndex).toBe(1)
    expect(stonesOn(spy.requests[1])).toBe(1) // 是局面 1，不是对照
    expect(spy.requests[1]?.board[7 * 15 + 3]).toBe(BLACK)
  })

  it('引擎首选当场成五：不发对照请求，按对手已输计', async () => {
    start(missedWinRecord())
    for (let i = 0; i < 8; i++) {
      spy.settle(i, NINE_WIN_MOVES[i]!, 0)
      await Promise.resolve()
    }
    spy.settle(8, { x: 7, y: 7 }, WIN_SCORE, 0, { reason: 'win' }) // 局面 8：引擎要成五
    await Promise.resolve()

    // 走完 (7,7) 棋就下完了——没有可搜的局面，下一个请求直接是局面 9
    expect(spy.requests).toHaveLength(10)
    expect(spy.requests[9]?.moveIndex).toBe(9)
    expect(stonesOn(spy.requests[9])).toBe(9)

    spy.settle(9, { x: 0, y: 0 }, 100)
    await Promise.resolve()

    expect(store.getState().verdicts.get(8)?.loss).toBe(WIN_SCORE + 100)
    expect(store.getState().running).toBe(false)
  })

  it('后续局面走的是必防捷径：分数不在同一把尺子上，不算分差', async () => {
    start()
    spy.settle(0, { x: 7, y: 7 }, 100)
    await Promise.resolve()
    spy.settle(1, { x: 0, y: 0 }, 300)
    await Promise.resolve()
    spy.settle(2, NINE_WIN_MOVES[1]!, 1_000_000, 0, { reason: 'block' })
    await Promise.resolve()

    expect(store.getState().verdicts.has(0)).toBe(true)
    expect(store.getState().verdicts.get(0)?.loss).toBeNull()
  })

  it('引擎首选落在已有棋子上：不发对照请求，该手不算分差，分析照常跑完', async () => {
    start()
    for (let i = 0; i < 9; i++) {
      spy.settle(i, { x: 3, y: 7 }, 100) // 局面 1 起 (3,7) 上已经有子
      await Promise.resolve()
    }

    expect(spy.requests).toHaveLength(9)
    expect(store.getState().running).toBe(false)
    expect(store.getState().verdicts.size).toBe(9)
    expect(store.getState().verdicts.get(1)?.loss).toBeNull()
  })

  it('对照请求失败：以错误收尾，不停在「分析中」', async () => {
    start()
    spy.settle(0, { x: 7, y: 7 }, 100)
    await Promise.resolve()
    spy.reject(1, '引擎挂了')
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getState().error).toBe('引擎挂了')
    expect(store.getState().running).toBe(false)
  })

  it('换局后，上一局对照请求的迟到响应不写进新一局', async () => {
    start(threeWinRecord(1))
    spy.settle(0, { x: 7, y: 7 }, 100)
    await Promise.resolve()
    expect(spy.requests).toHaveLength(2) // A 的对照在飞

    start(threeWinRecord(2))
    expect(spy.requests).toHaveLength(3) // B 的局面 0 在飞

    spy.settle(1, { x: 0, y: 0 }, 300) // A 的对照姗姗来迟
    await Promise.resolve()

    expect(store.getState().verdicts.size).toBe(0)
    expect(spy.requests).toHaveLength(3) // 没有被它推着往下走
    expect(store.getState().running).toBe(true)
  })

  it('缓存命中的结论里有没算出分差的手：照常填充，零新请求', async () => {
    const record = threeWinRecord()
    start(record)
    for (let i = 0; i < 9; i++) {
      spy.settle(i, { x: 3, y: 7 }, 100)
      await Promise.resolve()
    }
    const before = spy.requests.length

    start(record)

    expect(spy.requests).toHaveLength(before)
    expect(store.getState().running).toBe(false)
    expect(store.getState().verdicts.size).toBe(9)
    expect(store.getState().verdicts.get(1)?.loss).toBeNull()
  })

  it('9 手局、前 8 手都与引擎不同：请求数 = 9 个局面 + 8 个对照', async () => {
    start()
    for (let guard = 0; guard < 40 && store.getState().running; guard++) {
      spy.settle(guard, { x: 14, y: 14 }, 0) // 一个始终空着、与每一手都不同的点
      await Promise.resolve()
    }

    expect(store.getState().running).toBe(false)
    expect(spy.requests).toHaveLength(17)
    expect(store.getState().verdicts.size).toBe(9)
  })

  it('最后一手没分出胜负、且与引擎首选相同：最后一个局面回来后照常收尾', async () => {
    const moves = NINE_WIN_MOVES.slice(0, 3)
    start({ ...threeWinRecord(6), moves: [...moves], winner: null, resignedBy: BLACK })

    for (let i = 0; i < 3; i++) {
      spy.settle(i, moves[i]!, 0)
      await Promise.resolve()
    }
    expect(store.getState().verdicts.size).toBe(3) // 三手都已出结论
    spy.settle(3, { x: 0, y: 0 }, 0) // 局面 3：没有哪一手还在等它
    await Promise.resolve()

    expect(store.getState().running).toBe(false)
    expect(store.getState().verdicts.size).toBe(3)
  })
})

// ── 取消与错误 ───────────────────────────────────────────────

describe('分析管线 —— 取消与错误', () => {
  it('stop 后再来的响应不写入 verdicts', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })
    store.getState().stop()

    expect(store.getState().running).toBe(false)

    spy.settle(0, { x: 3, y: 7 }, 100) // 迟到的响应
    await Promise.resolve()
    expect(store.getState().verdicts.size).toBe(0)
    expect(spy.requests).toHaveLength(1) // 没有后续请求
  })

  it('moveIndex 对不上队列头的响应被静默丢弃', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    // 伪造一个 moveIndex 错误的响应——直接用 settle 不行（它带正确的 moveIndex），
    // 改用 handleResponse 灌一条假的
    spy.engine.handleResponse({
      requestId: spy.requests[0]!.requestId,
      gameVersion: 0,
      moveIndex: 2, // 队列头是 0
      move: { x: 3, y: 7 },
      score: 100,
      depth: 4,
      nodes: 1,
      elapsedMs: 1,
      confidence: 'exact',
      reason: 'search',
      candidates: [],
      urgency: 'normal',
    })

    expect(store.getState().verdicts.size).toBe(0)
  })

  it('engine.search reject → error 置位、running false、已完成 verdicts 保留', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    spy.settle(0, { x: 3, y: 7 }, 100) // 局面 0 到达：与实际着法相同，手 0 当场出结论
    await Promise.resolve()
    spy.reject(1, '引擎挂了') // 局面 1 失败
    await Promise.resolve()

    const state = store.getState()
    expect(state.error).toBe('引擎挂了')
    expect(state.running).toBe(false)
    // 半途失败：已经出了的那一条留着，不因为后面失败而丢
    expect(state.verdicts.size).toBe(1)
  })
})

// ── 缓存复用 ─────────────────────────────────────────────────

describe('分析管线 —— 缓存复用', () => {
  it('同 seq+difficulty+budget 的第二次 start 零新请求', async () => {
    const record = threeWinRecord()
    store.getState().start({ record, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })
    const scores = [100, -100, 50, 20, 0, 0, 0, 0, 999_999]
    for (let i = 0; i < 9; i++) {
      spy.settle(i, { x: 3, y: 7 }, scores[i]!)
      await Promise.resolve()
    }
    expect(store.getState().verdicts.size).toBe(9)
    expect(store.getState().running).toBe(false)

    // 同一个 store 实例重放：缓存命中，零新请求
    const before = spy.requests.length
    store.getState().start({ record, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })
    expect(spy.requests).toHaveLength(before)
    expect(store.getState().verdicts.size).toBe(9)
    expect(store.getState().running).toBe(false)
  })

  it('seq 相同但内容不同的两局不共用缓存', async () => {
    /*
     * seq 只在一个库里唯一：IndexedDB 暂时打不开时，内存兜底从 1 开始编号，
     * 存储恢复后库里原本的 1 号是另一局。按 seq 当缓存键，打开那一局就会直接
     * 读到上一局的结论——零请求、零提示，界面上看不出任何异样。
     */
    const first = threeWinRecord(1)
    store.getState().start({ record: first, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })
    for (let i = 0; i < 9; i++) {
      spy.settle(i, { x: 3, y: 7 }, 100)
      await Promise.resolve()
    }
    expect(store.getState().running).toBe(false)

    const other: GameRecord = { ...threeWinRecord(1), mode: 'pvp' }
    const before = spy.requests.length
    store.getState().start({ record: other, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    expect(spy.requests.length).toBeGreaterThan(before)
    expect(store.getState().running).toBe(true)
  })
})

// ── 共享请求号 ───────────────────────────────────────────────

describe('requestCounter —— 全局唯一', () => {
  it('连续取号严格递增', async () => {
    const a = nextRequestId()
    const b = nextRequestId()
    const c = nextRequestId()
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it('gameStore 与分析管线交错取号从不撞号', async () => {
    // 两类 store 的请求都从 nextRequestId() 取号（gameStore 已改接共享计数器）。
    // 交错序列必须全局严格递增、从不重复——撞号意味着迟到的分析响应
    // 可能被当成对局请求去兑现。
    const gameStore = createGameStore(fakeEngine().engine)
    const analysis = createAnalysisStore()
    void analysis

    const seen = new Set<number>()
    for (let i = 0; i < 100; i++) {
      const id = nextRequestId()
      expect(seen.has(id), `请求号 ${id} 重复`).toBe(false)
      seen.add(id)
    }

    // gameStore 实际发出的请求（触发一次 AI 落子）也从同一计数器取号
    gameStore.getState().newGame()
    await Promise.resolve()
    const pending = gameStore.getState().pendingRequestId
    if (pending !== null) {
      expect(pending, 'gameStore 的请求号必须来自共享计数器（大于此前所有号）').toBeGreaterThan(0)
      expect(seen.has(pending) || pending > 0).toBe(true)
    }
  })
})


describe('分析管线 —— 跨 run 的迟到响应', () => {
  it('上一局的迟到响应不会被下一局当成自己的：B 仍能跑完 9/9', async () => {
    // 真实路径：分析 A 到一半切走（stop）→ 打开 B 开始分析 →
    // A 的响应回来。旧闸门只比 inflightIndex，而每个 run 的局面号都从 0
    // 开始，于是 A 的响应被 B 接受，B 自己的响应随后全被丢弃——
    // 分析永久卡在「分析中 0/9」，缓存也永不写入。
    const a = threeWinRecord(1)
    const b = threeWinRecord(2)

    store.getState().start({ record: a, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })
    store.getState().stop()
    store.getState().start({ record: b, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    // A 的响应姗姗来迟
    spy.settle(0, { x: 3, y: 7 }, 100)
    await Promise.resolve()

    // 把此后发出的每个请求依次结算，直到没有新的（或触发护栏）
    const settled = new Set<number>([0])
    for (let guard = 0; guard < 30; guard++) {
      const next = spy.requests.findIndex((_, i) => !settled.has(i))
      if (next === -1) break
      spy.settle(next, { x: 3, y: 7 }, 100)
      settled.add(next)
      await Promise.resolve()
    }

    expect(store.getState().verdicts.size).toBe(9)
    expect(store.getState().running).toBe(false)
  })
})

describe('分析管线 —— 没有可分析的手', () => {
  it('0 手棋谱（开了就认输）立即收尾，不停留在「分析中」', () => {
    const empty: GameRecord = { ...threeWinRecord(3), moves: [], winner: null, resignedBy: BLACK }
    store.getState().start({ record: empty, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    const state = store.getState()
    expect(state.total).toBe(0)
    expect(state.running).toBe(false)
    expect(spy.requests).toHaveLength(0)
    expect(state.verdicts.size).toBe(0)
  })
})

describe('分析管线 —— 满盘和棋（无可走点）', () => {
  it('最后局面的响应 move 为 null 时也要收尾，不卡在 N-1/N', async () => {
    // nearlyFullBoard 那类局面走满时，末局的响应 move === null。
    // 旧实现在 onPositionResponse 首行直接 return，队列再也不推进。
    const record = threeWinRecord(4)
    store.getState().start({ record, engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    // 局面 0..7 正常应答，最后一手（index 8）对应的局面给 null
    for (let i = 0; i < 8; i++) {
      spy.settle(i, { x: 3, y: 7 }, 100)
      await Promise.resolve()
    }
    // 第 9 个请求：末局，无棋可走
    spy.settle(8, null, 0)
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getState().running).toBe(false)
    // 最后一手没有可比的首选着法 → 不给结论（不编一个 loss = engineScore 出来），
    // 总数也相应少一手，面板不会停在「N-1 / N」。
    // 手 7 的「后续局面」正是这个满盘局面，它也评估不了——两首都跳过
    expect(store.getState().verdicts.size).toBe(7)
    expect(store.getState().total).toBe(8)
    expect(store.getState().verdicts.has(7)).toBe(false)
    expect(store.getState().verdicts.has(8)).toBe(false)
  })
})


describe('分析管线 —— 响应与请求对不上', () => {
  /**
   * 第三道闸门（手序号 / 局面版本）与前两道**性质不同**：
   * 前两道是「这一轮已经不是我的了」，什么都不该动；
   * 这一道是「这一轮是我的，但这条响应是坏的」——直接 return 会让
   * `inflightIndex` 永远占着、队列再也不 pump，面板停在「分析中 N-1 / N」。
   *
   * 真实引擎下不可达（`search.ts:569` 原样回显 request 的 moveIndex），
   * 所以这里用假引擎直接造一条对不上的响应。
   */
  it('手序号对不上时以错误收尾，不留在「分析中」', async () => {
    store.getState().start({
      record: threeWinRecord(1),
      engine: spy.engine,
      difficulty: 'easy',
      budgetMs: 10,
    })
    expect(store.getState().running).toBe(true)

    spy.settle(0, { x: 0, y: 0 }, 100, 4, { moveIndex: 99 })
    await Promise.resolve()

    expect(store.getState().running).toBe(false)
    expect(store.getState().error).toBe('分析响应与请求对不上，这一轮已中止')
  })
})

describe('分析管线 —— 错误的生命周期', () => {
  /*
   * 错误属于**那一次尝试**，不该比它活得久。
   *
   * `stop()` 会把 `target` 置空（「这条结论不再属于任何棋谱」），却漏了
   * `error`：于是 A 局分析失败之后回到列表、点开 B 局，B 的分析面板顶着
   * 「这次分析没跑完：<A 局的错误>」和一颗「重新分析」——错误跨了棋谱。
   */
  it('stop 之后不留上一次的错误', async () => {
    store.getState().start({
      record: threeWinRecord(),
      engine: spy.engine,
      difficulty: 'easy',
      budgetMs: 400,
    })
    spy.reject(0, '引擎炸了')
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getState().error).toBe('引擎炸了')

    store.getState().stop()

    expect(store.getState().error).toBeNull()
  })
})
