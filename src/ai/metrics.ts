/**
 * 搜索热路径的**可选**调用计数器。
 *
 * 只为一件事存在：回答「某个函数在一次典型搜索里到底被调用了多少次」。
 * 这个问题没法从 CPU profile 里准确读出来（采样只给频率近似），而它直接决定
 * 「单次很贵的函数」是不是真的值得优化。
 *
 * ## 纪律
 *
 * - **默认关闭**：`aiCounters.current` 为 null 时，`countCall()` 只有一次判空。
 * - **不影响结果**：计数器不改任何分支、不改变棋盘、不参与评分。
 * - **不做计时**：只做整数自增。耗时用外部基准测，不在这里插 `performance.now()`。
 * - 只有基准 / 剖析脚本会打开它。产品代码路径永远不会置位。
 */

export interface AiCallCounters {
  /** `evaluateBoard()` 的调用次数（叶子评估 + 超时兜底）。 */
  evaluateBoard: number
  /** `candidateMoves()` 的调用次数。 */
  candidateMoves: number
  /** `orderMoves()` 的调用次数（每个内部节点一次，根节点一次）。 */
  orderMoves: number
  /** `orderMoves()` 里逐个打分过的候选点数（与调用次数相除 = 平均候选数）。 */
  orderCandidates: number
  /** `analyzeFast()` 的调用次数（排序时每候选每方各一次）。 */
  analyzeFast: number
  /** `threatScoreWith()` 的调用次数。 */
  threatScoreWith: number
  /** 置换表 `probe()` 次数。 */
  ttProbe: number
  /** 置换表 `store()` 次数。 */
  ttStore: number
  /** `findForcedWin()` 的调用次数（每次搜索至多一次）。 */
  forcedWin: number
}

const aiCounters: { current: AiCallCounters | null } = { current: null }

function empty(): AiCallCounters {
  return {
    evaluateBoard: 0,
    candidateMoves: 0,
    orderMoves: 0,
    orderCandidates: 0,
    analyzeFast: 0,
    threatScoreWith: 0,
    ttProbe: 0,
    ttStore: 0,
    forcedWin: 0,
  }
}

/** 开始计数，返回可读的计数器对象（与 `stopAiCounters` 返回同一个引用）。 */
export function startAiCounters(): AiCallCounters {
  const counters = empty()
  aiCounters.current = counters
  return counters
}

/** 停止计数并返回本次结果；未开启时返回 null。 */
export function stopAiCounters(): AiCallCounters | null {
  const counters = aiCounters.current
  aiCounters.current = null
  return counters
}

/** 热路径调用点用的自增。未开启时只花一次判空。 */
export function countCall(name: keyof AiCallCounters): void {
  const counters = aiCounters.current
  if (counters !== null) counters[name]++
}
