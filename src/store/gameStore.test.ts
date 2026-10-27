import { beforeEach, describe, expect, it } from 'vitest'
import type { AiEngine } from '../ai/engine'
import type { MoveSuggestion, SearchRequest, SearchResponse } from '../ai/types'
import { idx } from '../core/board'
import { BLACK, WHITE, type Point } from '../core/types'
import { memoryGameRecords, type GameRecord } from '../persist/gameRecords'
import { recordContentKey } from '../persist/recordIdentity'
import { SCHEMA_VERSION, type PersistedSession } from '../persist/storage'
import { createGame, resign } from '../core/game'
import {
  canHumanPlay,
  canUndo,
  createGameStore,
  shouldAiMove,
  undoPlies,
  type GameStore,
} from './gameStore'

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function makeResponse(requestId: number, gameVersion: number, move: Point | null): SearchResponse {
  return {
    requestId,
    gameVersion,
    move,
    score: 0,
    depth: 2,
    nodes: 10,
    elapsedMs: 5,
    confidence: 'exact',
    reason: 'search',
    candidates: [],
    urgency: 'normal',
  }
}

/** 可以精确控制何时应答的假引擎，用来构造各种「响应迟到」的时序。 */
class FakeEngine implements AiEngine {
  readonly requests: SearchRequest[] = []
  private readonly pending = new Map<
    number,
    { resolve: (response: SearchResponse) => void; reject: (error: Error) => void }
  >()

  search(request: SearchRequest): Promise<SearchResponse> {
    this.requests.push(request)
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject })
    })
  }

  handleResponse(): void {}
  handleError(): void {}
  dispose(): void {}

  get lastRequest(): SearchRequest {
    const request = this.requests[this.requests.length - 1]
    if (request === undefined) throw new Error('引擎还没有收到任何请求')
    return request
  }

  /** 按最近一次请求的 requestId / gameVersion 正常应答。 */
  reply(move: Point | null, overrides: Partial<SearchResponse> = {}): void {
    const request = this.lastRequest
    this.respond({
      ...makeResponse(request.requestId, request.gameVersion, move),
      ...overrides,
    })
  }

  /** 用任意响应兑现最近一次请求，用来构造 requestId 或 gameVersion 对不上的迟到响应。 */
  respond(response: SearchResponse): void {
    this.respondTo(this.lastRequest.requestId, response)
  }

  /**
   * 按 requestId 指名兑现某一次请求。
   *
   * 提示请求与落子请求可以同时在飞，此时「最近一次请求」指向谁并不确定，
   * 必须能指名道姓地应答。
   */
  respondTo(requestId: number, response: SearchResponse): void {
    const entry = this.pending.get(requestId)
    if (entry === undefined) throw new Error(`请求 ${requestId} 已经不在挂起列表里`)
    this.pending.delete(requestId)
    entry.resolve(response)
  }

  /** 按 requestId 指名让某一次请求失败。 */
  failTo(requestId: number, error: Error): void {
    const entry = this.pending.get(requestId)
    if (entry === undefined) throw new Error(`请求 ${requestId} 不在挂起列表里`)
    this.pending.delete(requestId)
    entry.reject(error)
  }

  fail(error: Error): void {
    const request = this.lastRequest
    const entry = this.pending.get(request.requestId)
    if (entry === undefined) throw new Error(`请求 ${request.requestId} 不在挂起列表里`)
    this.pending.delete(request.requestId)
    entry.reject(error)
  }

  async flush(): Promise<void> {
    await flush()
  }
}

let engine: FakeEngine
let store: ReturnType<typeof createGameStore>

function state(): GameStore {
  return store.getState()
}

beforeEach(() => {
  engine = new FakeEngine()
  store = createGameStore(engine)
})

describe('初始状态', () => {
  it('默认为人机对战、玩家执黑、黑先', () => {
    expect(state().mode).toBe('pve')
    expect(state().humanColor).toBe(BLACK)
    expect(state().game.current).toBe(BLACK)
    expect(state().game.moves).toHaveLength(0)
    expect(state().aiThinking).toBe(false)
  })

  it('玩家执黑时开局不会自动请求 AI', () => {
    expect(engine.requests).toHaveLength(0)
  })
})

describe('playHuman', () => {
  it('玩家回合点击空位立即落子并切换到 AI', () => {
    state().playHuman({ x: 7, y: 7 })

    expect(state().game.moves).toEqual([{ x: 7, y: 7 }])
    expect(state().game.board[idx(7, 7)]).toBe(BLACK)
    expect(state().game.current).toBe(WHITE)
  })

  it('落子后自动向引擎发起请求，并带上当时的棋局版本', () => {
    state().playHuman({ x: 7, y: 7 })

    expect(engine.requests).toHaveLength(1)
    expect(engine.requests[0]!.player).toBe(WHITE)
    expect(engine.requests[0]!.gameVersion).toBe(1)
    expect(state().aiThinking).toBe(true)
  })

  it('AI 思考期间玩家的点击被忽略', () => {
    state().playHuman({ x: 7, y: 7 })
    state().playHuman({ x: 8, y: 8 })

    expect(state().game.moves).toHaveLength(1)
    expect(state().game.board[idx(8, 8)]).toBe(0)
  })

  it('点击已占用的位置不改变棋局', () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply({ x: 0, y: 0 })

    return engine.flush().then(() => {
      state().playHuman({ x: 7, y: 7 })
      expect(state().game.moves).toHaveLength(2)
    })
  })

  it('终局之后点击无效', () => {
    store.setState({ mode: 'pvp' })
    const winning: Point[] = [
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 7, y: 7 },
    ]
    for (const move of winning) state().playHuman(move)

    expect(state().game.status).toBe('won')

    state().playHuman({ x: 10, y: 10 })
    expect(state().game.moves).toHaveLength(9)
  })

  it('本地双人模式下黑白轮流落子，不触发 AI', () => {
    state().newGame({ mode: 'pvp' })

    state().playHuman({ x: 7, y: 7 })
    expect(state().game.current).toBe(WHITE)

    state().playHuman({ x: 8, y: 8 })
    expect(state().game.current).toBe(BLACK)
    expect(engine.requests).toHaveLength(0)
  })
})

