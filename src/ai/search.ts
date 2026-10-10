import { idx, opponentOf } from '../core/board'
import { BOARD_SIZE, type Board, type Player, type Point } from '../core/types'
import { candidateMoves } from './candidates'
import { DIFFICULTY_PARAMS, type DifficultyParams } from './difficulty'
import { evaluateBoard, WIN_SCORE } from './evaluate'
import { isWinningPoint, moveOrderScore, threatAt } from './patterns'
import type { Confidence, SearchReason, SearchRequest, SearchResponse } from './types'

const CENTER: Point = { x: Math.floor(BOARD_SIZE / 2), y: Math.floor(BOARD_SIZE / 2) }

/**
 * 找必胜点时只需看紧贴棋子的空位：任何能连成五子的落点，都必然与己方棋子相邻。
 * 相比完整候选集小得多，而这一步在搜索的每个节点都要做。
 */
const WIN_CHECK_RADIUS = 1

interface SearchContext {
  readonly params: DifficultyParams
  readonly deadline: number
  nodes: number
  expired: boolean
}

function hasExpired(ctx: SearchContext): boolean {
  if (!ctx.expired && Date.now() >= ctx.deadline) ctx.expired = true
  return ctx.expired
}

interface Draft {
  readonly move: Point | null
  readonly score: number
  readonly depth: number
  readonly confidence: Confidence
  readonly reason: SearchReason
}

function respond(
  request: SearchRequest,
  startedAt: number,
  nodes: number,
  draft: Draft,
): SearchResponse {
  return {
    requestId: request.requestId,
    gameVersion: request.gameVersion,
    move: draft.move,
    score: draft.score,
    depth: draft.depth,
    nodes,
    elapsedMs: Date.now() - startedAt,
    confidence: draft.confidence,
    reason: draft.reason,
  }
}

function canWinNow(board: Board, player: Player): boolean {
  for (const point of candidateMoves(board, WIN_CHECK_RADIUS)) {
    if (isWinningPoint(board, point, player)) return true
  }
  return false
}

