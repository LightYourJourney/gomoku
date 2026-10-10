import { idx, opponentOf } from '../core/board'
import type { Board, Player, Point } from '../core/types'
import { candidateMoves } from './candidates'
import { analyzeFast, isWinningPoint } from './patterns'

export interface ThreatSearchResult {
  /** 找到的强制取胜着法；没有则为 null */
  readonly move: Point | null
  /** 取胜链长度（手数）；0 表示没找到 */
  readonly plies: number
  readonly nodes: number
}

export interface ThreatSearchOptions {
  readonly maxPlies: number
  /**
   * 是否允许活三作为强制着法（VCT）。false 即纯 VCF。
   *
   * 开启后代价明显上升：冲四的应手唯一，活三不是——守方有大量「不立即输」的
   * 应手，sound 的搜索必须把它们全部枚举。
   */
  readonly allowThrees: boolean
  readonly deadline: number
  readonly now: () => number
}

/** 找成五点只需看紧贴棋子的空位。 */
const WIN_CHECK_RADIUS = 1

/**
 * 一条取胜链里最多允许出现几层活三。
 *
 * 每多一层，守方应手要全枚举的分支就再乘一遍。限制在一层，既能覆盖
 * 「先做一个活三逼出弱点、再用连续冲四收掉」这类常见杀型，代价也还可控。
 * 这是**有意保留的漏杀**：更长的活三链目前找不到，但绝不会因此谎报。
 */
const MAX_THREE_LAYERS = 1

interface ThreatContext {
  readonly options: ThreatSearchOptions
  nodes: number
  expired: boolean
}

interface AttackResult {
  /** 取胜所需手数；0 表示这条线走不通 */
  readonly plies: number
  readonly move: Point | null
}

const NO_WIN: AttackResult = { plies: 0, move: null }

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

function timeUp(ctx: ThreatContext): boolean {
  if (!ctx.expired && ctx.options.now() >= ctx.options.deadline) ctx.expired = true
  return ctx.expired
}

/** 此刻 `player` 能立刻成五的全部空点。 */
function winningPointsNow(board: Board, player: Player): Point[] {
  const points: Point[] = []
  for (const point of candidateMoves(board, WIN_CHECK_RADIUS)) {
    if (isWinningPoint(board, point, player)) points.push(point)
  }
  return points
}

interface FourMaker {
  readonly point: Point
  /** 落子后己方的成点数：1 = 冲四，≥2 = 活四 */
  readonly winning: readonly Point[]
}

/**
 * 此刻 `player` 落子就能做出四（含活四）的全部空点。
 *
 * 这一步是算杀的性能命门：不加它，内层循环要对**全部**空位逐个落子再重扫，
 * 一百来个候选乘上每次上千次读格，单个节点就是十万量级，几层递归直接爆炸。
 * 先筛出真正做得出四的那十几个点，内层循环就只跑它们。
 */
function fourMakers(board: Board, player: Player): FourMaker[] {
  const makers: FourMaker[] = []

  for (const point of candidateMoves(board)) {
    const threat = analyzeFast(board, point, player)
    if (threat.winningPoints.length > 0) {
      makers.push({ point, winning: threat.winningPoints })
    }
  }

  return makers
}

/**
 * 强制取胜搜索。攻方恒为 `player`。返回取胜所需手数与第一步着法。
 *
 * 递归结构上，冲四与活三的区别是关键：
 *
 * - **冲四**（落子后我方恰好一个成五点）：守方不堵就输，应手是**唯一**的。
 *   这条链的枚举因此完备，可以放心递归。
 * - **活三**：守方有大量不立即输的应手。只枚举「堵」是不完备的——守方用
 *   自己的冲四反先就会被我漏掉，从而**误报**一个不存在的杀。所以活三这一层
 *   必须枚举守方**全部**空位应手，并且只允许有限层数。
 *
 * 每层都检查 `deadline`，超时立即收手。**宁可说「没找到」，也绝不给出
 * 没验证过的杀。**
 */
function attack(
  board: Board,
  player: Player,
  remaining: number,
  threesLeft: number,
  ctx: ThreatContext,
  requiredFirst: Point | null,
): AttackResult {
  if (remaining < 1) return NO_WIN
  if (timeUp(ctx)) return NO_WIN
  ctx.nodes++

  const immediate = winningPointsNow(board, player)

  // 指定了首着时，成五点里只有它自己算数——别的成五点不是玩家要走的那一手。
  if (requiredFirst !== null && immediate.some((point) => samePoint(point, requiredFirst))) {
    return { plies: 1, move: requiredFirst }
  }
  if (requiredFirst === null && immediate.length > 0) return { plies: 1, move: immediate[0] }

  return searchForcing(board, player, remaining, threesLeft, ctx, requiredFirst)
}

/**
 * 冲四链与活三链的枚举主体。
 *
 * `requiredFirst` 非空时只考虑以它开局的分支——这是 `isForcedWinStart` 的实现方式：
 * 同一套递归，只是把根节点的分支限死。递归下去一律传 `null`。
 */
