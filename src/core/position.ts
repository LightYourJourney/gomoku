import { createBoard, DIRECTIONS, idx, inBounds } from './board'
import { replay } from './game'
import { BOARD_SIZE, CELL_COUNT, type Board, type Player, type Point } from './types'

/**
 * 一张棋盘快照。
 *
 * **不是 GameState**：Position 没有手顺、没有胜负派生、没有「合法历史」的承诺。
 * 编辑器直接摆放棋子，不能为了复用 GameState 编一条假的 moves；需要 AI 时
 * 只把 board + nextPlayer 交给引擎，并先过 `analyzePosition` 的静态检查。
 */
export interface Position {
  readonly board: Board
  readonly nextPlayer: Player
}

export type EditTool = 'black' | 'white' | 'erase'

export interface PositionWin {
  readonly player: Player
  readonly points: readonly Point[]
}

/**
 * 已知的合法手顺前缀。
 *
 * 只有「从棋谱载入某一手」才会有它；自由摆盘没有。它证明的是
 * 「这盘面确实来自这条手顺」，不是「任何静态合法的盘面都来自合法对局」。
 */
export interface PositionProvenance {
  readonly kind: 'replay'
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  readonly ply: number
}

export interface PositionReport {
  readonly structural: boolean
  readonly black: number
  readonly white: number
  readonly wins: readonly PositionWin[]
  readonly blackWin: boolean
  readonly whiteWin: boolean
  readonly bothWin: boolean
  readonly full: boolean
  /** 黑白数量与 nextPlayer 是否符合「黑先、轮流落子」的必要条件。 */
  readonly parity: 'ok' | 'mismatch'
  readonly ended: boolean
  /** 只有结构合法、未结束、奇偶一致时才允许交给引擎。 */
  readonly searchable: boolean
  readonly issues: readonly string[]
}

export const EMPTY_POSITION: Position = {
  board: createBoard(),
  nextPlayer: 1,
}

export function clonePosition(position: Position): Position {
  return { board: new Uint8Array(position.board), nextPlayer: position.nextPlayer }
}

export function createPosition(nextPlayer: Player = 1): Position {
  return { board: createBoard(), nextPlayer }
}

export function setNextPlayer(position: Position, nextPlayer: Player): Position {
  return { board: new Uint8Array(position.board), nextPlayer }
}

/**
 * 编辑一格。**覆盖已有棋子是替换**，不是一次合法落子；这里不推进 nextPlayer，
 * 由用户显式设置。擦除也是编辑。
 */
export function applyEdit(position: Position, point: Point, tool: EditTool): Position {
  if (!inBounds(point.x, point.y)) return position
  const next = new Uint8Array(position.board)
  next[idx(point.x, point.y)] = tool === 'black' ? 1 : tool === 'white' ? 2 : 0
  return { board: next, nextPlayer: position.nextPlayer }
}

export function clearPosition(position: Position): Position {
  return { board: createBoard(), nextPlayer: position.nextPlayer }
}

/** 全盘扫描所有五连（长连也算）；每条连续段只从起点记录一次。 */
export function findWins(board: Board): PositionWin[] {
  const wins: PositionWin[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const player = board[idx(x, y)]
      if (player !== 1 && player !== 2) continue

      for (const dir of DIRECTIONS) {
        const prevX = x - dir.x
        const prevY = y - dir.y
        if (inBounds(prevX, prevY) && board[idx(prevX, prevY)] === player) continue

        const points: Point[] = []
        let cx = x
        let cy = y
        while (inBounds(cx, cy) && board[idx(cx, cy)] === player) {
          points.push({ x: cx, y: cy })
          cx += dir.x
          cy += dir.y
        }
        if (points.length >= 5) wins.push({ player, points })
      }
    }
  }

  return wins
}

export function analyzePosition(position: Position): PositionReport {
  const issues: string[] = []
  let structural = position.board.length === CELL_COUNT
  let black = 0
  let white = 0

  for (let i = 0; i < position.board.length; i++) {
    const cell = position.board[i]
    if (cell === 1) black += 1
    else if (cell === 2) white += 1
    else if (cell !== 0) structural = false
  }
  if (!structural) issues.push('棋盘数据不合法：只允许空、黑、白三种值')

  const wins = findWins(position.board)
  const blackWin = wins.some((win) => win.player === 1)
  const whiteWin = wins.some((win) => win.player === 2)
  const bothWin = blackWin && whiteWin
  const full = black + white === CELL_COUNT
  const parity: PositionReport['parity'] =
    position.nextPlayer === 1 ? (black === white ? 'ok' : 'mismatch') : black === white + 1 ? 'ok' : 'mismatch'

  if (bothWin) issues.push('黑白双方同时五连，局面不合法')
  else if (blackWin) issues.push('黑棋已有五连，局面已结束')
  else if (whiteWin) issues.push('白棋已有五连，局面已结束')
  else if (full) issues.push('棋盘已满，和棋')

  if (parity === 'mismatch') {
    issues.push(
      `棋子数与下一手不符：黑 ${black} / 白 ${white}，轮到${position.nextPlayer === 1 ? '黑' : '白'}棋`,
    )
  }

  const ended = wins.length > 0 || full
  return {
    structural,
    black,
    white,
    wins,
    blackWin,
    whiteWin,
    bothWin,
    full,
    parity,
    ended,
    searchable: structural && !ended && parity === 'ok',
    issues,
  }
}

export interface ReplayPosition {
  readonly position: Position
  readonly provenance: PositionProvenance
}

/** 从已知合法手顺的前 `ply` 手生成快照；这是唯一能保留「可重放」证明的入口。 */
export function positionFromReplay(
  moves: readonly Point[],
  firstPlayer: Player,
  ply: number,
): ReplayPosition {
  if (!Number.isInteger(ply) || ply < 0 || ply > moves.length) {
    throw new RangeError(`回放位置必须是 0–${moves.length} 的整数`)
  }
  const prefix = moves.slice(0, ply)
  const state = replay(prefix, firstPlayer)
  // replay 遇到非法/重复手会提前停下。前缀本身就是坏的时候，宁可报错，
  // 也不要把「重放到一半的盘面」当成第 ply 手交出去。
  if (state.moves.length !== prefix.length) {
    throw new RangeError('回放前缀包含非法落子')
  }
  return {
    position: {
      board: new Uint8Array(state.board),
      nextPlayer: state.current,
    },
    provenance: {
      kind: 'replay',
      moves: prefix.map((point) => ({ ...point })),
      firstPlayer,
      ply,
    },
  }
}

export function boardsEqual(a: Board, b: Board): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 已知手顺是否仍能逐步重建出当前盘面；编辑过就不再成立。 */
export function isReplayConsistent(
  position: Position,
  provenance: PositionProvenance | null,
): boolean {
  if (provenance === null) return false
  if (provenance.ply !== provenance.moves.length) return false
  const state = replay(provenance.moves, provenance.firstPlayer)
  // 非法/重复手顺会让 replay 提前截断；盘面碰巧相同也不能算「完整重放」。
  if (state.moves.length !== provenance.moves.length) return false
  return boardsEqual(state.board, position.board) && state.current === position.nextPlayer
}
