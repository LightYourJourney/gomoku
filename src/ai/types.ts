import type { Board, Player, Point } from '../core/types'

/** 成五的分值。搜索中见到它就意味着这一步已经分出胜负。 */
export const WIN_SCORE = 1_000_000

export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert'

export type SearchReason =
  /** 己方已有四，直接补成五 */
  | 'win'
  /** 对手下一手能成五，必须堵 */
  | 'block'
  /** 完成了一次完整搜索 */
  | 'search'
  /** 空盘开局，下天元 */
  | 'opening'
  /** 时间预算内未搜完，返回启发式兜底着法 */
  | 'timeout'
  /** 没有可落子的位置（棋盘已满） */
  | 'no_move'

/**
 * 结论的可靠程度。
 * `exact` 表示这是搜索/必胜判断的结论；`heuristic` 表示预算不足时的启发式建议，
 * 不保证最优。界面必须如实区分二者。
 */
export type Confidence = 'exact' | 'heuristic'

export interface SearchRequest {
  readonly requestId: number
  /** 对应的棋局版本。主线程据此作废过期响应。 */
  readonly gameVersion: number
  readonly board: Board
  /** 该由谁来走 */
  readonly player: Player
  readonly difficulty: Difficulty
  /** 覆盖难度自带的时间预算，单位毫秒。 */
  readonly budgetMs?: number
}

export interface SearchResponse {
  readonly requestId: number
  readonly gameVersion: number
  /** null 表示无棋可走。 */
  readonly move: Point | null
  readonly score: number
  /** 实际完整搜完的深度。0 表示只用了启发式兜底。 */
  readonly depth: number
  readonly nodes: number
  readonly elapsedMs: number
  readonly confidence: Confidence
  readonly reason: SearchReason
}
