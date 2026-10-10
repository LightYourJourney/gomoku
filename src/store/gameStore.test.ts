import { beforeEach, describe, expect, it } from 'vitest'
import type { AiEngine } from '../ai/engine'
import type { MoveSuggestion, SearchRequest, SearchResponse } from '../ai/types'
import { idx } from '../core/board'
import { BLACK, WHITE, type Point } from '../core/types'
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

  it('clearHint 清空提示与紧急度', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()

    state().clearHint()

    expect(state().hint).toBeNull()
    expect(state().hintUrgency).toBeNull()
  })

  it('玩家落子后提示被清空', async () => {
    state().requestHint()
    replyHint()
    await engine.flush()
    expect(state().hint).not.toBeNull()

    state().playHuman({ x: 3, y: 3 })

    expect(state().hint).toBeNull()
    expect(state().hintUrgency).toBeNull()
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