describe('AI 应手', () => {
  it('AI 落子后恢复玩家回合，思考状态归零', () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply({ x: 0, y: 0 })

    return engine.flush().then(() => {
      expect(state().game.moves).toEqual([
        { x: 7, y: 7 },
        { x: 0, y: 0 },
      ])
      expect(state().game.current).toBe(BLACK)
      expect(state().aiThinking).toBe(false)
      expect(state().aiInfo).toMatchObject({ depth: 2, nodes: 10 })
    })
  })

  /*
   * `no_move`（棋盘已满）这一档**到不了面板**：`requestAiMove` 在写 `aiInfo` 之前
   * 就把它挡掉了。`AiInfo.move` 因此能声明成 `Point` 而不是 `Point | null`，
   * 面板也不必防一个不会发生的 null（判据：AiPanel 里那条 `info.move !== null` 分支
   * 是纸面防御，已删）。
   *
   * 这条用例钉住的是那道闸门本身。闸门被删掉时，这里会红——
   * 而不是等到界面上真的冒出一个编出来的坐标。
   */
  it('引擎给出 move: null（无棋可走）时不写 aiInfo', () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply(null, { reason: 'no_move' })

    return engine.flush().then(() => {
      expect(state().aiInfo).toBeNull()
      // 但也不能把对局卡在「AI 思考中」
      expect(state().aiThinking).toBe(false)
    })
  })

  it('引擎报错时给出提示，并且不把对局卡在思考状态', () => {
    state().playHuman({ x: 7, y: 7 })
    engine.fail(new Error('Worker 挂了'))

    return engine.flush().then(() => {
      expect(state().aiError).toContain('Worker 挂了')
      expect(state().aiThinking).toBe(false)
    })
  })

  it('错误提示可以被手动关掉', () => {
    state().playHuman({ x: 7, y: 7 })
    engine.fail(new Error('Worker 挂了'))

    return engine.flush().then(() => {
      state().dismissAiError()
      expect(state().aiError).toBeNull()
    })
  })

  it('AI 返回空着法时不改变棋局', () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply(null)

    return engine.flush().then(() => {
      expect(state().game.moves).toHaveLength(1)
      expect(state().aiThinking).toBe(false)
    })
  })
})

describe('过期与不匹配的 AI 响应', () => {
  it('重新开始之后迟到的响应被丢弃', async () => {
    state().playHuman({ x: 7, y: 7 })
    const staleRequestId = engine.lastRequest.requestId

    state().newGame()
    engine.respond(makeResponse(staleRequestId, 1, { x: 0, y: 0 }))
    await engine.flush()

    expect(state().game.moves).toHaveLength(0)
  })

  it('悔棋之后迟到的响应被丢弃', async () => {
    state().playHuman({ x: 7, y: 7 })
    const staleRequestId = engine.lastRequest.requestId

    state().undoMove()
    engine.respond(makeResponse(staleRequestId, 1, { x: 0, y: 0 }))
    await engine.flush()

    expect(state().game.moves).toHaveLength(0)
  })

  it('gameVersion 与当前棋局不一致的响应被丢弃', async () => {
    state().playHuman({ x: 7, y: 7 })
    const requestId = engine.lastRequest.requestId

    // 版本对不上：模拟响应发出后棋局又被改过。
    engine.respond(makeResponse(requestId, 99, { x: 0, y: 0 }))
    await engine.flush()

    expect(state().game.moves).toHaveLength(1)
  })

  it('requestId 对不上的响应被丢弃', async () => {
    state().playHuman({ x: 7, y: 7 })
    const requestId = engine.lastRequest.requestId

    engine.respond(makeResponse(requestId + 1000, 1, { x: 0, y: 0 }))
    await engine.flush()

    expect(state().game.moves).toHaveLength(1)
    expect(state().aiThinking).toBe(true)
  })
})

describe('shouldAiMove', () => {
  it('人机模式下轮到 AI 时为真', () => {
    state().playHuman({ x: 7, y: 7 })

    expect(shouldAiMove({ game: state().game, mode: 'pve', humanColor: BLACK })).toBe(true)
  })

  it('轮到玩家时为假', () => {
    expect(shouldAiMove({ game: state().game, mode: 'pve', humanColor: BLACK })).toBe(false)
  })

  it('本地双人模式恒为假', () => {
    state().newGame({ mode: 'pvp' })
    state().playHuman({ x: 7, y: 7 })

    expect(shouldAiMove({ game: state().game, mode: 'pvp', humanColor: BLACK })).toBe(false)
  })

  it('对局结束后为假', () => {
    expect(shouldAiMove({ game: resign(createGame(), BLACK), mode: 'pve', humanColor: BLACK })).toBe(
      false,
    )
  })

  it('对局进行中时与 canHumanPlay 互补', () => {
    const pick = () => ({ game: state().game, mode: state().mode, humanColor: state().humanColor })
    const humanTurn = pick()
    state().playHuman({ x: 7, y: 7 })
    const aiTurn = pick()

    for (const candidate of [humanTurn, aiTurn]) {
      expect(candidate.game.status).toBe('playing')
      expect(shouldAiMove(candidate)).toBe(!canHumanPlay({ ...candidate, aiThinking: false }))
    }
  })

  it('对局结束后两边都不能走，此时不互补', () => {
    const finished = {
      game: resign(createGame(), BLACK),
      mode: 'pve' as const,
      humanColor: BLACK,
    }

    expect(shouldAiMove(finished)).toBe(false)
    expect(canHumanPlay({ ...finished, aiThinking: false })).toBe(false)
  })
})

describe('canHumanPlay', () => {
  it('轮到你且不在思考时可以落子', () => {
    expect(canHumanPlay(state())).toBe(true)
  })

  it('对局结束后一律不能落子', () => {
    expect(canHumanPlay({ ...state(), game: resign(createGame(), BLACK) })).toBe(false)
  })

  it('AI 思考期间不能落子', () => {
    state().playHuman({ x: 7, y: 7 })
    expect(state().aiThinking).toBe(true)

    expect(canHumanPlay(state())).toBe(false)
  })

  it('轮到 AI 时不能落子', () => {
    state().newGame({ humanColor: WHITE })
    expect(canHumanPlay(state())).toBe(false)
  })

  it('本地双人模式下不看执子，只看到底轮到谁', () => {
    state().newGame({ mode: 'pvp' })
    expect(canHumanPlay(state())).toBe(true)

    state().playHuman({ x: 7, y: 7 })
    expect(canHumanPlay(state())).toBe(true)
  })

  it('与 playHuman 的实际拦截保持一致', () => {
    const cases = [state(), { ...state(), aiThinking: true }, { ...state(), mode: 'pvp' as const }]

    for (const candidate of cases) {
      store.setState(candidate)
      const before = state().game.moves.length
      state().playHuman({ x: 3, y: 3 })
      expect(state().game.moves.length > before).toBe(canHumanPlay(candidate))
    }
  })
})

