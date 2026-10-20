import type { GameRecord, PairedGameSet } from './types'
import { SCORED_OUTCOMES } from './types'

/**
 * 计分与统计。
 *
 * ## 一条贯穿全文件的规矩：未完成的样本不进胜率
 *
 * 只有 `black-win` / `white-win` / `draw` 计分。`move-limit`（实验手数用尽）、
 * `aborted`（超时）、`illegal-move`、`no-move`、`engine-error` **一律单独计数**。
 * 把它们算成和棋会让「引擎走不完一局」看起来像「双方势均力敌」——那正是
 * 「错误评测器得出漂亮成绩」的典型形态。
 */

export interface Tally {
  readonly games: number
  /** 计入胜率的局数（三种正常结局）。 */
  readonly scored: number
  readonly aWins: number
  readonly bWins: number
  readonly draws: number
  readonly moveLimit: number
  readonly aborted: number
  readonly illegalMove: number
  readonly noMove: number
  readonly engineError: number
  readonly environmentError: number
}

/** 一局对 `aId` 的得分：胜 1、和 0.5、负 0；未完成返回 null。 */
export function scoreFor(record: GameRecord, aId: string): number | null {
  if (!SCORED_OUTCOMES.includes(record.outcome)) return null

  if (record.outcome === 'draw') return 0.5

  const aIsBlack = record.black === aId
  const aIsWhite = record.white === aId
  if (!aIsBlack && !aIsWhite) {
    throw new Error(`对局记录里没有引擎 ${aId}（黑=${record.black} 白=${record.white}）`)
  }

  const aWon = (record.outcome === 'black-win' && aIsBlack) || (record.outcome === 'white-win' && aIsWhite)
  return aWon ? 1 : 0
}

function allGames(sets: readonly PairedGameSet[]): GameRecord[] {
  return sets.flatMap((set) => [set.aBlack, set.bBlack])
}

export function tally(sets: readonly PairedGameSet[], aId: string): Tally {
  let aWins = 0
  let bWins = 0
  let draws = 0
  let scored = 0
  let moveLimit = 0
  let aborted = 0
  let illegalMove = 0
  let noMove = 0
  let engineError = 0
  let environmentError = 0

  for (const record of allGames(sets)) {
    switch (record.outcome) {
      case 'draw':
        draws++
        scored++
        break
      case 'black-win':
      case 'white-win': {
        const score = scoreFor(record, aId)
        if (score === 1) aWins++
        else bWins++
        scored++
        break
      }
      case 'move-limit':
        moveLimit++
        break
      case 'aborted':
        aborted++
        break
      case 'illegal-move':
        illegalMove++
        break
      case 'no-move':
        noMove++
        break
      case 'engine-error':
        engineError++
        break
      case 'environment-error':
        environmentError++
        break
    }
  }

  return {
    games:
      aWins + bWins + draws + moveLimit + aborted + illegalMove + noMove + engineError + environmentError,
    scored,
    aWins,
    bWins,
    draws,
    moveLimit,
    aborted,
    illegalMove,
    noMove,
    engineError,
    environmentError,
  }
}

/**
 * 可复现的伪随机数（mulberry32）。
 *
 * Bootstrap 必须给定种子，否则同一份数据两次跑出两个置信区间，
 * 「结果可复现」就只对了一半。
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export interface ConfidenceInterval {
  readonly low: number
  readonly high: number
  readonly level: number
  readonly samples: number
}

/**
 * 配对 Bootstrap：以**开局**为重采样单位。
 *
 * 为什么不以「单局」为单位：同一开局的 A-执黑 / B-执黑两局共享局面与对手，
 * 相关性很强，按单局重采样会把区间算得偏窄（看起来比实际更确定）。
 * 以开局（含其重复）为簇重采样，保留簇内相关性。
 */
export function bootstrapScoreRate(
  sets: readonly PairedGameSet[],
  aId: string,
  options: { samples?: number; seed?: number; level?: number } = {},
): ConfidenceInterval | null {
  const groups = new Map<string, number[]>()
  for (const set of sets) {
    for (const record of [set.aBlack, set.bBlack]) {
      const score = scoreFor(record, aId)
      if (score === null) continue
      const key = set.opening
      const list = groups.get(key) ?? []
      list.push(score)
      groups.set(key, list)
    }
  }

  const clusterScores = [...groups.values()].filter((list) => list.length > 0)
  if (clusterScores.length === 0) return null

  const samples = options.samples ?? 2_000
  const level = options.level ?? 0.95
  const random = mulberry32(options.seed ?? 0x9e3779b9)
  const rates: number[] = []

  for (let i = 0; i < samples; i++) {
    let sum = 0
    let count = 0
    for (let pick = 0; pick < clusterScores.length; pick++) {
      const cluster = clusterScores[Math.floor(random() * clusterScores.length)]!
      for (const score of cluster) {
        sum += score
        count++
      }
    }
    if (count > 0) rates.push(sum / count)
  }

  rates.sort((x, y) => x - y)
  const tail = (1 - level) / 2
  const low = rates[Math.floor(tail * (rates.length - 1))]!
  const high = rates[Math.ceil((1 - tail) * (rates.length - 1))]!

  return { low, high, level, samples }
}

