import { WIN_SCORE, type Confidence } from '../ai/types'
import { ENGINE_VERSION } from '../ai/version'
import type { Point } from '../core/types'
import type { Difficulty } from '../ai/types'

/**
 * 一手的结论。
 *
 * **不设「最佳 / 好棋 / 失误」的固定档位**——把连续的评分差压进几个离散
 * 标签，等于替玩家下结论，而且阈值一拍脑袋就会把「稍有出入」说成「失误」。
 * 这里只给分差、可靠度与引擎出处，怎么解读由玩家自己来。
 */
export interface MoveVerdict {
  /** 第几手（0-based） */
  readonly moveIndex: number
  readonly move: Point
  /** 引擎为该局面给出的最佳着法（对当时行棋方而言） */
  readonly engineMove: Point
  /**
   * 玩家实际着法与引擎着法的评分差，恒 ≥ 0。0 = 与引擎一致。
   * 由调用方把「玩家着法的评分」算好传入（negamax 取负，见 analysisStore）。
   */
  readonly loss: number
  /** 单手结论的可靠度：搜完 = exact，超时 = heuristic */
  readonly confidence: Confidence
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
  readonly engineScore: number
  /** 玩家着法的评分（= −(局面 i+1 的对手视角评分)）。终局手传 0。 */
  readonly playedScore: number
  /** 该手是否直接终局（成五）。终局手 loss 恒 0——赢棋不存在亏损。 */
  readonly isWinningMove: boolean
  readonly confidence: Confidence
  readonly engineDepth: number
  readonly engineNodes: number
}

export function buildVerdict(input: VerdictInput): MoveVerdict {
  const raw = input.isWinningMove ? 0 : input.engineScore - input.playedScore
  return {
    moveIndex: input.moveIndex,
    move: input.played,
    engineMove: input.engineMove,
    loss: Math.max(0, raw),
    confidence: input.confidence,
    engineDepth: input.engineDepth,
    engineNodes: input.engineNodes,
  }
}

export function buildSummary(verdicts: readonly MoveVerdict[]): AnalysisSummary {
  const topLosses = [...verdicts].sort((a, b) => b.loss - a.loss).slice(0, 3)
  return { moveVerdicts: [...verdicts], topLosses }
}

/**
 * 分差 → 人话。
 *
 * 两条措辞纪律，都是被真实对局教出来的：
 *
 * 1. **「与引擎一致」只在着法真的相同时说**。loss 会被钳到 0（开局/必胜/必防
 *    这些捷径的评分与真实评估不同量纲），拿 loss === 0 当「一致」会在
 *    着法明明不同时报「一致」——玩家的眼睛和文字打架。
 * 2. **大分差不叫「错过直接取胜」**。分差只是评估的落差，玩家当时可能
 *    根本没有胜机（该防没防、局面直接崩）。声称「错过取胜」是编造一个
 *    并不存在的机会。
 *
 * 「分差约 N 子」是**粗略换算**：10_000 是 shapeScore 里「一档棋型」（活三）
 * 的量级，拿它当分母只给数量级感受，不是精确定义——评分不线性于子数，
 * 这是评估函数的固有局限。
 */
export function verdictLabel(v: MoveVerdict): string {
  if (v.move.x === v.engineMove.x && v.move.y === v.engineMove.y) return '与引擎一致'
  if (v.loss === 0) return '与引擎首选相当'
  if (v.loss >= WIN_SCORE / 2) return '分差极大'
  return `分差约 ${Math.round(v.loss / 10_000)} 子`
}

/**
 * 分析结论的缓存键。掺引擎版本（换 ENGINE_VERSION 必须重算）、档位与预算
 * （换任何一项结论都可能不同）；`v1` 是键自身的版本，键结构变了递增。
 */
export function cacheKey(seq: number, difficulty: Difficulty, budgetMs: number): string {
  return `v1:${ENGINE_VERSION}:${seq}:${difficulty}:${budgetMs}`
}