describe('AI 失败后的重试', () => {
  it('引擎报错后可以手动重试，重新发起请求', async () => {
    state().playHuman({ x: 7, y: 7 })
    engine.fail(new Error('Worker 挂了'))
    await engine.flush()

    expect(state().aiError).toContain('Worker 挂了')
    expect(engine.requests).toHaveLength(1)

    state().retryAiMove()

    expect(engine.requests).toHaveLength(2)
    expect(state().aiThinking).toBe(true)
    expect(state().aiError).toBeNull()
  })

  it('重试成功后对局可以继续走完', async () => {
    state().playHuman({ x: 7, y: 7 })
    engine.fail(new Error('Worker 挂了'))
    await engine.flush()

    state().retryAiMove()
    engine.reply({ x: 0, y: 0 })
    await engine.flush()

    expect(state().game.moves).toHaveLength(2)
    expect(state().game.current).toBe(BLACK)
    expect(state().aiThinking).toBe(false)
  })

  it('不在 AI 回合时重试不产生请求', () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply({ x: 0, y: 0 })

    return engine.flush().then(() => {
      state().retryAiMove()
      expect(engine.requests).toHaveLength(1)
    })
  })
})

describe('undoPlies / canUndo', () => {
  it('本地双人模式一次撤一手', () => {
    store.setState({ mode: 'pvp' })
    state().playHuman({ x: 7, y: 7 })

    expect(undoPlies(state())).toBe(1)
    expect(canUndo(state())).toBe(true)
  })

  it('空盘无可悔之处', () => {
    expect(undoPlies(state())).toBe(0)
    expect(canUndo(state())).toBe(false)
  })
})

describe('undoMove', () => {
  it('人机模式下撤销双方各一手', async () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply({ x: 0, y: 0 })
    await engine.flush()

    expect(state().game.moves).toHaveLength(2)
    expect(canUndo(state())).toBe(true)

    state().undoMove()

    expect(state().game.moves).toHaveLength(0)
    expect(state().game.current).toBe(BLACK)
  })

  it('AI 还没应手时只撤销玩家那一手', () => {
    state().playHuman({ x: 7, y: 7 })
    expect(state().aiThinking).toBe(true)

    state().undoMove()

    expect(state().game.moves).toHaveLength(0)
    expect(state().game.current).toBe(BLACK)
    expect(state().aiThinking).toBe(false)
  })

  it('悔棋后再落子会发起新的请求', () => {
    state().playHuman({ x: 7, y: 7 })
    state().undoMove()
    state().playHuman({ x: 8, y: 8 })

    expect(engine.requests).toHaveLength(2)
    expect(engine.requests[1]!.gameVersion).toBe(1)
  })

  it('本地双人模式只撤销一手', () => {
    state().newGame({ mode: 'pvp' })
    state().playHuman({ x: 7, y: 7 })
    state().playHuman({ x: 8, y: 8 })

    state().undoMove()

    expect(state().game.moves).toHaveLength(1)
    expect(state().game.current).toBe(WHITE)
  })

  it('玩家执白、棋盘上只有 AI 的开局子时不能悔棋', async () => {
    state().newGame({ humanColor: WHITE })
    await engine.flush()

    expect(state().game.moves).toHaveLength(0)
    engine.reply({ x: 7, y: 7 })
    await engine.flush()

    expect(state().game.moves).toHaveLength(1)
    expect(canUndo(state())).toBe(false)
  })

  it('玩家执白时，撤销会同时收回双方最近一手', async () => {
    state().newGame({ humanColor: WHITE })
    engine.reply({ x: 7, y: 7 })
    await engine.flush()

    state().playHuman({ x: 8, y: 8 })
    engine.reply({ x: 9, y: 9 })
    await engine.flush()

    expect(state().game.moves).toHaveLength(3)
    state().undoMove()

    expect(state().game.moves).toHaveLength(1)
    expect(state().game.current).toBe(WHITE)
  })

  it('悔棋可以从已结束的对局回到进行中', async () => {
    state().newGame({ mode: 'pvp' })
    const winning: Point[] = [
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 7, y: 7 },
    ]
    for (const move of winning) state().playHuman(move)

    state().undoMove()

    expect(state().game.status).toBe('playing')
    expect(state().game.moves).toHaveLength(8)
  })
})

describe('restore', () => {
  function session(overrides: Partial<PersistedSession> = {}): PersistedSession {
    return {
      schemaVersion: SCHEMA_VERSION,
      moves: [
        { x: 7, y: 7 },
        { x: 7, y: 8 },
      ],
      firstPlayer: BLACK,
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
      ...overrides,
    }
  }

  it('恢复到存档时的棋局、手番与设置', () => {
    state().restore(session())

    expect(state().game.moves).toHaveLength(2)
    expect(state().game.board[idx(7, 7)]).toBe(BLACK)
    expect(state().game.board[idx(7, 8)]).toBe(WHITE)
    expect(state().game.current).toBe(BLACK)
    expect(state().humanColor).toBe(BLACK)
    expect(state().difficulty).toBe('easy')
  })

  it('传 null 时保持当前状态不变', () => {
    state().playHuman({ x: 3, y: 3 })
    state().restore(null)

    expect(state().game.moves).toEqual([{ x: 3, y: 3 }])
  })

  it('存档停留在 AI 回合时，恢复后自动继续请求 AI', () => {
    // 玩家执黑已落一子，AI 还没应手就刷新了页面。
    state().restore(session({ moves: [{ x: 7, y: 7 }] }))

    expect(state().game.moves).toHaveLength(1)
    expect(state().game.current).toBe(WHITE)
    expect(state().aiThinking).toBe(true)
    expect(engine.requests).toHaveLength(1)
    expect(engine.requests[0]!.player).toBe(WHITE)
    expect(engine.requests[0]!.gameVersion).toBe(1)
  })

  it('分享预览可恢复局面但不续走 AI，离开后再显式续走', () => {
    state().restore(session({ moves: [{ x: 7, y: 7 }] }), { resumeAi: false })

    expect(state().game.moves).toHaveLength(1)
    expect(state().game.current).toBe(WHITE)
    expect(state().aiThinking).toBe(false)
    expect(engine.requests).toHaveLength(0)

    state().requestAiMove()
    expect(state().aiThinking).toBe(true)
    expect(engine.requests).toHaveLength(1)
  })

  it('恢复后 AI 应手，这一局可以继续走完', async () => {
    state().restore(session({ moves: [{ x: 7, y: 7 }] }))
    engine.reply({ x: 0, y: 0 })
    await engine.flush()

    expect(state().game.moves).toHaveLength(2)
    expect(state().game.current).toBe(BLACK)
    expect(state().aiThinking).toBe(false)

    state().playHuman({ x: 1, y: 1 })
    expect(state().game.moves).toHaveLength(3)
  })

  it('恢复时停在玩家回合不会多此一举地请求 AI', () => {
    state().restore(session())

    expect(state().aiThinking).toBe(false)
    expect(engine.requests).toHaveLength(0)
  })

  it('存档里混入非法手顺时，从那一手起整段截断', () => {
    state().restore(
      session({
        moves: [
          { x: 7, y: 7 },
          { x: 7, y: 7 },
          { x: 8, y: 8 },
        ],
      }),
    )

    // 不能跳过重复的那一手继续重放：手番的奇偶会因此错位，后面的棋子颜色全反。
    expect(state().game.moves).toEqual([{ x: 7, y: 7 }])
  })

  it('认输的对局存档不会在刷新后复活', () => {
    state().restore(session({ resignedBy: BLACK }))

    expect(state().game.status).toBe('resigned')
    expect(state().game.winner).toBe(WHITE)
    // 已经结束的对局不该再让 AI 接着走。
    expect(engine.requests).toHaveLength(0)
  })

  it('认输存档恢复后仍然拒绝落子', () => {
    state().restore(session({ resignedBy: BLACK }))

    state().playHuman({ x: 0, y: 0 })

    expect(state().game.moves).toHaveLength(2)
  })

  it('恢复认输存档后可以悔棋回到进行中', () => {
    state().restore(session({ resignedBy: BLACK }))

    state().undoMove()

    expect(state().game.status).toBe('playing')
  })

  it('恢复本地双人存档不会请求 AI', () => {
    state().restore(session({ mode: 'pvp' }))

    expect(state().mode).toBe('pvp')
    expect(engine.requests).toHaveLength(0)
  })
})

