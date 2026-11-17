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
  /**
   * 时间预算内没搜满。`depth ≥ 1` 时返回的是已完整搜完的那一层的结果；
   * 只有 `depth === 0` 时才是一步贪心的兜底。
   */
  | 'timeout'
  /** 没有可落子的位置（棋盘已满） */
  | 'no_move'

/**
 * 这一手是怎么得出来的，也就是它有多可靠。由 `reason` 与 `depth` **唯一决定**
 * （`confidenceOf`），界面与复盘必须用这个显式分类，**不许靠 nodes / elapsedMs 反推**
 * ——那些是度量，不是语义：一次算杀可能 0 节点（规则扫描直接命中）。
 *
 * 四类是按**事实**分的，不按「信不信得过」打分：
 */
export type Confidence =
  /** 没有展开常规搜索，由规则或快速路径直接确定：成五、算杀链首手、必防、开局天元、无棋可走 */
  | 'shortcut'
  /** 搜满了这一档的深度 */
  | 'complete'
  /** 时间到了没搜满；用的是已经**完整搜完**的第 `depth` 层的结果（`depth ≥ 1`） */
  | 'partial'
  /** 一层都没搜完，只有一步贪心的估计。只有这一类需要警示「不保证最优」 */
  | 'fallback'

/**
 * `reason × depth` → 可靠度。穷举，新增 reason 时这里会编译失败。
 *
 * 为什么要看 `depth`：`timeout` 只说「没搜满」。迭代加深在第 N+1 层超时的时候，
 * 交出来的是第 N 层的完整结果——那是一次完整的 N 层搜索，不是兜底。只有一层都没
 * 搜完（`depth === 0`）时，手里才只有那一步贪心。此前不看深度、把两者都叫「启发式」，
 * 于是专家档搜完六七层的着法顶着「不保证最优」的警示，而入门档搜满一层却标「精确」。
 */
export function confidenceOf(reason: SearchReason, depth: number): Confidence {
  switch (reason) {
    case 'win':
    case 'block':
    case 'opening':
    case 'no_move':
      return 'shortcut'
    case 'search':
    case 'timeout':
      if (depth === 0) return 'fallback'
      return reason === 'search' ? 'complete' : 'partial'
  }
}

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
  /** 实际完整搜完的深度。0 表示没有任何一层搜完（捷径，或一步贪心兜底）。 */
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
