import { idx, opponentOf } from '../core/board'
import { BOARD_SIZE, type Board, type Player, type Point } from '../core/types'
import { candidateMoves } from './candidates'
import { DIFFICULTY_PARAMS, type DifficultyParams } from './difficulty'
import { evaluateBoard, WIN_SCORE } from './evaluate'
import { isWinningPoint, moveOrderScore, threatAt } from './patterns'
import {
  computeKey,
  createTranspositionTable,
  toggleStone,
  toggleTurn,
  type TranspositionTable,
  type TtFlag,
  type ZobristKey,
} from './transposition'
import type { Confidence, SearchReason, SearchRequest, SearchResponse } from './types'

const CENTER: Point = { x: Math.floor(BOARD_SIZE / 2), y: Math.floor(BOARD_SIZE / 2) }

/**
 * 找必胜点时只需看紧贴棋子的空位：任何能连成五子的落点，都必然与己方棋子相邻。
 * 相比完整候选集小得多，而这一步在搜索的每个节点都要做。
 */
const WIN_CHECK_RADIUS = 1

/**
 * 高分值到这个范围内就当作「必胜分」，存表/查表时要按 ply 归一化。
 *
 * 不归一化会出错：`canWinNow` 返回的是 `WIN_SCORE - 距根的步数`，这个差值
 * 耦合了「本次迭代的目标深度」；同一局面在第 2 层和第 5 层搜到会得到不同分值，
 * 直接存表就会让 AI 放弃立刻成五、去追一条「更早赢」的假路线。
 */
const MATE_MARGIN = 1_000

/** 每层最多记两个杀手着法：同层里造成过 beta 截断的着法，下一层优先试。 */
const KILLER_SLOTS = 2

export interface SearchOptions {
  readonly width: number
  readonly maxDepth: number
  readonly budgetMs: number
  /** 关闭只用于对照基准，不用于实战。 */
  readonly transposition: boolean
}

export interface SearchOutcome {
  readonly move: Point | null
  readonly score: number
  /** 实际完整搜完的深度。0 表示只用了启发式兜底。 */
  readonly depth: number
  readonly nodes: number
  /** 置换表命中次数，用于判断置换表是否真的在起作用。 */
  readonly ttHits: number
  readonly reason: SearchReason
}

interface SearchContext {
  readonly options: SearchOptions
  readonly now: () => number
  readonly deadline: number
  readonly table: TranspositionTable | null
  readonly killers: Array<Array<Point | null>>
  nodes: number
  ttHits: number
  expired: boolean
}

function hasExpired(ctx: SearchContext): boolean {
  if (!ctx.expired && ctx.now() >= ctx.deadline) ctx.expired = true
  return ctx.expired
}

/** 存表前把「距根的步数」换算成「距该节点的步数」，查表时再换算回来。 */
function toTableScore(score: number, ply: number): number {
  if (score > WIN_SCORE - MATE_MARGIN) return score + ply
  if (score < -WIN_SCORE + MATE_MARGIN) return score - ply
  return score
}

function fromTableScore(score: number, ply: number): number {
  if (score > WIN_SCORE - MATE_MARGIN) return score - ply
  if (score < -WIN_SCORE + MATE_MARGIN) return score + ply
  return score
}

function recordKiller(ctx: SearchContext, ply: number, move: Point): void {
  const slot = ctx.killers[ply]
  if (slot === undefined) return
  if (slot[0] !== null && slot[0].x === move.x && slot[0].y === move.y) return
  for (let i = slot.length - 1; i > 0; i--) slot[i] = slot[i - 1]
  slot[0] = move
}

function isKiller(ctx: SearchContext, ply: number, move: Point): boolean {
  const slot = ctx.killers[ply]
  if (slot === undefined) return false
  return slot.some((killer) => killer !== null && killer.x === move.x && killer.y === move.y)
}

function canWinNow(board: Board, player: Player): boolean {
  for (const point of candidateMoves(board, WIN_CHECK_RADIUS)) {
    if (isWinningPoint(board, point, player)) return true
  }
  return false
}

