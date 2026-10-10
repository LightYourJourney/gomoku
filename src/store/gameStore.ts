import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { opponentOf } from '../core/board'
import {
  applyMove,
  createGame,
  replay,
  resign as resignGame,
  undo,
  type GameState,
} from '../core/game'
import { BLACK, type Player, type Point } from '../core/types'
import type { AiEngine } from '../ai/engine'
import type {
  Confidence,
  Difficulty,
  MoveSuggestion,
  SearchReason,
  SearchResponse,
  Urgency,
} from '../ai/types'
import type { PersistedSession } from '../persist/storage'

export type GameMode = 'pve' | 'pvp'

export interface AiInfo {
  readonly depth: number
  readonly nodes: number
  readonly elapsedMs: number
  readonly score: number
  readonly confidence: Confidence
  readonly reason: SearchReason
}

export interface GameStore {
  readonly game: GameState
  readonly mode: GameMode
  /** 人机模式下玩家执哪一方 */
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly aiThinking: boolean
  readonly aiError: string | null
  readonly aiInfo: AiInfo | null
  /** 当前在飞的 AI 请求；null 表示没有。用于作废过期响应。 */
  readonly pendingRequestId: number | null

  /**
   * AI 提示。
   *
   * 与落子请求走同一条引擎、同一套过期校验，但**提示响应只写这里，绝不落子**。
   * 局面一变（落子 / 悔棋 / 重开 / 认输）就清空——高亮必须跟着局面失效。
   */
  readonly hint: readonly MoveSuggestion[] | null
  readonly hintUrgency: Urgency | null
  /**
   * 这份提示有多可信。
   *
   * 提示固定用 800 ms 的短预算，档位越高越可能搜不完而回退到启发式。
   * 界面必须如实区分——把「没搜完的猜测」说成「精确结论」就是在骗玩家。
   */
  readonly hintConfidence: Confidence | null
  readonly hintThinking: boolean
  readonly hintError: string | null
  readonly pendingHintRequestId: number | null

  newGame(options?: { mode?: GameMode; humanColor?: Player; difficulty?: Difficulty }): void
  /** 从本地存档恢复。传 null 表示没有存档，保持当前状态。 */
  restore(session: PersistedSession | null): void
  /** AI 失败后重试。不在 AI 回合时是空操作。 */
  retryAiMove(): void
  setMode(mode: GameMode): void
  setHumanColor(color: Player): void
  setDifficulty(difficulty: Difficulty): void
  playHuman(point: Point): void
  undoMove(): void
  resign(): void
  requestAiMove(): void
  applyAiResponse(response: SearchResponse): void
  dismissAiError(): void
  requestHint(): void
  applyHintResponse(response: SearchResponse): void
  clearHint(): void
}

/**
 * 提示能用的时间预算。
 *
 * 比正式走子短得多：玩家求提示是在等一个建议，不是在等一场深算。
 * 它同样只读，不会挤占落子请求的预算。
 */
export const HINT_BUDGET_MS = 800

/** 局面一变就要把提示整体清掉。 */
const HINT_CLEARED = {
  hint: null,
  hintUrgency: null,
  hintConfidence: null,
  hintThinking: false,
  hintError: null,
  pendingHintRequestId: null,
} as const

/** 第 index 手（0-based）由谁落子。 */
export function moverAt(index: number, firstPlayer: Player): Player {
  return index % 2 === 0 ? firstPlayer : opponentOf(firstPlayer)
}

/**
 * 悔一手应当撤销几手。
 *
 * 人机模式下，悔棋的意图是「收回我刚才那一手」：AI 已经应过手就连它一起撤，
 * 这样主动权才回到玩家手里；AI 还没应手就只撤自己那一手。
 */
export function undoPlies(state: Pick<GameStore, 'game' | 'mode' | 'humanColor'>): number {
  const { game, mode, humanColor } = state
  if (game.moves.length === 0) return 0

  if (mode === 'pvp') return 1

  const lastMover = moverAt(game.moves.length - 1, game.firstPlayer)
  return lastMover === humanColor ? 1 : Math.min(2, game.moves.length)
}