describe('resign', () => {
  it('玩家认输后对局结束，对方获胜', () => {
    state().resign()

    expect(state().game.status).toBe('resigned')
    expect(state().game.winner).toBe(WHITE)
  })

  it('玩家执白时认输判黑棋获胜', () => {
    state().newGame({ humanColor: WHITE })
    state().resign()

    expect(state().game.winner).toBe(BLACK)
  })

  it('认输后不再请求 AI', () => {
    state().playHuman({ x: 7, y: 7 })
    const before = engine.requests.length
    state().resign()

    expect(engine.requests).toHaveLength(before)
  })
})

describe('newGame', () => {
  it('清空棋盘并恢复玩家先手', async () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply({ x: 0, y: 0 })
    await engine.flush()

    state().newGame()

    expect(state().game.moves).toHaveLength(0)
    expect(state().game.current).toBe(BLACK)
    expect(state().aiThinking).toBe(false)
    expect(state().aiError).toBeNull()
  })

  it('玩家执白时新开局由 AI 先走', () => {
    state().newGame({ humanColor: WHITE })

    expect(state().humanColor).toBe(WHITE)
    expect(engine.requests).toHaveLength(1)
    expect(engine.requests[0]!.player).toBe(BLACK)
    expect(state().aiThinking).toBe(true)
  })

  it('切换执子会开新局', () => {
    state().playHuman({ x: 7, y: 7 })
    state().setHumanColor(WHITE)

    expect(state().humanColor).toBe(WHITE)
    expect(state().game.moves).toHaveLength(0)
  })

  it('切换难度不打断当前对局', () => {
    state().playHuman({ x: 7, y: 7 })
    state().setDifficulty('beginner')

    expect(state().difficulty).toBe('beginner')
    expect(state().game.moves).toHaveLength(1)
  })
})

