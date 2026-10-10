import { idx, opponentOf } from '../core/board'
import { BOARD_SIZE, type Board, type Player, type Point } from '../core/types'
import { candidateMoves } from './candidates'
import { DIFFICULTY_PARAMS, type DifficultyParams } from './difficulty'
import { evaluateBoard, WIN_SCORE } from './evaluate'
import {
  analyzeFast,
  analyzePoint,
  dominantThreat,
  isWinningPoint,
  shapeScore,
  threatAt,
  threatScoreWith,
} from './patterns'
import { findForcedWin } from './threat'
import {
  computeKey,
  createTranspositionTable,
  toggleStone,
  toggleTurn,
  type TranspositionTable,
  type TtFlag,
  type ZobristKey,
} from './transposition'
import type {
  Confidence,
  MoveSuggestion,
  SearchReason,
  SearchRequest,
  SearchResponse,
  Urgency,
} from './types'

const CENTER: Point = { x: Math.floor(BOARD_SIZE / 2), y: Math.floor(BOARD_SIZE / 2) }

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


/**
 * 算杀能占用的预算比例。
 *
 * 给满会出事：没杀的局面下算杀会一路搜到超时，主搜索只剩 0 预算，
 * 高档反而比低档更弱。三分之一是实测下来算杀够用、主搜索也留得下余地的比例。
 */
const THREAT_BUDGET_SHARE = 0.35

/**
 * 搜索选项 = 难度参数 + 协议层补的三项。
 *
 * **继承而不是逐字复制字段**，这点是刻意的：这里曾经把 `DifficultyParams` 的七个
 * 字段手抄一遍，结果一次重构漏抄了 `attack` / `defense`，`beginner.defense = 0.6`
 * 静默失效而类型检查一声不吭。继承之后，难度参数新增字段会自动流进来，
 * 漏抄成了编译错误。
 */
export interface SearchOptions extends Omit<DifficultyParams, 'depth'> {
  /** 搜索深度上限，对应 `DifficultyParams.depth`。 */
  readonly maxDepth: number
  /** 关闭只用于对照基准，不用于实战。 */
  readonly transposition: boolean
  /**
   * 是否额外算出提示用的候选与紧急度。
   *
   * 实测约 0.5 ms（44 个候选点、攻防各分析一次），相对数百毫秒的预算可以忽略；
   * 做成开关不是为了省钱，而是因为出着法时这两个字段根本不会出现在响应里，
   * 没必要算。
   */
  readonly diagnostics?: boolean
}

/**
 * 把难度参数翻译成搜索选项。
 *
 * 协议层与测试都走这一个入口，不要各写一份逐字段搬运。
 */
export function searchOptionsFor(
  params: DifficultyParams,
  overrides: { readonly budgetMs?: number; readonly diagnostics?: boolean } = {},
): SearchOptions {
  const { depth, budgetMs, ...rest } = params

  return {
    ...rest,
    maxDepth: depth,
    budgetMs: overrides.budgetMs ?? budgetMs,
    transposition: true,
    diagnostics: overrides.diagnostics,
  }
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
  /** 按推荐度降序，最多 3 条。未开启 diagnostics 时是空数组。 */
  readonly candidates: readonly MoveSuggestion[]
  /** 未开启 diagnostics 时是 'normal'。 */
  readonly urgency: Urgency
}