/**
 * 玩家此刻能不能落子。
 *
 * store 的 playHuman 与棋盘的可交互状态都必须用它，不要各写一遍——
 * 这是一条安全相关的判断，散成多处迟早会不一致。
 */
export function canHumanPlay(
  state: Pick<GameStore, 'game' | 'mode' | 'humanColor' | 'aiThinking'>,
): boolean {
  if (state.game.status !== 'playing') return false
  if (state.mode === 'pvp') return true

  return !state.aiThinking && state.game.current === state.humanColor
}

export function canUndo(state: Pick<GameStore, 'game' | 'mode' | 'humanColor'>): boolean {
  const plies = undoPlies(state)
  if (plies === 0) return false
  if (state.mode === 'pvp') return true

  // 撤销之后必须轮回玩家，否则这一手本来就没什么可悔的
  //（例如玩家执白、盘上只有 AI 的开局子）。
  const remaining = state.game.moves.length - plies
  return moverAt(remaining, state.game.firstPlayer) === state.humanColor
}

/**
 * 人机模式下是否轮到 AI 走。
 *
 * 与 `canHumanPlay` 互补，界面判断「AI 是不是卡住了」也必须用它，
 * 不要另写一份——这条谓词一旦分叉，两边对「该谁走」的理解就会不一致。
 */
export function shouldAiMove(
  state: Pick<GameStore, 'game' | 'mode' | 'humanColor'>,
): boolean {
  return (
    state.mode === 'pve' &&
    state.game.status === 'playing' &&
    state.game.current !== state.humanColor
  )
}