describe('AI 提示', () => {
  const SUGGESTIONS: readonly MoveSuggestion[] = [
    { move: { x: 7, y: 7 }, score: 120_000, attack: 'openFour', defense: 'none' },
    { move: { x: 8, y: 8 }, score: 10_000, attack: 'openThree', defense: 'openThree' },
  ]

  /**
   * 用一份**带真实着法**的响应兑现最近的提示请求。
   *
   * 故意让 move 非 null：引擎实际就会这么返回（chooseMove 不区分用途）。
   * 于是「提示响应被误当成落子响应处理」这类错误会直接在棋盘上留下棋子，
   * 而不是被 `move === null` 顺手挡掉。
   */
  function replyHint(overrides: Partial<SearchResponse> = {}): void {
    const request = engine.lastRequest
    engine.respondTo(request.requestId, {
      ...makeResponse(request.requestId, request.gameVersion, { x: 5, y: 5 }),
      candidates: SUGGESTIONS,
      urgency: 'danger',
      ...overrides,
    })
  }

  it('提示请求打上 hint 用途，玩家执子、当前手番', () => {
    state().requestHint()

    expect(engine.requests).toHaveLength(1)
    expect(engine.lastRequest.purpose).toBe('hint')
    expect(engine.lastRequest.player).toBe(BLACK)
    expect(engine.lastRequest.gameVersion).toBe(0)
    expect(state().hintThinking).toBe(true)
  })

  it('提示的时间预算远短于正式走子', () => {
    state().requestHint()

    expect(engine.lastRequest.budgetMs).toBeLessThan(1000)
  })

  it('提示响应只写提示状态，绝不落子', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()

    expect(state().hint).toEqual(SUGGESTIONS)
    expect(state().hintUrgency).toBe('danger')
    expect(state().hintConfidence).toBe('exact')
    expect(state().hintThinking).toBe(false)
    expect(state().game.moves).toHaveLength(0)
    expect(state().game.board[idx(5, 5)]).toBe(0)
    expect(state().game.current).toBe(BLACK)
    expect(state().game.version).toBe(0)
  })

  it('提示在飞时玩家仍然可以落子，两者互不挤占', async () => {
    state().requestHint()
    const hintRequestId = engine.lastRequest.requestId

    state().playHuman({ x: 3, y: 3 })

    // 落子立刻生效，没有被在飞的提示挡住；AI 请求也照常发出。
    expect(state().game.moves).toEqual([{ x: 3, y: 3 }])
    expect(state().aiThinking).toBe(true)
    expect(engine.requests).toHaveLength(2)
    expect(engine.requests[1]!.purpose).toBe('play')

    // 局面已经变了，这份提示作废；但它只是被丢掉，绝不碰棋局。
    engine.respondTo(hintRequestId, {
      ...makeResponse(hintRequestId, 0, { x: 5, y: 5 }),
      candidates: SUGGESTIONS,
      urgency: 'danger',
    })
    await engine.flush()

    expect(state().hint).toBeNull()
    expect(state().hintThinking).toBe(false)
    expect(state().game.moves).toEqual([{ x: 3, y: 3 }])
    expect(state().game.board[idx(5, 5)]).toBe(0)
  })

  it('AI 思考期间不发起提示请求', () => {
    state().playHuman({ x: 7, y: 7 })
    const before = engine.requests.length

    state().requestHint()

    expect(engine.requests).toHaveLength(before)
    expect(state().hintThinking).toBe(false)
  })

  it('对局结束后请求提示是空操作', () => {
    state().resign()

    state().requestHint()

    expect(engine.requests).toHaveLength(0)
  })

  it('提示失败只影响提示，不影响对局', async () => {
    state().requestHint()
    engine.failTo(engine.lastRequest.requestId, new Error('提示超时'))
    await engine.flush()

    expect(state().hintError).toContain('提示超时')
    expect(state().hintThinking).toBe(false)
    expect(state().aiError).toBeNull()
    expect(state().game.moves).toHaveLength(0)

    // 失败之后照常可以落子，AI 也应手
    state().playHuman({ x: 7, y: 7 })
    engine.reply({ x: 0, y: 0 })
    await engine.flush()

    expect(state().game.moves).toHaveLength(2)
  })

  it('棋局版本对不上的提示响应被丢弃', async () => {
    state().requestHint()
    const requestId = engine.lastRequest.requestId

    engine.respondTo(requestId, {
      ...makeResponse(requestId, 99, { x: 5, y: 5 }),
      candidates: SUGGESTIONS,
      urgency: 'danger',
    })
    await engine.flush()

    expect(state().hint).toBeNull()
    expect(state().hintThinking).toBe(false)
    expect(state().game.moves).toHaveLength(0)
  })

  it('requestId 对不上的提示响应被丢弃', async () => {
    state().requestHint()
    const requestId = engine.lastRequest.requestId

    engine.respondTo(requestId, {
      ...makeResponse(requestId + 1000, 0, { x: 5, y: 5 }),
      candidates: SUGGESTIONS,
      urgency: 'danger',
    })
    await engine.flush()

    expect(state().hint).toBeNull()
    expect(state().hintThinking).toBe(true)
  })

  it('提示与落子共用同一个请求号计数器，号不重复', () => {
    state().requestHint()
    const hintRequestId = engine.lastRequest.requestId
    expect(state().pendingHintRequestId).toBe(hintRequestId)

    state().playHuman({ x: 3, y: 3 })
    const playRequestId = engine.lastRequest.requestId

    // 两个请求号都出自同一个只增不减的计数器，因此永远不会撞号——
    // 撞号会让迟到的提示响应去兑现落子请求。
    expect(playRequestId).toBeGreaterThan(hintRequestId)
    expect(state().pendingRequestId).toBe(playRequestId)
  })

  it('记下提示的可靠度，超时回退时必须如实标成启发式', async () => {
    // 提示固定用 800 ms 的短预算，专家档几乎必然搜不完——界面要能如实说明
    // 「这只是建议」，就不能把 confidence 丢掉。
    state().requestHint()
    replyHint({ confidence: 'heuristic', reason: 'timeout' })
    await engine.flush()

    expect(state().hintConfidence).toBe('heuristic')
  })

  it('clearHint 清空提示、紧急度与可靠度', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()

    state().clearHint()

    expect(state().hint).toBeNull()
    expect(state().hintUrgency).toBeNull()
    expect(state().hintConfidence).toBeNull()
  })

  it('玩家落子后提示被清空', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()
    expect(state().hint).not.toBeNull()

    state().playHuman({ x: 3, y: 3 })

    expect(state().hint).toBeNull()
    expect(state().hintUrgency).toBeNull()
    expect(state().hintConfidence).toBeNull()
  })

  it('提示不会跨过一整个回合', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()
    expect(state().hint).not.toBeNull()

    state().playHuman({ x: 3, y: 3 })
    engine.reply({ x: 0, y: 0 })
    await engine.flush()

    expect(state().game.moves).toHaveLength(2)
    expect(state().hint).toBeNull()
    expect(state().hintUrgency).toBeNull()
  })

  it('悔棋后提示被清空', async () => {
    // 空盘无可悔之处，undoMove 会直接返回；必须先真走出几手来。
    state().playHuman({ x: 3, y: 3 })
    engine.reply({ x: 0, y: 0 })
    await engine.flush()

    state().requestHint()
    replyHint()
    await engine.flush()
    expect(state().hint).not.toBeNull()

    state().undoMove()

    expect(state().game.moves).toHaveLength(0)
    expect(state().hint).toBeNull()
  })

  it('重新开始后提示被清空', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()

    state().newGame()

    expect(state().hint).toBeNull()
    expect(state().hintUrgency).toBeNull()
    expect(state().hintError).toBeNull()
  })

  it('认输后提示被清空', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()

    state().resign()

    expect(state().hint).toBeNull()
  })

  it('恢复存档后提示被清空', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()

    state().restore({
      schemaVersion: SCHEMA_VERSION,
      moves: [{ x: 7, y: 7 }],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    })

    expect(state().hint).toBeNull()
  })

  it('AI 深算期间悔棋，迟到的落子响应不会让棋局倒退', async () => {
    state().playHuman({ x: 7, y: 7 })
    const playRequestId = engine.lastRequest.requestId

    state().undoMove()

    engine.respondTo(playRequestId, makeResponse(playRequestId, 1, { x: 0, y: 0 }))
    await engine.flush()

    expect(state().game.moves).toHaveLength(0)
    expect(state().aiInfo).toBeNull()
    expect(state().aiThinking).toBe(false)
  })
})

