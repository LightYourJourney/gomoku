import { WIN_SCORE, type SearchPath, type SearchReason } from '../ai/types'
import { ENGINE_VERSION } from '../ai/version'
import { samePoint } from '../core/board'
import type { Point } from '../core/types'
import type { Difficulty } from '../ai/types'

/**
 * 一手的结论。
 *
 * **不设「最佳 / 好棋 / 失误」的固定档位**——把连续的评分差压进几个离散
 * 标签，等于替玩家下结论，而且阈值一拍脑袋就会把「稍有出入」说成「失误」。
 * 这里只给分差与引擎出处，怎么解读由玩家自己来。
 */
export interface MoveVerdict {
  /** 第几手（0-based） */
  readonly moveIndex: number
  readonly move: Point
  /** 引擎为该局面给出的最佳着法（对当时行棋方而言） */
  readonly engineMove: Point
  /**
   * 同视界分差（见 `horizonLoss`），恒 ≥ 0。
   *
   * **`null` = 没有算**：两种走法之后的评分不在同一把尺子上。它不是「没有亏损」——
   * 界面必须把这两件事分开说，亏损榜也不收它。
   * 凡是算得出数的，两边都是搜满或已证明的结论，所以没有「算出来但不可靠」这一档。
   */
  readonly loss: number | null
  /**
   * 引擎给出首选着法时走的路径（`SearchReason` 原样带出）。
   * 界面必须用 `searchPathOf()` 分类，不能拿 depth / nodes 推。
   */
  readonly reason: SearchReason
  readonly engineDepth: number
  readonly engineNodes: number
}

export interface AnalysisSummary {
  readonly moveVerdicts: readonly MoveVerdict[]
  /** 分差最大的前 3 手（loss 降序） */
  readonly topLosses: readonly MoveVerdict[]
}

export interface VerdictInput {
  readonly moveIndex: number
  readonly played: Point
  readonly engineMove: Point
  /** 该手是否直接终局（成五）。终局手 loss 恒 0——赢棋不存在亏损。 */
  readonly isWinningMove: boolean
  /** 走完实际着法之后的局面（对手视角）。终局手或着法相同时不需要，传 `null`。 */
  readonly afterPlayed: AfterMove | null
  /** 走完引擎首选之后的局面（对手视角）；`'ended'` = 引擎首选当场成五。 */
  readonly afterEngine: AfterMove | 'ended' | null
  readonly reason: SearchReason
  readonly engineDepth: number
  readonly engineNodes: number
}

/** 「走完某一手之后」的局面，由对手一方搜索得到的结论（分数是对手视角）。 */
export interface AfterMove {
  readonly score: number
  readonly reason: SearchReason
}

/**
 * 对手视角的可比分值；`null` = 这个分数不能拿去和别的相减。
 *
 * 只有两类结论在同一把尺子上（`AI_ENGINE.md` 的量纲表）：`search`（搜满档位深度的
 * negamax 值）与 `win`（成五 / 算杀，与前者同量纲）。`block` 的分数是贪心量级、
 * 符号不可信；`timeout` 的两边可能停在不同层；`opening` / `no_move` 恒为 0。
 */
function comparableScore(after: AfterMove | 'ended' | null): number | null {
  if (after === null) return null
  // 引擎首选当场成五：对手已经输了
  if (after === 'ended') return -WIN_SCORE
  return after.reason === 'search' || after.reason === 'win' ? after.score : null
}

/**
 * 同视界分差：实际着法之后的对手评分 − 引擎首选之后的对手评分，负数钳到 0。
 * 任一边不可比或缺失 → `null`（没有算，不是「没有亏损」）。
 *
 * **为什么不直接用「局面 i 的评分 − (−局面 i+1 的评分)」**：那两个数不在同一个搜索视界上。
 * 局面 i 搜 d 层，最后一手是对手下的；局面 i+1 再搜 d 层，等于从局面 i 看了 d+1 层，
 * 最后一手换成自己下。评估函数不含行棋方，「谁下最后一手谁占便宜」就原样进了差值，
 * 而且方向固定——实测引擎走自己的首选时 135 手里 134 手为负、|偏差| 中位数 14,200
 * （`yarn bench:review-loss` 第一项），真实亏损因此被钳成 0。
 * 这里比的两个局面都是「走完一手之后、轮到对手、搜同样的层数」，偏差相消。
 */
export function horizonLoss(
  afterPlayed: AfterMove | null,
  afterEngine: AfterMove | 'ended' | null,
): number | null {
  const played = comparableScore(afterPlayed)
  const engine = comparableScore(afterEngine)
  if (played === null || engine === null) return null
  return Math.max(0, played - engine)
}