/** 按「这一手的攻防综合价值」排序，只保留前 width 个——alpha-beta 的剪枝效率几乎全靠它。 */
function orderMoves(
  board: Board,
  candidates: readonly Point[],
  player: Player,
  width: number,
): Point[] {
  return candidates
    .map((point) => ({ point, score: moveOrderScore(board, point, player) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, width)
    .map((entry) => entry.point)
}

/**
 * 一步贪心：只评估这一手本身的攻防价值，不做任何展开。
 * 用作搜索的兜底（保证任何情况下都能给出一个合法且不愚蠢的着法）。
 */
function bestGreedy(
  board: Board,
  candidates: readonly Point[],
  player: Player,
  params: DifficultyParams,
): { move: Point; score: number } {
  const opponent = opponentOf(player)
  let best = candidates[0]
  let bestScore = -Infinity

  for (const point of candidates) {
    const score =
      threatAt(board, point, player) * params.attack + threatAt(board, point, opponent) * params.defense
    if (score > bestScore) {
      bestScore = score
      best = point
    }
  }

  return { move: best, score: bestScore }
}

/**
 * Negamax + alpha-beta。
 *
 * 返回值从 `player` 的视角度量。叶子用纯局面评估；每个节点先看「轮到的一方能不能
 * 立刻成五」，这比让评估函数去近似先手优势更准。
 */
function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchContext,
): number {
  ctx.nodes++

  if (hasExpired(ctx)) return evaluateBoard(board, player)

  // 越早取胜越好：用已消耗的层数做一点偏好。
  if (canWinNow(board, player)) return WIN_SCORE - (ctx.params.depth - depth)

  if (depth <= 0) return evaluateBoard(board, player)

  const candidates = orderMoves(board, candidateMoves(board), player, ctx.params.width)
  if (candidates.length === 0) return evaluateBoard(board, player)

  let best = -Infinity
  let lowerBound = alpha

  for (const point of candidates) {
    board[idx(point.x, point.y)] = player
    const value = -negamax(board, opponentOf(player), depth - 1, -beta, -lowerBound, ctx)
    board[idx(point.x, point.y)] = 0

    if (value > best) best = value
    if (best > lowerBound) lowerBound = best
    if (lowerBound >= beta) break
  }

  return best
}

interface RootResult {
  readonly move: Point
  readonly score: number
  readonly depth: number
}

/** 返回 null 表示这一层没能在预算内搜完，调用方应丢弃整层结果。 */
function searchRoot(
  board: Board,
  player: Player,
  depth: number,
  ctx: SearchContext,
): RootResult | null {
  const ordered = orderMoves(board, candidateMoves(board), player, ctx.params.width)
  let alpha = -Infinity
  let best: RootResult | null = null

  for (const point of ordered) {
    if (hasExpired(ctx)) return null

    board[idx(point.x, point.y)] = player
    ctx.nodes++
    const value = -negamax(board, opponentOf(player), depth - 1, -Infinity, -alpha, ctx)
    board[idx(point.x, point.y)] = 0

    if (best === null || value > best.score) best = { move: point, score: value, depth }
    if (value > alpha) alpha = value
  }

  if (hasExpired(ctx)) return null
  return best
}

/**
 * 为 `request.player` 选一手棋。
 *
 * 纯同步函数，不依赖 Worker，因此可以在单测里直接调用；Worker 只是它的外壳。
 * 保证：除非棋盘已满，否则一定返回一个落在空位上的着法。
 */
export function chooseMove(request: SearchRequest): SearchResponse {
  const startedAt = Date.now()
  const params = DIFFICULTY_PARAMS[request.difficulty]
  const { player } = request

  // 搜索靠「落子 / 撤销」在同一块棋盘上来回走。复制一份再用，
  // 否则调用方手里的棋盘（对 core 来说就是唯一真相）会在搜索期间被临时改写，
  // 现在只因为 Worker 的结构化克隆才没出事。
  const board = request.board.slice()

  if (!board.some((cell) => cell !== 0)) {
    return respond(request, startedAt, 0, {
      move: CENTER,
      score: 0,
      depth: 0,
      confidence: 'exact',
      reason: 'opening',
    })
  }

  const candidates = candidateMoves(board)
  if (candidates.length === 0) {
    return respond(request, startedAt, 0, {
      move: null,
      score: 0,
      depth: 0,
      confidence: 'exact',
      reason: 'no_move',
    })
  }

  const opponent = opponentOf(player)

  for (const point of candidates) {
    if (isWinningPoint(board, point, player)) {
      return respond(request, startedAt, 0, {
        move: point,
        score: WIN_SCORE,
        depth: 0,
        confidence: 'exact',
        reason: 'win',
      })
    }
  }

  const threats = candidates.filter((point) => isWinningPoint(board, point, opponent))
  if (threats.length > 0) {
    const block = bestGreedy(board, threats, player, params)
    return respond(request, startedAt, 0, {
      move: block.move,
      score: block.score,
      depth: 0,
      confidence: 'exact',
      reason: 'block',
    })
  }

  const budgetMs = request.budgetMs ?? params.budgetMs
  const ctx: SearchContext = { params, deadline: startedAt + budgetMs, nodes: 0, expired: false }
  const greedy = bestGreedy(board, candidates, player, params)

  // 先用贪心结果兜底，再逐层加深——这样超时也总能交出一个合法着法。
  let best: RootResult = { move: greedy.move, score: greedy.score, depth: 0 }
  let timedOut = false

  for (let depth = 1; depth <= params.depth; depth++) {
    const found = searchRoot(board, player, depth, ctx)
    if (found === null) {
      timedOut = true
      break
    }
    best = found
  }

  return respond(request, startedAt, ctx.nodes, {
    move: best.move,
    score: best.score,
    depth: best.depth,
    confidence: timedOut ? 'heuristic' : 'exact',
    reason: timedOut ? 'timeout' : 'search',
  })
}