describe('终局入库回调 onGameEnd', () => {
  /** 双方轮流在 (x,7) 上摆黑棋五连：pvp 模式下手动喂每一手。 */
  function playToWin(target: ReturnType<typeof createGameStore>) {
    target.getState().setMode('pvp')
    for (const x of [3, 4, 5, 6, 7]) {
      target.getState().playHuman({ x, y: 7 })
      if (x !== 7) target.getState().playHuman({ x, y: 9 })
    }
  }

  it('五连终局时回调一次，带完整对局信息', () => {
    const ended: unknown[] = []
    const s = createGameStore(engine, { onGameEnd: (input) => void ended.push(input) })
    playToWin(s)

    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({
      moves: expect.any(Array),
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      resignedBy: null,
    })
  })

  it('认输终局也触发，resignedBy 是认输的那一方', () => {
    const ended: Array<{ resignedBy: unknown }> = []
    const s = createGameStore(engine, { onGameEnd: (input) => void ended.push(input) })
    s.getState().setMode('pvp')
    s.getState().playHuman({ x: 7, y: 7 }) // 黑落子，轮到白
    s.getState().resign()

    expect(ended).toHaveLength(1)
    // 本地双人：按钮是**轮到谁走时谁点的**，所以认输的是当前该走的一方（白）。
    // 这条原先断言的是 BLACK——那是在钉「认 humanColor」这个错误的语义。
    expect(ended[0]?.resignedBy).toBe(WHITE)
  })

  it('本地双人的认输不看 humanColor——那是上一次人机模式的残留值', () => {
    const ended: Array<{ resignedBy: unknown }> = []
    const s = createGameStore(engine, { onGameEnd: (input) => void ended.push(input) })

    // 先在**人机**模式里选执白（humanColor = 白），再切到本地双人。
    // 双人模式下执子选择器是隐藏的，humanColor 因此是个看不见也改不了的残留值。
    s.getState().setHumanColor(WHITE)
    s.getState().setMode('pvp')

    // 黑、白各落一手，又回到黑走
    s.getState().playHuman({ x: 3, y: 7 })
    s.getState().playHuman({ x: 3, y: 9 })
    expect(s.getState().humanColor).toBe(WHITE) // 残留值确实还在
    expect(s.getState().game.current).toBe(BLACK)

    s.getState().resign()

    // 该走的是黑，所以认输的是黑。若拿残留的 humanColor（白）当判据，这里会是白。
    expect(ended[0]?.resignedBy).toBe(BLACK)
  })

  it('人机模式的认输仍然认玩家自己，即使此刻轮到 AI 走', () => {
    const ended: Array<{ resignedBy: unknown }> = []
    const s = createGameStore(engine, { onGameEnd: (input) => void ended.push(input) })

    s.getState().setHumanColor(WHITE) // 玩家执白 → 开局轮到 AI（黑）走
    expect(s.getState().game.current).toBe(BLACK)

    s.getState().resign()

    // 认的是**玩家**，不是当前该走的一方
    expect(ended[0]?.resignedBy).toBe(WHITE)
  })

  it('进行中不触发——只有状态从 playing 变成终局才调一次', () => {
    const ended: unknown[] = []
    const s = createGameStore(engine, { onGameEnd: (input) => void ended.push(input) })
    s.getState().setMode('pvp')
    s.getState().playHuman({ x: 3, y: 7 })

    expect(ended).toHaveLength(0)
  })

  it('newGame 与 restore 不触发——重开一局不是「结束了一局」', () => {
    const ended: unknown[] = []
    const s = createGameStore(engine, { onGameEnd: (input) => void ended.push(input) })
    playToWin(s)
    expect(ended).toHaveLength(1)

    s.getState().newGame()
    expect(ended).toHaveLength(1)

    s.getState().restore({
      schemaVersion: SCHEMA_VERSION,
      moves: [{ x: 3, y: 7 }],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    })
    expect(ended).toHaveLength(1)
  })

  it('不传 onGameEnd 时一切照常，不报错', () => {
    const s = createGameStore(engine)
    expect(() => playToWin(s)).not.toThrow()
    expect(s.getState().game.status).toBe('won')
  })
})

describe('终局入库的状态（供界面显示）', () => {
  function playToWin(target: ReturnType<typeof createGameStore>) {
    target.getState().setMode('pvp')
    for (const x of [3, 4, 5, 6, 7]) {
      target.getState().playHuman({ x, y: 7 })
      if (x !== 7) target.getState().playHuman({ x, y: 9 })
    }
  }

  it('写入成功后状态是 saved', async () => {
    const s = createGameStore(engine, { onGameEnd: () => Promise.resolve() })
    playToWin(s)

    expect(s.getState().recordSaveState).toBe('saving')
    await flush()
    expect(s.getState().recordSaveState).toBe('saved')
  })

  it('写入失败后状态是 failed——如实说没存上，不假装成功', async () => {
    const s = createGameStore(engine, { onGameEnd: () => Promise.reject(new Error('配额满')) })
    playToWin(s)
    await flush()

    expect(s.getState().recordSaveState).toBe('failed')
  })

  it('未设回调时状态保持 idle', () => {
    const s = createGameStore(engine)
    playToWin(s)
    expect(s.getState().recordSaveState).toBe('idle')
  })

  /**
   * **同步**返回 undefined 的回调＝它什么也没入库，界面停在 idle。
   *
   * 这一条原先没有测试钉着，改写 `notifyGameEnd` 时很容易顺手丢掉。
   * 注意与上一条区分：`() => Promise.resolve()` 是「存过了、只是没拿到 seq」，
   * 那种仍然算 saved——两者都是 `undefined`，差别在有没有返回 promise。
   */
  it('回调同步返回 undefined 时保持 idle，不谎报「已存入」', () => {
    const s = createGameStore(engine, { onGameEnd: () => {} })
    playToWin(s)
    expect(s.getState().recordSaveState).toBe('idle')
  })

  it('新的一局把状态清回 idle', async () => {
    const s = createGameStore(engine, { onGameEnd: () => Promise.resolve() })
    playToWin(s)
    await flush()
    expect(s.getState().recordSaveState).toBe('saved')

    s.getState().newGame()
    expect(s.getState().recordSaveState).toBe('idle')
  })
})