function searchForcing(
  board: Board,
  player: Player,
  remaining: number,
  threesLeft: number,
  ctx: ThreatContext,
  requiredFirst: Point | null,
): AttackResult {
  const opponent = opponentOf(player)

  // 冲四链：守方应手唯一。只遍历真正做得出四的点。
  for (const { point: q, winning } of fourMakers(board, player)) {
    if (requiredFirst !== null && !samePoint(q, requiredFirst)) continue
    if (timeUp(ctx)) return NO_WIN

    const index = idx(q.x, q.y)

    if (winning.length >= 2) {
      // 活四要走满三手（我落子、守方堵一端、我成五），剩余手数不够就不能算
      if (remaining < 3) continue

      // 还要确认守方没有反手成五，否则他不必理会
      board[index] = player
      const opponentWins = winningPointsNow(board, opponent)
      board[index] = 0

      if (opponentWins.length === 0) return { plies: 3, move: q }
      continue
    }

    if (remaining >= 3) {
      board[index] = player
      const opponentWins = winningPointsNow(board, opponent)
      let found = NO_WIN

      if (opponentWins.length === 0) {
        // 守方被迫只能堵这个成五点
        const forcedIndex = idx(winning[0]!.x, winning[0]!.y)
        board[forcedIndex] = opponent
        const rest = attack(board, player, remaining - 2, threesLeft, ctx, null)
        board[forcedIndex] = 0
        if (rest.plies > 0) found = { plies: 2 + rest.plies, move: q }
      }

      board[index] = 0
      if (found.plies > 0 && found.plies <= remaining) return found
    }
  }

  const candidates = candidateMoves(board)

  // 活三链：守方应手必须全枚举
  if (ctx.options.allowThrees && threesLeft > 0 && remaining >= 5) {
    for (const q of candidates) {
      if (requiredFirst !== null && !samePoint(q, requiredFirst)) continue
      if (timeUp(ctx)) return NO_WIN

      const index = idx(q.x, q.y)
      board[index] = player

      const myWins = winningPointsNow(board, player)
      const opponentWins = winningPointsNow(board, opponent)
      // 能立刻成五或已经做出活四的，上面那一段处理过了。
      //
      // `fourMakers` 每轮都要重算，看着像冗余，其实是**固有代价**：循环每轮都往
      // 棋盘上放了一颗不同的子，做得出四的点当然不同。单节点因此是 O(n²)，
      // 这也是 VCT 比 VCF 贵两三个数量级的主因之一（见 AI_ENGINE.md 的对照表）。
      // 想省掉它就得改成增量维护，那是另一件事；这条路默认是关的。
      const forcing =
        myWins.length === 0 &&
        opponentWins.length === 0 &&
        fourMakers(board, player).some((maker) => maker.winning.length >= 2)

      let found = NO_WIN

      if (forcing) {
        let refuted = false
        let longest = 0

        for (const reply of candidateMoves(board)) {
          if (timeUp(ctx)) {
            refuted = true
            break
          }

          const replyIndex = idx(reply.x, reply.y)
          board[replyIndex] = opponent
          const rest = attack(board, player, remaining - 2, threesLeft - 1, ctx, null)
          board[replyIndex] = 0

          // 守方只要找到一条活路，这个活三就不成立
          if (rest.plies === 0) {
            refuted = true
            break
          }
          if (rest.plies > longest) longest = rest.plies
        }

        if (!refuted) found = { plies: 2 + longest, move: q }
      }

      board[index] = 0

      if (found.plies > 0 && found.plies <= remaining) return found
    }
  }

  return NO_WIN
}

/**
 * 找出 `player` 的强制取胜着法。
 *
 * **不会修改传入的棋盘**：内部复制一份再搜索（搜索靠落子/撤销在同一块棋盘上
 * 来回走）。与 `searchBoard` 一样，这是硬约定。
 */
export function findForcedWin(
  board: Board,
  player: Player,
  options: ThreatSearchOptions,
): ThreatSearchResult {
  const ctx: ThreatContext = { options, nodes: 0, expired: false }
  const result = attack(board.slice(), player, options.maxPlies, MAX_THREE_LAYERS, ctx, null)

  return { move: result.move, plies: result.plies, nodes: ctx.nodes }
}

/**
 * `move` 是不是某条强制取胜路线的**第一步**。
 *
 * `findForcedWin` 只回答「有没有取胜路线、第一步是什么」；判题要问的是
 * 「玩家走的这一手，是不是某条路线的第一步」——两者不是一回事，因为可能有多条
 * 路线、多个可取的起点。
 *
 * **判题必须用这个函数在落子前的盘面上判**，不能拿落子后的盘面去调
 * `findForcedWin`：那个函数假定「传进来的盘面轮到攻方走」，而玩家落子之后
 * 轮到的是对手。那样判定等于白送攻方一手，会把输棋判成赢棋。
 */
export function isForcedWinStart(
  board: Board,
  player: Player,
  move: Point,
  options: ThreatSearchOptions,
): boolean {
  if (board[idx(move.x, move.y)] !== 0) return false

  const ctx: ThreatContext = { options, nodes: 0, expired: false }
  const result = attack(board.slice(), player, options.maxPlies, MAX_THREE_LAYERS, ctx, move)

  return result.plies > 0
}
