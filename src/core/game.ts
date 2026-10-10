import { createBoard, idx, opponentOf } from './board'
import { findWinLine, isBoardFull, validateMove } from './rules'
import {
  BLACK,
  type Board,
  type GameStatus,
  type MoveError,
  type Player,
  type Point,
} from './types'

export interface GameState {
  readonly board: Board
  /** 手顺。索引 i 即第 i+1 手。 */
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  /** 轮到谁。对局结束后表示「若还能下则该谁下」。 */
  readonly current: Player
  readonly status: GameStatus
  readonly winner: Player | null
  readonly winLine: readonly Point[] | null
  readonly lastMove: Point | null
  /**
   * 局面版本，等于实际生效的手数。
   * AI 请求带上它，主线程据此作废过期响应。
   */
  readonly version: number
}

export type MoveOutcome =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: MoveError }

/**
 * 从手顺从零重建局面。
 *
 * 这是唯一构造 GameState 的路径：落子与悔棋都委托给它，因此不存在
 * 「棋盘与手顺不同步」这类只有增量维护才会有的 bug。
 * 遇到非法手顺（越界 / 重复落子）即停止，忽略其余。
 */
export function replay(moves: readonly Point[], firstPlayer: Player = BLACK): GameState {
  const board = createBoard()
  let current = firstPlayer
  let status: GameStatus = 'playing'
  let winner: Player | null = null
  let winLine: readonly Point[] | null = null
  let lastMove: Point | null = null
  let played = 0

  for (const move of moves) {
    if (status !== 'playing') break
    if (validateMove(board, move) !== null) break

    board[idx(move.x, move.y)] = current
    lastMove = move
    played++

    const line = findWinLine(board, move)
    if (line !== null) {
      // 先判胜、再判和：最后一手既连成五子又把棋盘填满时，赢就是赢。
      status = 'won'
      winner = current
      winLine = line
    } else if (isBoardFull(board)) {
      status = 'draw'
    }

    current = opponentOf(current)
  }

  return {
    board,
    moves: moves.slice(0, played),
    firstPlayer,
    current,
    status,
    winner,
    winLine,
    lastMove,
    version: played,
  }
}

export function createGame(firstPlayer: Player = BLACK): GameState {
  return replay([], firstPlayer)
}

export function applyMove(state: GameState, point: Point): MoveOutcome {
  if (state.status !== 'playing') return { ok: false, error: 'game_over' }

  const error = validateMove(state.board, point)
  if (error !== null) return { ok: false, error }

  return { ok: true, state: replay([...state.moves, point], state.firstPlayer) }
}

/** 撤销最近 plies 手。超出已有手数时回到空盘。 */
export function undo(state: GameState, plies = 1): GameState {
  const keep = Math.max(0, state.moves.length - Math.max(0, plies))
  if (keep === state.moves.length) return state
  return replay(state.moves.slice(0, keep), state.firstPlayer)
}

export function resign(state: GameState, player: Player): GameState {
  if (state.status !== 'playing') return state

  const next: GameState = {
    ...state,
    status: 'resigned',
    winner: opponentOf(player),
  }
  return next
}