/**
 * Elo 风格的描述性差值。
 *
 * **只作为描述**：它假设「两个引擎的胜负由固定棋力差决定」，而实际对局数
 * 往往只有几十局、且对手固定。把一次小样本结果当成客观等级是常见误读，
 * 报告里必须同时给出局数与置信区间。
 */
export function descriptiveElo(scoreRate: number): number | null {
  if (scoreRate <= 0 || scoreRate >= 1) return null
  return -400 * Math.log10(1 / scoreRate - 1)
}

export interface ColorSplit {
  readonly games: number
  readonly wins: number
  readonly draws: number
  readonly losses: number
  readonly scoreRate: number | null
}

function colorSplit(sets: readonly PairedGameSet[], aId: string, asBlack: boolean): ColorSplit {
  let games = 0
  let wins = 0
  let draws = 0
  let losses = 0

  for (const set of sets) {
    const record = asBlack ? set.aBlack : set.bBlack
    if (record.outcome === 'draw') {
      games++
      draws++
      continue
    }
    if (!SCORED_OUTCOMES.includes(record.outcome)) continue

    const score = scoreFor(record, aId)
    if (score === null) continue
    games++
    if (score === 1) wins++
    else losses++
  }

  return {
    games,
    wins,
    draws,
    losses,
    scoreRate: games === 0 ? null : (wins + draws * 0.5) / games,
  }
}

export interface OpeningSummary {
  readonly opening: string
  readonly repeats: number
  /** A 在该开局全部计分局里的得分率。 */
  readonly aScoreRate: number | null
  /** A 执黑时各结局的次数（重复对局聚合，形如 `black-win×2 · move-limit×1`）。 */
  readonly aBlackOutcomes: string
  /** B 执黑时各结局的次数。 */
  readonly bBlackOutcomes: string
}