/**
 * 排序：置换表里的最佳着法最优先，其次是杀手着法，剩下的按攻防价值排。
 * alpha-beta 的剪枝效率几乎全靠着法排序。
 */
function orderMoves(
  board: Board,
  candidates: readonly Point[],
  player: Player,
  width: number,
  ctx: SearchContext,
  ply: number,
  tableMove: Point | null,
): Point[] {
  const scored = candidates.map((point) => {
    let score = moveOrderScore(board, point, player)
    if (tableMove !== null && point.x === tableMove.x && point.y === tableMove.y) score += 1_000_000
    else if (isKiller(ctx, ply, point)) score += 500_000
    return { point, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, width).map((entry) => entry.point)
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
      threatAt(board, point, player) * params.attack +
      threatAt(board, point, opponent) * params.defense
    if (score > bestScore) {
      bestScore = score
      best = point
    }
  }

  return { move: best, score: bestScore }
}

/**
 * Negamax + alpha-beta + 置换表。
 *
 * 返回值从 `player` 的视角度量。叶子用纯局面评估；每个节点先看「轮到的一方能不能
 * 立刻成五」，这比让评估函数去近似先手优势更准。
 */
function negamax(
  board: Board,
  player: Player,
  key: ZobristKey,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  ctx: SearchContext,
): number {
  ctx.nodes++

  if (hasExpired(ctx)) return evaluateBoard(board, player)

  const alphaOrigin = alpha
  const cached = ctx.table?.probe(key, depth) ?? null

  if (cached !== null) {
    ctx.ttHits++
    const cachedScore = fromTableScore(cached.score, ply)
    if (cached.flag === 'exact') return cachedScore
    if (cached.flag === 'lower') {
      if (cachedScore > alpha) alpha = cachedScore
    } else if (cachedScore < beta) {
      beta = cachedScore
    }
    if (alpha >= beta) return cachedScore
  }

  if (canWinNow(board, player)) return WIN_SCORE - ply

  if (depth <= 0) return evaluateBoard(board, player)

  const candidates = orderMoves(
    board,
    candidateMoves(board),
    player,
    ctx.options.width,
    ctx,
    ply,
    cached?.move ?? null,
  )
  if (candidates.length === 0) return evaluateBoard(board, player)

  let best = -Infinity
  let bestMove: Point | null = null
  let lowerBound = alpha

  for (const point of candidates) {
    const index = idx(point.x, point.y)
    board[index] = player
    const childKey = toggleTurn(toggleStone(key, index, player))
    const value = -negamax(
      board,
      opponentOf(player),
      childKey,
      depth - 1,
      ply + 1,
      -beta,
      -lowerBound,
      ctx,
    )
    board[index] = 0

    if (value > best) {
      best = value
      bestMove = point
    }
    if (best > lowerBound) lowerBound = best

    if (lowerBound >= beta) {
      if (!isKiller(ctx, ply, point)) recordKiller(ctx, ply, point)
      break
    }
  }

  if (ctx.table !== null && !ctx.expired && bestMove !== null) {
    const flag: TtFlag = best <= alphaOrigin ? 'upper' : best >= beta ? 'lower' : 'exact'
    ctx.table.store(key, {
      lo: key.lo,
      depth,
      score: toTableScore(best, ply),
      flag,
      move: bestMove,
    })
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
  key: ZobristKey,
  depth: number,
  ctx: SearchContext,
): RootResult | null {
  const tableMove = ctx.table?.probe(key, depth)?.move ?? null
  const ordered = orderMoves(
    board,
    candidateMoves(board),
    player,
    ctx.options.width,
    ctx,
    0,
    tableMove,
  )

  let alpha = -Infinity
  let best: RootResult | null = null
  let bestMove: Point | null = null

  for (const point of ordered) {
    if (hasExpired(ctx)) return null

    const index = idx(point.x, point.y)
    board[index] = player
    ctx.nodes++
    const childKey = toggleTurn(toggleStone(key, index, player))
    const value = -negamax(board, opponentOf(player), childKey, depth - 1, 1, -Infinity, -alpha, ctx)
    board[index] = 0

    if (best === null || value > best.score) {
      best = { move: point, score: value, depth }
      bestMove = point
    }
    if (value > alpha) alpha = value
  }

  if (hasExpired(ctx)) return null

  if (ctx.table !== null && best !== null && bestMove !== null) {
    // 根节点存 exact：这是完整搜索出来的结论。
    ctx.table.store(key, {
      lo: key.lo,
      depth,
      score: toTableScore(best.score, 0),
      flag: 'exact',
      move: bestMove,
    })
  }

  return best
}

/**
 * 搜索主体：纯同步、无副作用（**不改传入的棋盘**），Worker 只是它的外壳。
 *
 * `now` 注入进来是为了让超时行为可测——测试可以确定性地让时钟跳过预算，
 * 不必依赖真实时间，也不会因为机器快慢而 flaky。
 */
export function searchBoard(
  board: Board,
  player: Player,
  options: SearchOptions,
  now: () => number,
): SearchOutcome {
  const startedAt = now()
  const own = board.slice()
  const opponent = opponentOf(player)

  // 三条捷径都不做搜索，因此节点数与置换表命中数都是 0。
  const shortcut = { depth: 0, nodes: 0, ttHits: 0 } as const

  if (!own.some((cell) => cell !== 0)) {
    return { ...shortcut, move: CENTER, score: 0, reason: 'opening' }
  }

  const candidates = candidateMoves(own)
  if (candidates.length === 0) {
    return { ...shortcut, move: null, score: 0, reason: 'no_move' }
  }

  for (const point of candidates) {
    if (isWinningPoint(own, point, player)) {
      return { ...shortcut, move: point, score: WIN_SCORE, reason: 'win' }
    }
  }

  const threats = candidates.filter((point) => isWinningPoint(own, point, opponent))
  if (threats.length > 0) {
    // 必防时用一步贪心在若干个成五点里挑对我方最有价值的那个。
    const block = bestGreedy(own, threats, player, DIFFICULTY_PARAMS.easy)
    return { ...shortcut, move: block.move, score: block.score, reason: 'block' }
  }

  const ctx: SearchContext = {
    options,
    now,
    deadline: startedAt + options.budgetMs,
    table: options.transposition ? createTranspositionTable() : null,
    killers: Array.from({ length: options.maxDepth + 2 }, () =>
      Array.from({ length: KILLER_SLOTS }, () => null as Point | null),
    ),
    nodes: 0,
    ttHits: 0,
    expired: false,
  }

  const greedy = bestGreedy(own, candidates, player, DIFFICULTY_PARAMS.easy)
  const key = computeKey(own, player)

  // 先用贪心结果兜底，再逐层加深——这样超时也总能交出一个合法着法。
  let best: RootResult = { move: greedy.move, score: greedy.score, depth: 0 }
  let timedOut = false

  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const found = searchRoot(own, player, key, depth, ctx)
    if (found === null) {
      timedOut = true
      break
    }
    best = found
  }

  return {
    move: best.move,
    score: best.score,
    depth: best.depth,
    nodes: ctx.nodes,
    ttHits: ctx.ttHits,
    reason: timedOut ? 'timeout' : 'search',
  }
}

/**
 * 协议外壳：把 difficulty 换算成搜索选项，再交给 `searchBoard`。
 *
 * 保证：除非棋盘已满，否则一定返回一个落在空位上的着法。
 */
export function chooseMove(request: SearchRequest): SearchResponse {
  const startedAt = Date.now()
  const params = DIFFICULTY_PARAMS[request.difficulty]

  const outcome = searchBoard(
    request.board,
    request.player,
    {
      width: params.width,
      maxDepth: params.depth,
      budgetMs: request.budgetMs ?? params.budgetMs,
      transposition: true,
    },
    Date.now,
  )

  const confidence: Confidence = outcome.reason === 'timeout' ? 'heuristic' : 'exact'

  return {
    requestId: request.requestId,
    gameVersion: request.gameVersion,
    move: outcome.move,
    score: outcome.score,
    depth: outcome.depth,
    nodes: outcome.nodes,
    elapsedMs: Date.now() - startedAt,
    confidence,
    reason: outcome.reason,
  }
}
