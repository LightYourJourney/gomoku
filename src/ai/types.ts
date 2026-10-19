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
 * 这一手是**怎么**得出来的（不是「结论有多可靠」，那是 `Confidence`）。
 *
 * 四类分别对应四种对用户可见的说法，界面与复盘必须用这个显式分类，
 * **不许靠 depth / nodes / elapsedMs 反推**——那些是度量，不是语义：
 * 一次算杀可能 0 节点（规则扫描直接命中），一次很短的搜索也可能深度为 0。
 */
export type SearchPath =
  /** 常规搜索完成 */
  | 'search'
  /** 规则或快速路径直接确定：直接成五、必防、开局天元（含算杀链首手） */
  | 'shortcut'
  /** 预算耗尽、搜索中止，返回启发式兜底 */
  | 'aborted'
  /** 无棋可走，没有结论可言 */
  | 'none'

/** `SearchReason` → 显式路径分类。穷举，新增 reason 时这里会编译失败。 */
export function searchPathOf(reason: SearchReason): SearchPath {
  switch (reason) {
    case 'search':
      return 'search'
    case 'timeout':
      return 'aborted'
    case 'no_move':
      return 'none'
    case 'win':
    case 'block':
    case 'opening':
      return 'shortcut'
  }
}

/**
 * 结论的可靠程度。
 * `exact` 表示这是搜索/必胜判断的结论；`heuristic` 表示预算不足时的启发式建议，
 * 不保证最优。界面必须如实区分二者。
 */
export type Confidence = 'exact' | 'heuristic'

/** 棋型等级，由高到低。提示界面按它显示中文说明。 */
export type ThreatKind = 'five' | 'openFour' | 'four' | 'openThree' | 'three' | 'none'

/** 一条推荐着法，带攻防两面的棋型标注。 */
export interface MoveSuggestion {
  readonly move: Point
  /** 综合推荐度，越大越推荐 */
  readonly score: number
  /** 我在这里落子能形成的最好棋型 */
  readonly attack: ThreatKind
  /** 对手在这里落子能形成的最好棋型，也就是我这一手堵掉了什么 */
  readonly defense: ThreatKind
}

/** 当前局面对「该我走」的一方有多紧急。 */
export type Urgency = 'win' | 'mustBlock' | 'danger' | 'normal'

/**
 * 请求用途。
 *
 * - `play`：出着法。
 * - `hint`：只做分析，**绝不落子**。走同一条引擎、同一套过期校验，
 *   但响应只写提示状态，不碰棋局。
 * - `analyze`：复盘分析用的只读请求，语义与 `hint` 相同（绝不落子），
 *   但预算独立（分析一次要跑很多手，各走各的）。`moveIndex` 标明分析的是
 *   第几手，响应原样带回，供分析管线配对。
 */
export type RequestPurpose = 'play' | 'hint' | 'analyze'

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
  readonly purpose: RequestPurpose
  /** `analyze` 用：分析的是第几手（0-based）。响应原样带回。 */
  readonly moveIndex?: number
}

export interface SearchResponse {
  readonly requestId: number
  readonly gameVersion: number
  /** `analyze` 请求原样带回的手序号，供分析管线配对。 */
  readonly moveIndex?: number
  /** null 表示无棋可走。 */
  readonly move: Point | null
  readonly score: number
  /** 实际完整搜完的深度。0 表示只用了启发式兜底。 */
  readonly depth: number
  readonly nodes: number
  readonly elapsedMs: number
  readonly confidence: Confidence
  readonly reason: SearchReason
  /**
   * 按推荐度降序，最多 3 条。
   *
   * 必填而非可选：可选会让每个消费点都要处理 `undefined`，而「没有候选」
   * 本来就有「空数组」这个自然表示。`purpose` 为 `play` 时是空数组。
   */
  readonly candidates: readonly MoveSuggestion[]
  /** `purpose` 为 `play` 时为 `normal`。 */
  readonly urgency: Urgency
}