export function buildVerdict(input: VerdictInput): MoveVerdict {
  // 着法与引擎首选相同 → 没有亏损，**不看任何评分**：两种走法是同一个局面。
  // 这条判断先于评分，所以「与引擎一致」的手永远不会因为某个评分不可比而变成「未算」。
  const sameMove = samePoint(input.played, input.engineMove)
  return {
    moveIndex: input.moveIndex,
    move: input.played,
    engineMove: input.engineMove,
    loss: input.isWinningMove || sameMove ? 0 : horizonLoss(input.afterPlayed, input.afterEngine),
    reason: input.reason,
    engineDepth: input.engineDepth,
    engineNodes: input.engineNodes,
  }
}

export function buildSummary(verdicts: readonly MoveVerdict[]): AnalysisSummary {
  // 只列真有亏损的手：loss 为 0 的（含「与引擎一致」）与没算出来的（null）
  // 都不是「亏损最多的几手」。
  const topLosses = verdicts
    .flatMap((verdict) => (verdict.loss !== null && verdict.loss > 0 ? [{ verdict, loss: verdict.loss }] : []))
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 3)
    .map((entry) => entry.verdict)
  return { moveVerdicts: [...verdicts], topLosses }
}

/**
 * 分差 → 人话。
 *
 * 两条措辞纪律，都是被真实对局教出来的：
 *
 * 1. **「与引擎一致」只在着法真的相同时说**。分差会被钳到 0（实际着法之后的
 *    评分可能比引擎首选之后的还好），拿 loss === 0 当「一致」会在
 *    着法明明不同时报「一致」——玩家的眼睛和文字打架。
 * 2. **大分差不叫「错过直接取胜」**。分差只是评估的落差，玩家当时可能
 *    根本没有胜机（该防没防、局面直接崩）。声称「错过取胜」是编造一个
 *    并不存在的机会。
 *
 * 「分差约 N 子」是**粗略换算**：10_000 是「一档棋型」（活三）的量级——排序表
 * `shapeScore` 里活三 10_000、整盘评估 `ai/evaluate.ts` 的 `SHAPE_VALUES` 里 12_000，
 * 分差来自后者。拿它当分母只给数量级感受，不是精确定义——评分不线性于子数，
 * 这是评估函数的固有局限。
 */
export function verdictLabel(v: MoveVerdict): string {
  if (samePoint(v.move, v.engineMove)) return '与引擎一致'
  // 没算 ≠ 相当：两种走法之后的评分不可比（见 `horizonLoss`）。
  if (v.loss === null) return '未算分差'
  if (v.loss === 0) return '与引擎首选相当'
  if (v.loss >= WIN_SCORE / 2) return '分差极大'
  /*
   * `Math.round(loss / 10_000)` 在 `0 < loss < 5_000` 时得 **0**，会写出
   * 「分差约 0 子」——而 `buildSummary` 只把 `loss > 0` 的手排进「亏损最多」，
   * 于是榜单上会出现一条「关键手：分差约 0 子」的自相矛盾。这不是极端情况：
   * 一个眠三在整盘评估（`SHAPE_VALUES.three`）里是 800，正好落在这个区间。
   * 半子以下不换算成子数，如实说「不足 1 子」。
   */
  if (v.loss < 5_000) return '分差很小（不足 1 子）'
  return `分差约 ${Math.round(v.loss / 10_000)} 子`
}

/**
 * 「这一手是怎么得出来的」的人话。
 *
 * 与 `verdictLabel`（分差怎么读）是两件事：**四类路径必须分开说**。
 * 把「规则 / 快速路径判定」写成「搜索完成」，等于告诉玩家引擎展开过搜索——
 * 而它可能一次都没展开（直接成五、必防、开局天元，深度 0、节点 0）。
 * 这正是 Phase 08 独立审计发现的那条语义缺陷。
 */
export function pathLabel(path: SearchPath): string {
  switch (path) {
    case 'search':
      return '搜索完成'
    case 'shortcut':
      return '规则/快速路径判定'
    case 'aborted':
      return '预算内未搜完（启发式）'
    case 'none':
      return '无可用着法'
  }
}

/**
 * 分析结论的缓存键。掺引擎版本（换 ENGINE_VERSION 必须重算）、档位与预算
 * （换任何一项结论都可能不同）；`v2` 是键自身的版本，键结构变了递增。
 *
 * **对局用内容键标识，不用 `seq`**（v1 用的是 seq）：seq 只在一个库里唯一，
 * 内存兜底会从 1 重新编号，与库里已有的 1 号撞上，读到另一局的结论。
 * 内容键由调用方用 `persist/recordIdentity.ts` 的 `recordContentKey` 算——
 * 本层不依赖 persist。
 */
export function cacheKey(contentKey: string, difficulty: Difficulty, budgetMs: number): string {
  return `v2:${ENGINE_VERSION}:${contentKey}:${difficulty}:${budgetMs}`
}