describe('终局后悔棋再终局：同一局只留一条棋谱', () => {
  it('第二次终局带上 replacesSeq，指向第一次存下的那条', async () => {
    const inputs: Array<{ replacesSeq: number | null }> = []
    let nextSeq = 1
    const s = createGameStore(engine, {
      onGameEnd: (input) => {
        inputs.push({ replacesSeq: input.replacesSeq })
        return Promise.resolve(nextSeq++)
      },
    })

    s.getState().setMode('pvp')
    for (const x of [3, 4, 5, 6, 7]) {
      s.getState().playHuman({ x, y: 7 })
      if (x !== 7) s.getState().playHuman({ x, y: 9 })
    }
    await flush()
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.replacesSeq).toBeNull() // 第一次：新的一条

    // 终局后悔棋（既有行为，测试在别处钉着）→ 换个走法再终局
    s.getState().undoMove()
    s.getState().playHuman({ x: 2, y: 7 }) // 换个方向再连一次？——回到同一局面即可
    await flush()

    // 第二次终局必须告诉外部「这条替换掉 seq=1 那条」，否则棋谱库出现两条
    expect(inputs).toHaveLength(2)
    expect(inputs[1]?.replacesSeq).toBe(1)
  })

  /**
   * 上一条用例在两次终局之间 `await flush()` 了一次，也就是第一次入库**已经兑现**。
   * 真正会出错的是「上一次写入还没回来，就又终局了一次」——那时 `recordedSeq`
   * 还是 `null`（它只在 promise 兑现时才写），第二次就会拿到 `replacesSeq: null`，
   * 而存储层的内容匹配又对不上（手顺不同），同一局留下两条。
   */
  it('上一次写入还没兑现就再次终局：第二次仍然替换同一条，不新增', async () => {
    const inputs: Array<{ replacesSeq: number | null }> = []
    // 用对象属性持有：直接写 `let releaseFirst: (() => void) | null = null` 再在闭包里赋值，
    // TS 的控制流分析会把它窄化成 never（它看不见闭包被执行过）。
    const gate: { release?: () => void } = {}
    let seq = 0

    const s = createGameStore(engine, {
      onGameEnd: (input) => {
        inputs.push({ replacesSeq: input.replacesSeq })
        if (inputs.length === 1) {
          // 第一次故意挂住，模拟「IndexedDB 的写入还没回来」
          return new Promise<number>((resolve) => {
            gate.release = () => resolve(++seq)
          })
        }
        return Promise.resolve(++seq)
      },
    })

    s.getState().setMode('pvp')
    for (const x of [3, 4, 5, 6, 7]) {
      s.getState().playHuman({ x, y: 7 })
      if (x !== 7) s.getState().playHuman({ x, y: 9 })
    }
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.replacesSeq).toBeNull()

    // **不等第一次兑现**，直接悔棋再换个走法终局
    s.getState().undoMove()
    s.getState().playHuman({ x: 2, y: 7 })
    s.getState().playHuman({ x: 2, y: 9 })
    s.getState().playHuman({ x: 7, y: 9 })

    // 第二次终局会**排在第一次后面**等它兑现，所以现在还没发生
    expect(inputs).toHaveLength(1)

    gate.release?.()
    await flush()
    await flush()

    expect(inputs).toHaveLength(2)
    // 关键：第二次拿到的是第一次存下的 seq，而不是 null
    expect(inputs[1]?.replacesSeq).toBe(1)
    expect(s.getState().recordedSeq).toBe(2)
  })
})

/**
 * `reset()` 的用意是「上一局的入库与本局无关」，`newGame` / `restore` 也确实调了它。
 * 但**调用本身不构成保证**：在飞的那次写入还要能认出「我已经是上一局的事了」，
 * 否则它兑现时会把自己的结果写进新局。
 *
 * 后果比「棋谱库里多一条」更重。新局会拿到上一局的 seq 当 `recordedSeq`，
 * 等这局下完再把它当 `replacesSeq` 交出去——而存储层拿到它就**无条件删掉那一条**
 * （`gameRecords.ts:188`），于是上一局的棋谱**没了**。
 */
describe('换局要作废在飞的入库', () => {
  it('重开一局后，上一局迟到的入库结果不许写回新局', async () => {
    const inputs: Array<{ replacesSeq: number | null }> = []
    const gate: { release?: () => void } = {}
    let seq = 0

    const s = createGameStore(engine, {
      onGameEnd: (input) => {
        inputs.push({ replacesSeq: input.replacesSeq })
        if (inputs.length === 1) {
          // 第一次故意挂住，模拟「这次写入还没回来」
          return new Promise<number>((resolve) => {
            gate.release = () => resolve(++seq)
          })
        }
        return Promise.resolve(++seq)
      },
    })

    /** 在 y 行摆出黑棋五连（白棋摆在 y+2 行，不挡路）。 */
    const winAt = (y: number): void => {
      for (const x of [3, 4, 5, 6, 7]) {
        s.getState().playHuman({ x, y })
        if (x !== 7) s.getState().playHuman({ x, y: y + 2 })
      }
    }

    s.getState().setMode('pvp')
    winAt(7)
    expect(s.getState().recordSaveState).toBe('saving')

    // **不等它兑现**就重开一局
    s.getState().newGame({ mode: 'pvp' })
    expect(s.getState().recordSaveState).toBe('idle')
    expect(s.getState().recordedSeq).toBeNull()

    gate.release?.()
    await flush()
    await flush()

    // ① 迟到的结果不许把新局标成「已存入」
    expect(s.getState().recordSaveState).toBe('idle')
    expect(s.getState().recordedSeq).toBeNull()

    // ② 新局终局时不许带上上一局的 seq——带了就会删掉上一局的棋谱
    winAt(11)
    expect(inputs).toHaveLength(2)
    expect(inputs[1]?.replacesSeq).toBeNull()
  })
})

describe('AI 返回非法着法', () => {
  /**
   * 这条路径的唯一价值就在出错时：引擎（或将来接的第二个着法来源）给出一个
   * 落不下的点。store 必须**不动棋局**、复位思考态、并把话说明白——
   * 尤其是**不能**留下一个 aiThinking=true 的卡死局面。
   */
  it('落在已占用的点上：棋局不变、思考态复位、错误如实写出来', async () => {
    state().playHuman({ x: 7, y: 7 })
    expect(engine.requests).toHaveLength(1)

    engine.reply({ x: 7, y: 7 }) // AI 回了一个已经被玩家占住的点
    await flush()

    expect(state().game.moves).toEqual([{ x: 7, y: 7 }])
    expect(state().game.status).toBe('playing')
    expect(state().aiThinking).toBe(false)
    expect(state().pendingRequestId).toBeNull()
    expect(state().aiError).toBe('AI 返回了不合法的着法，已忽略')
    // 没有着法就没有分析结果——不许留下上一次的
    expect(state().aiInfo).toBeNull()
  })

  it('越界坐标同样被拒绝，且之后玩家可以重试', async () => {
    state().playHuman({ x: 7, y: 7 })
    engine.reply({ x: -1, y: 0 })
    await flush()

    expect(state().game.moves).toHaveLength(1)
    expect(state().aiError).toBe('AI 返回了不合法的着法，已忽略')

    // 卡住之后必须还能救回来：retryAiMove 重新发起一次，这次给个合法的
    state().retryAiMove()
    expect(engine.requests).toHaveLength(2)
    engine.reply({ x: 0, y: 0 })
    await flush()

    expect(state().game.moves).toHaveLength(2)
    expect(state().aiError).toBeNull()
  })
})