/** 把一组结局压成 `outcome×n` 的紧凑串；顺序按出现次数降序、同次数按名字。 */
function summarizeOutcomes(records: readonly { outcome: string }[]): string {
  const counts = new Map<string, number>()
  for (const record of records) counts.set(record.outcome, (counts.get(record.outcome) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([outcome, count]) => `${outcome}×${count}`)
    .join(' · ')
}

export interface StrengthSummary {
  readonly aId: string
  readonly bId: string
  readonly tally: Tally
  readonly scoreRate: number | null
  readonly ci: ConfidenceInterval | null
  readonly elo: number | null
  readonly asBlack: ColorSplit
  readonly asWhite: ColorSplit
  /** B 的先后手拆分。只报 A 的话，读者无法判断不对称是否来自同一侧。 */
  readonly bAsBlack: ColorSplit
  readonly bAsWhite: ColorSplit
  readonly perOpening: readonly OpeningSummary[]
}

export function summarize(
  sets: readonly PairedGameSet[],
  aId: string,
  bId: string,
  options: { samples?: number; seed?: number } = {},
): StrengthSummary {
  const t = tally(sets, aId)

  let sum = 0
  let counted = 0
  for (const set of sets) {
    for (const record of [set.aBlack, set.bBlack]) {
      const score = scoreFor(record, aId)
      if (score === null) continue
      sum += score
      counted++
    }
  }
  const scoreRate = counted === 0 ? null : sum / counted

  // 按开局分组，同时累计该开局的得分——重复对局必须合并，只留第一组会算错
  const byOpening = new Map<string, { aBlack: GameRecord[]; bBlack: GameRecord[]; sum: number; count: number }>()
  for (const set of sets) {
    const entry = byOpening.get(set.opening) ?? { aBlack: [], bBlack: [], sum: 0, count: 0 }
    entry.aBlack.push(set.aBlack)
    entry.bBlack.push(set.bBlack)
    for (const record of [set.aBlack, set.bBlack]) {
      const score = scoreFor(record, aId)
      if (score === null) continue
      entry.sum += score
      entry.count++
    }
    byOpening.set(set.opening, entry)
  }

  const perOpening: OpeningSummary[] = [...byOpening.entries()].map(([opening, group]) => ({
    opening,
    repeats: group.aBlack.length,
    aScoreRate: group.count === 0 ? null : group.sum / group.count,
    aBlackOutcomes: summarizeOutcomes(group.aBlack),
    bBlackOutcomes: summarizeOutcomes(group.bBlack),
  }))

  return {
    aId,
    bId,
    tally: t,
    scoreRate,
    ci: bootstrapScoreRate(sets, aId, options),
    elo: scoreRate === null ? null : descriptiveElo(scoreRate),
    asBlack: colorSplit(sets, aId, true),
    asWhite: colorSplit(sets, aId, false),
    bAsBlack: colorSplit(sets, bId, true),
    bAsWhite: colorSplit(sets, bId, false),
    perOpening,
  }
}

/**
 * 对局阶段划分（**明确定义，不靠猜**）：
 * - 开局：第 1–20 手（0-based 下标 0–19）
 * - 中盘：第 21–60 手（下标 20–59）
 * - 后期：第 61 手起（下标 60+）
 *
 * 划分只影响报告里的分组展示，不参与胜负判定。
 */
export type Phase = 'opening' | 'middle' | 'end'

export function phaseOf(moveIndex: number): Phase {
  if (moveIndex < 20) return 'opening'
  if (moveIndex < 60) return 'middle'
  return 'end'
}

export interface PhaseStats {
  readonly moves: number
  readonly avgNodes: number
  readonly maxNodes: number
  readonly avgDepth: number
  readonly avgElapsedMs: number
}

export interface SearchStats {
  readonly moves: number
  readonly avgNodes: number
  readonly medianNodes: number
  readonly maxNodes: number
  readonly avgDepth: number
  readonly avgElapsedMs: number
  readonly ttHits: number
  /** `reason === 'timeout'` 的次数——真实预算下才有意义。 */
  readonly timeouts: number
  /** 走捷径的次数（`win` / `block` / `opening`）。 */
  readonly shortcuts: number
  /** `reason === 'search'` 的次数。 */
  readonly searched: number
  readonly phases: Readonly<Record<Phase, PhaseStats>>
}

const EMPTY_PHASE: PhaseStats = { moves: 0, avgNodes: 0, maxNodes: 0, avgDepth: 0, avgElapsedMs: 0 }

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

export function searchStats(sets: readonly PairedGameSet[], engineId: string): SearchStats {
  const rows: { ply: number; nodes: number; depth: number; elapsedMs: number; reason: string; ttHits: number }[] = []

  for (const set of sets) {
    for (const record of [set.aBlack, set.bBlack]) {
      record.moves.forEach((move) => {
        if (move.engine !== engineId) return
        rows.push({
          // 绝对手数（开局的手也算），否则 2/4/6 手开局会把阶段划分整体前移
          ply: move.ply,
          nodes: move.metrics.nodes,
          depth: move.metrics.depth,
          elapsedMs: move.metrics.elapsedMs,
          reason: move.metrics.reason,
          ttHits: move.metrics.ttHits,
        })
      })
    }
  }

  const nodes = rows.map((r) => r.nodes)
  const depths = rows.map((r) => r.depth)

  const phases: Record<Phase, PhaseStats> = { opening: EMPTY_PHASE, middle: EMPTY_PHASE, end: EMPTY_PHASE }
  for (const phase of ['opening', 'middle', 'end'] as const) {
    const subset = rows.filter((r) => phaseOf(r.ply) === phase)
    phases[phase] = {
      moves: subset.length,
      avgNodes: average(subset.map((r) => r.nodes)),
      maxNodes: subset.length === 0 ? 0 : Math.max(...subset.map((r) => r.nodes)),
      avgDepth: average(subset.map((r) => r.depth)),
      avgElapsedMs: average(subset.map((r) => r.elapsedMs)),
    }
  }

  return {
    moves: rows.length,
    avgNodes: average(nodes),
    medianNodes: median(nodes),
    maxNodes: nodes.length === 0 ? 0 : Math.max(...nodes),
    avgDepth: average(depths),
    avgElapsedMs: average(rows.map((r) => r.elapsedMs)),
    ttHits: rows.reduce((sum, r) => sum + r.ttHits, 0),
    timeouts: rows.filter((r) => r.reason === 'timeout').length,
    shortcuts: rows.filter((r) => r.reason === 'win' || r.reason === 'block' || r.reason === 'opening').length,
    searched: rows.filter((r) => r.reason === 'search').length,
    phases,
  }
}