export function createGameStore(engine: AiEngine): UseBoundStore<StoreApi<GameStore>> {
  // 只增不减，跨对局也不会重复，因此过期的响应永远对不上号。
  let nextRequestId = 1

  return create<GameStore>()((set, get) => {
    return {
      game: createGame(),
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
      aiThinking: false,
      aiError: null,
      aiInfo: null,
      pendingRequestId: null,
      ...HINT_CLEARED,

      newGame(options = {}) {
        const current = get()
        set({
          game: createGame(),
          mode: options.mode ?? current.mode,
          humanColor: options.humanColor ?? current.humanColor,
          difficulty: options.difficulty ?? current.difficulty,
          aiThinking: false,
          aiError: null,
          aiInfo: null,
          pendingRequestId: null,
          ...HINT_CLEARED,
        })

        get().requestAiMove()
      },

      restore(session) {
        if (session === null) return

        // replay 会忽略非法手顺，因此损坏的存档最坏也只是退回若干手，不会崩。
        // 胜负与和棋都能从手顺还原，认输不能——所以它单独存、单独补。
        const replayed = replay(session.moves, session.firstPlayer)

        set({
          game:
            session.resignedBy === null ? replayed : resignGame(replayed, session.resignedBy),
          mode: session.mode,
          humanColor: session.humanColor,
          difficulty: session.difficulty,
          aiThinking: false,
          aiError: null,
          aiInfo: null,
          pendingRequestId: null,
          ...HINT_CLEARED,
        })

        // 存档时若正轮到 AI（刷新页面时它还在思考），恢复后要接着把这局走完。
        get().requestAiMove()
      },

      setMode(mode) {
        get().newGame({ mode })
      },

      setHumanColor(humanColor) {
        get().newGame({ humanColor })
      },

      setDifficulty(difficulty) {
        set({ difficulty })
      },

      playHuman(point) {
        const current = get()
        if (!canHumanPlay(current)) return

        const outcome = applyMove(current.game, point)
        if (!outcome.ok) return

        // 提示是按旧局面算的，落子之后就不再适用了。
        set({ game: outcome.state, aiError: null, ...HINT_CLEARED })
        get().requestAiMove()
      },

      undoMove() {
        const current = get()
        const plies = undoPlies(current)
        if (plies === 0) return

        set({
          game: undo(current.game, plies),
          aiThinking: false,
          aiError: null,
          aiInfo: null,
          pendingRequestId: null,
          ...HINT_CLEARED,
        })

        get().requestAiMove()
      },

      resign() {
        const current = get()
        if (current.game.status !== 'playing') return

        set({
          game: resignGame(current.game, current.humanColor),
          aiThinking: false,
          aiInfo: null,
          pendingRequestId: null,
          ...HINT_CLEARED,
        })
      },

      requestAiMove() {
        const current = get()
        if (!shouldAiMove(current) || current.aiThinking) return

        const requestId = nextRequestId++
        const { game } = current

        set({ aiThinking: true, aiError: null, pendingRequestId: requestId })

        void engine
          .search({
            requestId,
            gameVersion: game.version,
            board: game.board,
            player: game.current,
            difficulty: current.difficulty,
            purpose: 'play',
          })
          .then(
            (response) => get().applyAiResponse(response),
            (error: unknown) => {
              // 已经被取代的旧请求失败了也无所谓，不要拿它去打断当前对局。
              if (get().pendingRequestId !== requestId) return
              set({
                aiThinking: false,
                pendingRequestId: null,
                aiError: error instanceof Error ? error.message : String(error),
              })
            },
          )
      },

      retryAiMove() {
        // 失败已经把 aiThinking 复位了；这里只需清掉错误再走一次正常流程。
        // requestAiMove 自己会判断该不该走，因此不在 AI 回合时这里是空操作。
        set({ aiError: null })
        get().requestAiMove()
      },

      applyAiResponse(response) {
        const current = get()

        // 两道闸门：请求号必须是当前在飞的那一个，棋局版本必须与请求发出时一致。
        if (response.requestId !== current.pendingRequestId) return
        if (response.gameVersion !== current.game.version) {
          set({ aiThinking: false, pendingRequestId: null })
          return
        }

        if (response.move === null) {
          set({ aiThinking: false, pendingRequestId: null })
          return
        }

        const outcome = applyMove(current.game, response.move)
        if (!outcome.ok) {
          set({
            aiThinking: false,
            pendingRequestId: null,
            aiError: 'AI 返回了不合法的着法，已忽略',
          })
          return
        }

        set({
          game: outcome.state,
          aiThinking: false,
          pendingRequestId: null,
          aiInfo: {
            depth: response.depth,
            nodes: response.nodes,
            elapsedMs: response.elapsedMs,
            score: response.score,
            confidence: response.confidence,
            reason: response.reason,
          },
        })
      },

      dismissAiError() {
        set({ aiError: null })
      },

      requestHint() {
        const current = get()
        // 提示是给**玩家**看的，所以要过和落子完全一样的门槛——共用 canHumanPlay，
        // 不要在这里另写一套。少判「当前手番是不是人类」就会在 AI 报错卡住时
        // （aiThinking 已复位、手番仍是 AI）以 AI 的视角发出提示请求。
        if (!canHumanPlay(current)) return
        if (current.hintThinking) return

        const requestId = nextRequestId++
        const { game } = current

        set({ hintThinking: true, hintError: null, pendingHintRequestId: requestId })

        void engine
          .search({
            requestId,
            gameVersion: game.version,
            board: game.board,
            player: game.current,
            difficulty: current.difficulty,
            budgetMs: HINT_BUDGET_MS,
            purpose: 'hint',
          })
          .then(
            (response) => get().applyHintResponse(response),
            (error: unknown) => {
              if (get().pendingHintRequestId !== requestId) return
              set({
                hintThinking: false,
                pendingHintRequestId: null,
                hintError: error instanceof Error ? error.message : String(error),
              })
            },
          )
      },

      applyHintResponse(response) {
        const current = get()

        if (response.requestId !== current.pendingHintRequestId) return
        if (response.gameVersion !== current.game.version) {
          set({ hintThinking: false, pendingHintRequestId: null })
          return
        }

        // 只写提示状态。这里**没有** applyMove，提示永远不改变棋局。
        set({
          hint: response.candidates,
          hintUrgency: response.urgency,
          hintConfidence: response.confidence,
          hintThinking: false,
          pendingHintRequestId: null,
          hintError: null,
        })
      },

      clearHint() {
        set(HINT_CLEARED)
      },
    }
  })
}
