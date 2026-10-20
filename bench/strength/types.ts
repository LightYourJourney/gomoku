import type { Board, Player, Point } from '../../src/core/types'
import type { Difficulty, SearchReason } from '../../src/ai/types'

/**
 * 评测系统的类型定义。
 *
 * 两条纪律贯穿本目录：
 * 1. **不复制规则**：胜负、合法性一律走 `core/`，这里只做编排。
 * 2. **字段名对齐真实接口**：搜索度量取自 `SearchOutcome`（`depth` / `nodes` /
 *    `ttHits` / `reason`）与 `SearchResponse`（`elapsedMs`），不另造同义词——
 *    虚构一个 `timeMs` 之类的字段，报告就会与引擎实际返回的不是一回事。
 */

/** 一手的搜索度量。 */
export interface MoveMetrics {
  /** 实际完整搜完的深度。0 表示只走了捷径或启发式兜底。 */
  readonly depth: number
  readonly nodes: number
  /** 置换表命中数。`searchBoard` 才给；走捷径时为 0。 */
  readonly ttHits: number
  readonly reason: SearchReason
  /** 引擎自己报告的耗时。确定性模式下恒为 0（时钟被固定），见 `EngineSpec.clock`。 */
  readonly elapsedMs: number
}

export interface EngineMove extends MoveMetrics {
  /** null 表示引擎认为无棋可走。盘面未满时这算异常，见 `GameOutcomeKind`。 */
  readonly move: Point | null
}

export interface EngineContext {
  /** 这是全局第几手（0-based），供适配器记录阶段。 */
  readonly moveIndex: number
}

/**
 * 引擎适配器。
 *
 * 评测器只认这个接口，不认「当前源码」——版本对照正是靠更换适配器实现的，
 * 而不是把两套源码塞进同一个模块图。
 */
export interface Engine {
  readonly id: string
  choose(board: Board, player: Player, context: EngineContext): EngineMove
}

/**
 * 引擎配置。
 *
 * `clock` 是**模式开关**，不是性能旋钮：
 * - `fixed`：时钟恒为 0、预算给到极大，深度成为唯一约束 → 确定性算法评测；
 * - `real`：真实时钟 + 正式难度预算 → 真实棋力评测。
 *
 * 两种模式的结果**不能混在一张表里比较**，报告里会分别标注。
 */
export interface EngineSpec {
  /** 稳定标识，进报告与结果文件。 */
  readonly id: string
  readonly label: string
  readonly difficulty: Difficulty
  /** 覆盖难度自带预算。`real` 模式用的就是它。 */
  readonly budgetMs?: number
  /** 覆盖难度自带的深度上限。`fixed` 模式必须给。 */
  readonly maxDepth?: number
  readonly width?: number
  readonly transposition?: boolean
  readonly threatPlies?: number
  readonly threatThrees?: boolean
  readonly clock: 'real' | 'fixed'
  /**
   * 外部引擎包（`bench/strength/.engines/*.mjs`）。
   *
   * 给了它就从那个包加载引擎，用于与历史版本对照；不给就用当前源码。
   */
  readonly module?: string
}

/**
 * 一局是怎么结束的。
 *
 * **`move-limit` 不等于和棋**——这是本阶段明确要求区分的一条：达到实验手数
 * 上限只是实验没跑完，静默归入平局会把「引擎走了 120 手没分胜负」伪装成
 * 「双方势均力敌」。同理 `aborted` / `engine-error` 都不进计分。
 */
export type GameOutcomeKind =
  | 'black-win'
  | 'white-win'
  | 'draw'
  | 'move-limit'
  | 'illegal-move'
  | 'no-move'
  | 'engine-error'
  | 'aborted'

/** 计入胜率统计的结局。其余一律单独计数。 */
export const SCORED_OUTCOMES: readonly GameOutcomeKind[] = ['black-win', 'white-win', 'draw']

export interface PlayedMove {
  readonly point: Point
  readonly player: Player
  readonly engine: string
  readonly metrics: MoveMetrics
}

export interface GameRecord {
  /** 本局用了哪个开局（`BenchPosition.id`）。 */
  readonly opening: string
  /** 黑方引擎 id。 */
  readonly black: string
  /** 白方引擎 id。 */
  readonly white: string
  readonly outcome: GameOutcomeKind
  readonly winner: Player | null
  readonly moves: readonly PlayedMove[]
  /** 异常 / 非法着法 / 中止时的人类可读原因。正常结束为 null。 */
  readonly error: string | null
  /** 走到第几手出的问题（0-based），正常结束为 null。 */
  readonly failAtMove: number | null
  /** 实际经过时间（毫秒）。确定性模式也有值——那是评测器的墙钟，不是引擎的。 */
  readonly elapsedMs: number
}

export interface PairedGameSet {
  readonly opening: string
  /** A 执黑、B 执白。 */
  readonly aBlack: GameRecord
  /** B 执黑、A 执白。 */
  readonly bBlack: GameRecord
}
