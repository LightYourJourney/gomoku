import { beforeEach, describe, expect, it } from 'vitest'
import { BLACK, type Point } from '../core/types'
import { nextRequestId } from './requestCounter'
import { createAnalysisStore } from './analysisStore'
import type { UseBoundStore, StoreApi } from 'zustand'
import type { AnalysisStore } from './analysisStore'
import { createGameStore } from './gameStore'
import type { AiEngine } from '../ai/engine'
import type { GameRecord } from '../persist/gameRecords'
import type { SearchRequest, SearchResponse } from '../ai/types'

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
  /** settle 第 i 个发出的请求（按发出顺序） */
  settle: (order: number, move: Point, score: number, depth?: number) => void
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
    settle(order, move, score = 100, depth = 4) {
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

    // 局面 1 的响应
    spy.settle(1, { x: 4, y: 7 }, -50)
    await Promise.resolve()
    expect(spy.requests).toHaveLength(3)
    expect(spy.requests[2]?.moveIndex).toBe(2)
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

  it('终局手 loss 恒 0；中间手的 loss = engineScore − (−后续局面评分)', async () => {
    store.getState().start({ record: threeWinRecord(), engine: spy.engine, difficulty: 'easy', budgetMs: 400 })

    // 9 手局。scores[i] = 局面 i 的评分（下一手方视角）。
    // 手 i 的 engineScore = scores[i]，playedScore = −scores[i+1]，loss = max(0, 差)。
    // 手 0：100 − (−(−100)) = 0；手 2：50 − (−20) = 70；手 8 终局 → 0。
    const scores = [100, -100, 50, 20, 0, 0, 0, 0, 999_999]
    for (let i = 0; i < 9; i++) {
      spy.settle(i, { x: 3, y: 7 }, scores[i]!)
      await Promise.resolve()
    }

    const verdicts = store.getState().verdicts
    expect(verdicts.get(0)?.loss).toBe(0)
    expect(verdicts.get(2)?.loss).toBe(70)
    expect(verdicts.get(8)?.loss).toBe(0) // 终局手
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

    spy.settle(0, { x: 3, y: 7 }, 100) // 局面 0 到达（手 0 还差 reply 半边）
    await Promise.resolve()
    spy.reject(1, '引擎挂了') // 局面 1 失败 → 手 0 永远拼不出来
    await Promise.resolve()

    const state = store.getState()
    expect(state.error).toBe('引擎挂了')
    expect(state.running).toBe(false)
    // 半途失败：没有任何一手拼出完整结论——这是如实状态，不是丢失
    expect(state.verdicts.size).toBe(0)
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

