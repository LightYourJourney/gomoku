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
import type { Confidence, Difficulty, SearchReason, SearchResponse } from '../ai/types'
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

  newGame(options?: { mode?: GameMode; humanColor?: Player; difficulty?: Difficulty }): void
  /** 从本地存档恢复。传 null 表示没有存档，保持当前状态。 */
  restore(session: PersistedSession | null): void
  setMode(mode: GameMode): void
  setHumanColor(color: Player): void
  setDifficulty(difficulty: Difficulty): void
  playHuman(point: Point): void
  undoMove(): void
  resign(): void
  requestAiMove(): void
  applyAiResponse(response: SearchResponse): void
  dismissAiError(): void
}

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

export function canUndo(state: Pick<GameStore, 'game' | 'mode' | 'humanColor'>): boolean {
  const plies = undoPlies(state)
  if (plies === 0) return false
  if (state.mode === 'pvp') return true

  // 撤销之后必须轮回玩家，否则这一手本来就没什么可悔的
  //（例如玩家执白、盘上只有 AI 的开局子）。
  const remaining = state.game.moves.length - plies
  return moverAt(remaining, state.game.firstPlayer) === state.humanColor
}

export function createGameStore(engine: AiEngine): UseBoundStore<StoreApi<GameStore>> {
  // 只增不减，跨对局也不会重复，因此过期的响应永远对不上号。
  let nextRequestId = 1

  return create<GameStore>()((set, get) => {
    function shouldAiMove(state: GameStore): boolean {
      return (
        state.mode === 'pve' &&
        state.game.status === 'playing' &&
        state.game.current !== state.humanColor
      )
    }

    return {
      game: createGame(),
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
      aiThinking: false,
      aiError: null,
      aiInfo: null,
      pendingRequestId: null,

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
        })

        get().requestAiMove()
      },

      restore(session) {
        if (session === null) return

        set({
          // replay 会忽略非法手顺，因此损坏的存档最坏也只是退回若干手，不会崩。
          game: replay(session.moves, session.firstPlayer),
          mode: session.mode,
          humanColor: session.humanColor,
          difficulty: session.difficulty,
          aiThinking: false,
          aiError: null,
          aiInfo: null,
          pendingRequestId: null,
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
        if (current.game.status !== 'playing') return
        if (current.mode === 'pve' && (current.game.current !== current.humanColor || current.aiThinking)) {
          return
        }

        const outcome = applyMove(current.game, point)
        if (!outcome.ok) return

        set({ game: outcome.state, aiError: null })
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
    }
  })
}
