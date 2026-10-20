import { DIFFICULTY_PARAMS, type DifficultyParams } from '../../src/ai/difficulty'
import { searchBoard, searchOptionsFor, type SearchOptions } from '../../src/ai/search'
import type { Board, Player } from '../../src/core/types'
import type { Engine, EngineMove, EngineSpec } from './types'

/**
 * 确定性模式下给一个「永远用不完」的预算。
 *
 * 时钟固定为 0 时迭代加深不会超时，真正约束只剩 `maxDepth`；预算仍需给一个
 * 足够大的值，否则 `deadline = 0 + budget` 会立刻过期。
 */
const FIXED_BUDGET_MS = 1_000_000_000

/** 确定性模式的时钟：永远停在 0。 */
const FIXED_CLOCK = (): number => 0

/**
 * 把 `EngineSpec` 翻译成 `SearchOptions`。
 *
 * **这是评测侧唯一的参数拼装点**。`searchOptionsFor` 负责「难度参数 → 选项」，
 * 这里只叠加评测允许的覆盖项（深度 / 宽度 / 算杀 / 置换表）。
 *
 * 注意 `maxDepth` 的覆盖只在确定性模式用得上；真实棋力评测**不得**用它，
 * 否则测的是「固定深度下的棋力」，不是五档的正式棋力。`spec.clock === 'real'`
 * 时若同时给了 `maxDepth`，`assertSpec` 会拒绝。
 */
function optionsFromSpec(spec: EngineSpec, params: DifficultyParams): SearchOptions {
  const base = searchOptionsFor(params, {
    budgetMs: spec.clock === 'fixed' ? FIXED_BUDGET_MS : spec.budgetMs,
  })

  return {
    ...base,
    ...(spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }),
    ...(spec.width === undefined ? {} : { width: spec.width }),
    ...(spec.transposition === undefined ? {} : { transposition: spec.transposition }),
    ...(spec.threatPlies === undefined ? {} : { threatPlies: spec.threatPlies }),
    ...(spec.threatThrees === undefined ? {} : { threatThrees: spec.threatThrees }),
  }
}

/**
 * 配置自检。
 *
 * 有些组合**看起来能跑，实际测的不是你以为的东西**，必须挡在开跑之前：
 * - 真实时钟 + 固定深度 → 既不是真实棋力也不是确定性评测；
 * - 确定性时钟但没给深度 → 深度沿用难度上限，虽然可复现，但报告里会误导
 *   （读者会以为测的是「该档在预算内的表现」）。
 */
export function assertSpec(spec: EngineSpec): void {
  if (spec.clock === 'fixed' && spec.maxDepth === undefined) {
    throw new Error(`引擎 ${spec.id}：确定性模式必须显式给 maxDepth`)
  }
  if (spec.clock === 'real' && spec.maxDepth !== undefined) {
    throw new Error(
      `引擎 ${spec.id}：真实棋力评测不能用 maxDepth 覆盖深度——那测的是固定深度，不是正式棋力`,
    )
  }
}

/** 报告用的「实际生效参数」。 */
export interface ResolvedOptions {
  readonly budgetMs: number
  readonly maxDepth: number
  readonly width: number
  readonly threatPlies: number
  readonly threatThrees: boolean
  readonly transposition: boolean
}

/**
 * 解析出这次运行**实际使用**的参数，写进报告。
 *
 * 只记录 `{difficulty, clock}` 是不够的：报告读者无法知道 1000 ms、宽度 10、
 * 算杀 5 手这些数字从哪来。注意外部引擎包用的是**它自己的**难度表，
 * 所以这里的解析仅对 `kind: 'source'` 精确；报告会注明这一点。
 */
export function resolveOptions(spec: EngineSpec): ResolvedOptions {
  const params = DIFFICULTY_PARAMS[spec.difficulty]
  if (params === undefined) throw new Error(`未知难度：${spec.difficulty}`)
  const options = optionsFromSpec(spec, params)
  return {
    budgetMs: options.budgetMs,
    maxDepth: options.maxDepth,
    width: options.width,
    threatPlies: options.threatPlies,
    threatThrees: options.threatThrees,
    transposition: options.transposition,
  }
}

/** 用当前源码构造引擎。 */
export function createLocalEngine(spec: EngineSpec): Engine {
  assertSpec(spec)
  const params = DIFFICULTY_PARAMS[spec.difficulty]
  if (params === undefined) throw new Error(`未知难度：${spec.difficulty}`)
  const options = optionsFromSpec(spec, params)
  const clock = spec.clock === 'fixed' ? FIXED_CLOCK : Date.now

  return {
    id: spec.id,
    choose(board: Board, player: Player): EngineMove {
      const startedAt = clock()
      const outcome = searchBoard(board, player, options, clock)
      return {
        move: outcome.move,
        depth: outcome.depth,
        nodes: outcome.nodes,
        ttHits: outcome.ttHits,
        reason: outcome.reason,
        elapsedMs: clock() - startedAt,
      }
    },
  }
}