describe('棋谱探索分支', () => {
  const sourceMoves: readonly Point[] = [
    { x: 3, y: 7 },
    { x: 3, y: 9 },
    { x: 4, y: 7 },
    { x: 4, y: 9 },
    { x: 5, y: 7 },
  ]

  function sourceRecord(overrides: Partial<GameRecord> = {}): GameRecord {
    return {
      seq: 4,
      schemaVersion: 1,
      moves: sourceMoves,
      firstPlayer: BLACK,
      mode: 'pve',
      humanColor: WHITE,
      difficulty: 'easy',
      resignedBy: null,
      winner: null,
      ...overrides,
    }
  }

  it('从第 N 手接管，只使用前缀，原棋谱不变，并自动轮到 AI', () => {
    const record = sourceRecord()
    const before = structuredClone(record)
    const result = state().startBranch({
      source: record,
      cursor: 2,
      mode: 'pve',
      humanColor: WHITE,
      difficulty: 'hard',
    })

    expect(result).toEqual({ ok: true })
    expect(state().game.moves).toEqual(sourceMoves.slice(0, 2))
    expect(state().game.current).toBe(BLACK)
    expect(state().mode).toBe('pve')
    expect(state().humanColor).toBe(WHITE)
    expect(state().difficulty).toBe('hard')
    expect(state().branch).toEqual({
      sourceSeq: 4,
      sourceContentKey: recordContentKey({
        firstPlayer: record.firstPlayer,
        moves: record.moves,
        mode: record.mode,
        humanColor: record.humanColor,
        difficulty: record.difficulty,
        resignedBy: record.resignedBy,
      }),
      cursor: 2,
      sourceMoves: 5,
    })
    expect(record).toEqual(before)

    // 玩家执白、分支起点轮黑：进入后必须立刻发起 AI 请求，而不是等玩家点一步。
    expect(engine.requests).toHaveLength(1)
    expect(engine.lastRequest.player).toBe(BLACK)
    expect(engine.lastRequest.gameVersion).toBe(2)
  })

  it('玩家执黑且轮到玩家时不自动请求 AI', () => {
    const result = state().startBranch({
      source: sourceRecord(),
      cursor: 2,
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
    })
    expect(result).toEqual({ ok: true })
    expect(state().game.current).toBe(BLACK)
    expect(engine.requests).toHaveLength(0)
  })

  it('取消/无效分支不修改当前对局', () => {
    const record = sourceRecord()
    const before = state().game
    const result = state().startBranch({
      source: record,
      cursor: 99,
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
    })

    expect(result.ok).toBe(false)
    expect(state().game).toBe(before)
    expect(state().branch).toBeNull()
  })

  it('分支接管会作废旧 AI 响应与旧提示', async () => {
    // 旧落子请求：玩家执白 → AI 执黑，newGame 会立刻发请求。
    state().newGame({ mode: 'pve', humanColor: WHITE })
    const oldAi = engine.lastRequest
    state().startBranch({
      source: sourceRecord(),
      cursor: 1,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
    })
    expect(state().pendingRequestId).toBeNull()
    engine.respondTo(
      oldAi.requestId,
      makeResponse(oldAi.requestId, oldAi.gameVersion, { x: 9, y: 9 }),
    )
    await flush()
    expect(state().game.moves).toEqual(sourceMoves.slice(0, 1))
    expect(state().aiInfo).toBeNull()

    // 旧提示：玩家执黑轮到玩家，允许求提示；再接管分支。
    state().newGame({ mode: 'pve', humanColor: BLACK })
    state().requestHint()
    const oldHint = engine.lastRequest
    expect(state().pendingHintRequestId).not.toBeNull()
    state().startBranch({
      source: sourceRecord(),
      cursor: 1,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
    })
    expect(state().pendingHintRequestId).toBeNull()
    engine.respondTo(oldHint.requestId, {
      ...makeResponse(oldHint.requestId, oldHint.gameVersion, null),
      candidates: [{ move: { x: 9, y: 9 }, score: 1, attack: 'three', defense: 'none' }],
      urgency: 'normal',
    })
    await flush()
    expect(state().hint).toBeNull()
    expect(state().game.moves).toEqual(sourceMoves.slice(0, 1))
  })

  it('认输局的最后一手盘面可以继续，且不继承认输', () => {
    const result = state().startBranch({
      source: sourceRecord({ resignedBy: BLACK }),
      cursor: 5,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
    })
    expect(result).toEqual({ ok: true })
    expect(state().game.status).toBe('playing')
    expect(state().game.moves).toHaveLength(5)
    expect(state().branch).not.toBeNull()
  })

  it('分支完成后保存为独立棋谱；原棋谱删除后分支仍可重放', async () => {
    const records = memoryGameRecords()
    const sourceMoves: readonly Point[] = [
      { x: 3, y: 7 },
      { x: 3, y: 9 },
      { x: 4, y: 7 },
      { x: 4, y: 9 },
      { x: 5, y: 7 },
      { x: 5, y: 9 },
      { x: 6, y: 7 },
      { x: 6, y: 9 },
      { x: 10, y: 10 },
    ]
    const source = (
      await records.put({
        moves: sourceMoves,
        firstPlayer: BLACK,
        mode: 'pvp',
        humanColor: BLACK,
        difficulty: 'easy',
        resignedBy: null,
      })
    ).record
    const sourceBefore = structuredClone(source)

    const branchStore = createGameStore(engine, {
      onGameEnd: async (input) => {
        expect(input.branchSourceSeq).toBe(source.seq)
        const { record } = await records.put({
          moves: input.moves,
          firstPlayer: input.firstPlayer,
          mode: input.mode,
          humanColor: input.humanColor,
          difficulty: input.difficulty,
          resignedBy: input.resignedBy,
        })
        return record.seq
      },
    })
    branchStore.getState().startBranch({
      source,
      cursor: 8,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
    })
    branchStore.getState().playHuman({ x: 7, y: 7 })
    await flush()

    const afterBranch = await records.list()
    expect(afterBranch.records).toHaveLength(2)
    expect(source).toEqual(sourceBefore)

    const branch = afterBranch.records.find((entry) => entry.seq !== source.seq)!
    expect(branch.moves).toHaveLength(9)
    expect(branch.winner).toBe(BLACK)

    await records.delete(source.seq)
    const afterDelete = await records.list()
    expect(afterDelete.records).toHaveLength(1)
    expect(afterDelete.records[0]!.moves).toEqual(branch.moves)
  })

  it('开始普通新局会清除分支身份', () => {
    state().startBranch({
      source: sourceRecord(),
      cursor: 1,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
    })
    expect(state().branch).not.toBeNull()
    state().newGame()
    expect(state().branch).toBeNull()
  })
})