interface OrderedMoves {
  readonly points: readonly Point[]
  /** 非 null 表示轮到我方可以立刻成五，这个点就是制胜点 */
  readonly winNow: Point | null
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

/**
 * 排序：置换表里的最佳着法最优先，其次是杀手着法，剩下的按攻防价值排。
 * alpha-beta 的剪枝效率几乎全靠着法排序。
 *
 * 排序这一遍顺带把「我能不能立刻成五」判掉并返回 null——原来那是一次独立的
 * 扫描，而它对每个候选都要重算一遍棋型分。搜索每个节点都要跑这两件事，
 * 合并之后省掉整整一遍扫描，这是实测里最划算的一处优化。
 */
function orderMoves(
  board: Board,
  candidates: readonly Point[],
  player: Player,
  width: number,
  ctx: SearchContext,
  ply: number,
  tableMove: Point | null,
): OrderedMoves {
  const opponent = opponentOf(player)
  const scored: Array<{ point: Point; score: number }> = []

  for (const point of candidates) {
    const mine = analyzeFast(board, point, player)
    if (mine.five) return { points: [], winNow: point }

    let score = threatScoreWith(board, point, player, mine)
    score += threatScoreWith(board, point, opponent, analyzeFast(board, point, opponent))

    if (tableMove !== null && point.x === tableMove.x && point.y === tableMove.y) score += 1_000_000
    else if (isKiller(ctx, ply, point)) score += 500_000

    scored.push({ point, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return { points: scored.slice(0, width).map((entry) => entry.point), winNow: null }
}

/**
 * 提示用的候选着法。
 *
 * 这里**用完整棋型分析**（含精确三判定与隔子型）——它不是搜索热路径，
 * 一次只算几十个点，换取更准的攻防标注是划算的。
 */
function buildSuggestions(board: Board, player: Player, limit = 3): MoveSuggestion[] {
  const opponent = opponentOf(player)

  const scored = candidateMoves(board).map((point) => {
    const attack = analyzePoint(board, point, player)
    const defense = analyzePoint(board, point, opponent)
    return {
      move: point,
      score: shapeScore(attack) + shapeScore(defense),
      attack: dominantThreat(attack),
      defense: dominantThreat(defense),
    }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/** 当前局面对该走的一方的紧急程度。 */
function computeUrgency(board: Board, player: Player): Urgency {
  const opponent = opponentOf(player)
  const near = candidateMoves(board, 1)

  if (near.some((point) => isWinningPoint(board, point, player))) return 'win'
  if (near.some((point) => isWinningPoint(board, point, opponent))) return 'mustBlock'

  // 对手一手就能做出活四，说明防线已经漏了
  for (const point of candidateMoves(board)) {
    if (analyzeFast(board, point, opponent).winningPoints.length >= 2) return 'danger'
  }

  return 'normal'
}

/**
 * 一步贪心：只评估这一手本身的攻防价值，不做任何展开。
 * 用作搜索的兜底（保证任何情况下都能给出一个合法且不愚蠢的着法）。
 */
function bestGreedy(
  board: Board,
  candidates: readonly Point[],
  player: Player,
  params: Pick<DifficultyParams, 'attack' | 'defense'>,
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

  if (candidates.winNow !== null) return WIN_SCORE - ply
  if (candidates.points.length === 0) return evaluateBoard(board, player)

  let best = -Infinity
  let bestMove: Point | null = null
  let lowerBound = alpha

  for (const point of candidates.points) {
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

/**
 * 返回 null 表示这一层没能在预算内搜完，调用方应丢弃整层结果。
 *
 * `hintMove` 是上一层迭代搜出来的最佳着法，由调用方显式传进来。
 *
 * 这里**不能**靠查置换表拿它：`probe(key, depth)` 的语义是「条目深度不足即未命中」，
 * 而上一层存下的条目深度正好是 `depth - 1`，于是每次都在这里落空——根节点的
 * 「置换表着法优先」曾经是一段永远拿不到值的死代码。
 *
 * 顺手修好它带来的收益**不大**：实测高级档开局 10,559 → 10,076 节点（约 5%），
 * 完成深度没有变化。这条留着是因为它本来就是这段注释承诺的行为，不代表它是
 * 什么性能杠杆。
 */
function searchRoot(
  board: Board,
  player: Player,
  key: ZobristKey,
  depth: number,
  ctx: SearchContext,
  hintMove: Point | null,
): RootResult | null {
  const ordered = orderMoves(
    board,
    candidateMoves(board),
    player,
    ctx.options.width,
    ctx,
    0,
    hintMove,
  )

  if (ordered.winNow !== null) {
    return { move: ordered.winNow, score: WIN_SCORE, depth }
  }

  let alpha = -Infinity
  let best: RootResult | null = null

  for (const point of ordered.points) {
    if (hasExpired(ctx)) return null

    const index = idx(point.x, point.y)
    board[index] = player
    ctx.nodes++
    const childKey = toggleTurn(toggleStone(key, index, player))
    const value = -negamax(board, opponentOf(player), childKey, depth - 1, 1, -Infinity, -alpha, ctx)
    board[index] = 0

    if (best === null || value > best.score) best = { move: point, score: value, depth }
    if (value > alpha) alpha = value
  }

  if (hasExpired(ctx)) return null

  // 根节点**不写置换表**：根局面的 key 不可能被任何后代命中（后代都多至少一颗子），
  // 写进去只会是一条永远读不到的记录。
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

  const diagnostics =
    options.diagnostics === true
      ? { candidates: buildSuggestions(own, player), urgency: computeUrgency(own, player) }
      : { candidates: [] as readonly MoveSuggestion[], urgency: 'normal' as Urgency }

  // 三条捷径都不做搜索，因此节点数与置换表命中数都是 0。
  const shortcut = { depth: 0, nodes: 0, ttHits: 0, ...diagnostics } as const

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
    const block = bestGreedy(own, threats, player, options)
    return { ...shortcut, move: block.move, score: block.score, reason: 'block' }
  }

  const deadline = startedAt + options.budgetMs

  // 算杀放在主搜索之前。严格共用同一份预算会出问题：算杀在没杀的局面下会一直
  // 搜到超时，把预算吃干净，主搜索只剩时间预算 0——专家档于是变得又慢又不强。
  // 所以给它**一个上限比例**，剩下的留给迭代加深。
  if (options.threatPlies > 0) {
    const forced = findForcedWin(own, player, {
      maxPlies: options.threatPlies,
      allowThrees: options.threatThrees,
      deadline: startedAt + Math.floor(options.budgetMs * THREAT_BUDGET_SHARE),
      now,
    })

    if (forced.move !== null) {
      return {
        move: forced.move,
        score: WIN_SCORE,
        depth: 0,
        nodes: forced.nodes,
        ttHits: 0,
        reason: 'win',
        ...diagnostics,
      }
    }
  }

  const ctx: SearchContext = {
    options,
    now,
    deadline,
    table: options.transposition ? createTranspositionTable() : null,
    killers: Array.from({ length: options.maxDepth + 2 }, () =>
      Array.from({ length: KILLER_SLOTS }, () => null as Point | null),
    ),
    nodes: 0,
    ttHits: 0,
    expired: false,
  }

  const greedy = bestGreedy(own, candidates, player, options)
  const key = computeKey(own, player)

  // 先用贪心结果兜底，再逐层加深——这样超时也总能交出一个合法着法。
  let best: RootResult = { move: greedy.move, score: greedy.score, depth: 0 }
  let timedOut = false
  // 上一层迭代的结论，喂给下一层做首选着法
  let hint: Point | null = null

  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const found = searchRoot(own, player, key, depth, ctx, hint)

    if (found === null) {
      timedOut = true
      break
    }
    best = found
    hint = found.move
  }

  return {
    move: best.move,
    score: best.score,
    depth: best.depth,
    nodes: ctx.nodes,
    ttHits: ctx.ttHits,
    reason: timedOut ? 'timeout' : 'search',
    ...diagnostics,
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
    searchOptionsFor(params, {
      budgetMs: request.budgetMs,
      diagnostics: request.purpose === 'hint',
    }),
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
    candidates: outcome.candidates,
    urgency: outcome.urgency,
  }
}
