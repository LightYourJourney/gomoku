import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { EngineSpec, GameRecord } from './types'
import type { SearchStats, StrengthSummary } from './stats'
import type { ResolvedOptions } from './local'

/**
 * 报告产出：一份机器可读的 JSON + 一份人读的 Markdown。
 *
 * ## 为什么文件名带时间戳而不是覆盖
 *
 * 覆盖同一份 JSON 会让「上一版打多少分」永久消失，历史实验无法追。
 * 文件名 = `<UTC 时间>-<A>_vs_<B>.json`，天然不覆盖。
 *
 * ## 什么进 JSON、什么进 Markdown
 *
 * 完整手顺与逐手度量只在 JSON 里；Markdown 只放摘要与被引用到的产物路径。
 * 大规模棋谱不应无理由提交进 Git——结果目录已 gitignore。
 */

export interface EngineInfo {
  readonly spec: EngineSpec
  /**
   * 实际生效的参数（预算 / 深度 / 宽度 / 算杀 / 置换）。
   *
   * 只写 `{difficulty, clock}` 的话，读者无法知道 1000 ms、宽度 10 这些数字从哪来。
   * 注意：外部引擎包用的是**它自己的**难度表，这两个字段只对 `kind: 'source'` 精确。
   */
  readonly resolved: ResolvedOptions
  /** 引擎包 SHA-256；当前源码为 `null`（没有可指纹化的独立文件）。 */
  readonly digest: string | null
  readonly kind: 'source' | 'module'
}

/** 与另一份实验报告的比较（可选）。 */
export interface BaselineComparison {
  readonly path: string
  readonly aId: string
  readonly bId: string
  readonly scoreRate: number | null
  /** 本次 A 得分率 − 基线 A 得分率。两者必须是同一对局双方才能比。 */
  readonly delta: number | null
  readonly note: string
}

export interface RunMeta {
  readonly commit: string
  readonly dirty: boolean
  readonly engineVersion: string
  readonly node: string
  readonly platform: string
  readonly arch: string
  readonly cpuCount: number
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly mode: string
  readonly command: string
  /** 结果文件路径。写入时回填，便于从报告本身追到完整数据。 */
  readonly resultFile?: string
  readonly openingsVersion: string
  readonly statistics: {
    readonly method: string
    readonly bootstrapSamples: number
    readonly bootstrapSeed: number
    readonly clusterUnit: 'opening'
  }
  readonly baseline?: BaselineComparison
  /** 测量条件说明，进报告，避免把不同机器/负载的数字混为一谈。 */
  readonly notes: readonly string[]
}

export interface ExperimentReport {
  readonly meta: RunMeta
  readonly a: EngineInfo
  readonly b: EngineInfo
  readonly openings: readonly { id: string; moves: readonly { x: number; y: number }[] }[]
  readonly maxMoves: number
  readonly repeats: number
  readonly summary: StrengthSummary
  readonly search: { readonly a: SearchStats; readonly b: SearchStats }
  readonly games: readonly GameRecord[]
}

const pct = (value: number | null): string => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
const num = (value: number): string => value.toFixed(2)

function reportSlug(aId: string, bId: string): string {
  return `${aId}_vs_${bId}`.replace(/[^a-zA-Z0-9_.-]+/g, '-')
}

export function renderMarkdown(report: ExperimentReport): string {
  const { summary, meta } = report
  const lines: string[] = []

  lines.push(`# 强度评测：${summary.aId} vs ${summary.bId}`)
  lines.push('')
  lines.push(`- 时间：${meta.startedAt} → ${meta.finishedAt}（${(meta.durationMs / 1000).toFixed(1)} 秒）`)
  lines.push(`- 模式：${meta.mode}`)
  lines.push(`- 提交：\`${meta.commit}\`${meta.dirty ? '（工作区有未提交改动）' : ''}`)
  lines.push(`- 引擎版本：${meta.engineVersion}`)
  lines.push(`- 环境：Node ${meta.node} / ${meta.platform} ${meta.arch} / ${meta.cpuCount} CPU`)
  if (meta.resultFile !== undefined) lines.push(`- 完整数据：\`${meta.resultFile}\``)
  lines.push('')

  lines.push('## 配置')
  lines.push('')
  lines.push('| 方 | 配置 | 来源 | 指纹 | 实际参数 |')
  lines.push('| --- | --- | --- | --- | --- |')
  const digestOf = (info: typeof report.a): string =>
    info.digest === null ? '—（当前源码）' : `\`${info.digest.slice(0, 12)}\``
  const resolvedOf = (info: typeof report.a): string => {
    // 确定性模式给的是「永远用不完」的预算，直接印 1000000000 会让人以为是可调项
    const budget = info.resolved.budgetMs >= 1_000_000_000 ? '不限（确定性）' : `${info.resolved.budgetMs} ms`
    return `预算 ${budget} · 深度上限 ${info.resolved.maxDepth} · 宽度 ${info.resolved.width} · 算杀 ${info.resolved.threatPlies} 手 · 置换 ${info.resolved.transposition ? '开' : '关'}`
  }
  lines.push(`| A | \`${JSON.stringify(report.a.spec)}\` | ${report.a.kind} | ${digestOf(report.a)} | ${resolvedOf(report.a)} |`)
  lines.push(`| B | \`${JSON.stringify(report.b.spec)}\` | ${report.b.kind} | ${digestOf(report.b)} | ${resolvedOf(report.b)} |`)
  lines.push('')
  if (report.a.kind === 'module' || report.b.kind === 'module') {
    lines.push('> 外部引擎包的「实际参数」按本仓库当前难度表解析；该包实际使用的是**它自己的**难度参数。')
    lines.push('')
  }

  lines.push('## 结果')
  lines.push('')
  const t = summary.tally
  lines.push('| 指标 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| 对局总数 | ${t.games} |`)
  lines.push(`| 计入胜率 | ${t.scored} |`)
  lines.push(`| A 胜 / B 胜 / 和 | ${t.aWins} / ${t.bWins} / ${t.draws} |`)
  lines.push(`| **A 得分率** | **${pct(summary.scoreRate)}** |`)
  if (summary.ci !== null) {
    lines.push(
      `| ${(summary.ci.level * 100).toFixed(0)}% 置信区间（按开局簇 Bootstrap，${summary.ci.samples} 次） | ${pct(summary.ci.low)} – ${pct(summary.ci.high)} |`,
    )
  } else {
    lines.push('| 置信区间 | 样本不足 |')
  }
  if (summary.elo !== null) {
    lines.push(`| 描述性 Elo 差（**仅供参考**） | ${summary.elo > 0 ? '+' : ''}${summary.elo.toFixed(0)} |`)
  }
  lines.push('')

  if (t.moveLimit + t.aborted + t.illegalMove + t.noMove + t.engineError + t.environmentError > 0) {
    lines.push('### 未完成 / 异常（不计入胜率）')
    lines.push('')
    lines.push('| 类型 | 数量 |')
    lines.push('| --- | --- |')
    lines.push(`| 达到手数上限 | ${t.moveLimit} |`)
    lines.push(`| 实验超时中止 | ${t.aborted} |`)
    lines.push(`| 非法着法 | ${t.illegalMove} |`)
    lines.push(`| 未返回着法 | ${t.noMove} |`)
    lines.push(`| 引擎异常 | ${t.engineError} |`)
    lines.push(`| 评测环境错误 | ${t.environmentError} |`)
    lines.push('')
  }

  lines.push('## 先后手')
  lines.push('')
  lines.push('| 方 | 执 | 局数 | 胜 / 和 / 负 | 得分率 |')
  lines.push('| --- | --- | --- | --- | --- |')
  const colorRows: readonly (readonly [string, string, typeof summary.asBlack])[] = [
    ['A', '黑', summary.asBlack],
    ['A', '白', summary.asWhite],
    ['B', '黑', summary.bAsBlack],
    ['B', '白', summary.bAsWhite],
  ]
  for (const [side, color, split] of colorRows) {
    lines.push(
      `| ${side} | ${color} | ${split.games} | ${split.wins} / ${split.draws} / ${split.losses} | ${pct(split.scoreRate)} |`,
    )
  }
  lines.push('')

  lines.push('## 逐开局')
  lines.push('')
  lines.push('| 开局 | 重复 | A 得分率 | A 执黑结局 | B 执黑结局 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const row of summary.perOpening) {
    lines.push(
      `| ${row.opening} | ${row.repeats} | ${pct(row.aScoreRate)} | ${row.aBlackOutcomes} | ${row.bBlackOutcomes} |`,
    )
  }
  lines.push('')

  lines.push('## 搜索指标')
  lines.push('')
  lines.push('| 引擎 | 着法数 | 平均节点 | 中位节点 | 最大节点 | 平均深度 | 平均耗时 | 超时 | 捷径 | 置换命中 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const [label, stats] of [['A', report.search.a], ['B', report.search.b]] as const) {
    lines.push(
      `| ${label} | ${stats.moves} | ${num(stats.avgNodes)} | ${stats.medianNodes} | ${stats.maxNodes} | ${num(stats.avgDepth)} | ${num(stats.avgElapsedMs)} ms | ${stats.timeouts} | ${stats.shortcuts} | ${stats.ttHits} |`,
    )
  }
  lines.push('')
  lines.push('阶段划分：开局 = 第 1–20 手，中盘 = 第 21–60 手，后期 = 第 61 手起。')
  lines.push('')
  lines.push('| 引擎 | 阶段 | 着法 | 平均节点 | 最大节点 | 平均深度 | 平均耗时 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const [label, stats] of [['A', report.search.a], ['B', report.search.b]] as const) {
    for (const phase of ['opening', 'middle', 'end'] as const) {
      const p = stats.phases[phase]
      lines.push(`| ${label} | ${phase} | ${p.moves} | ${num(p.avgNodes)} | ${p.maxNodes} | ${num(p.avgDepth)} | ${num(p.avgElapsedMs)} ms |`)
    }
  }
  lines.push('')

  if (meta.baseline !== undefined) {
    lines.push('## 与基线比较')
    lines.push('')
    const b = meta.baseline
    lines.push(`- 基线文件：\`${b.path}\`（${b.aId} vs ${b.bId}，得分率 ${pct(b.scoreRate)}）`)
    lines.push(`- 本次差值：${b.delta === null ? '—' : `${(b.delta * 100).toFixed(1)} 个百分点`}`)
    lines.push(`- ${b.note}`)
    lines.push('')
  }

  if (meta.notes.length > 0) {
    lines.push('## 测量条件')
    lines.push('')
    for (const note of meta.notes) lines.push(`- ${note}`)
    lines.push('')
  }

  lines.push('## 局限')
  lines.push('')
  lines.push('- 得分率只统计正常结束的对局；未完成与异常单列，不并入和棋。')
  lines.push('- 置信区间以**开局**为单位重采样；单局之间不独立。')
  lines.push('- 描述性 Elo 假设固定棋力差，小样本下不能当作客观等级。')
  lines.push('- 真实预算结果依赖机器速度与当时负载；不同环境的结果不应直接比较。')
  lines.push('')

  return lines.join('\n')
}

export interface WrittenReport {
  readonly jsonPath: string
  readonly markdownPath: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 找一个「JSON 与 Markdown 都还空着」的文件名主干：`name`、`name-2`、`name-3`……
 *
 * 两者必须一起判空：分别找空位会让一份报告的两个文件落成 `x-2.json` + `x.md`，
 * 名字对不上，事后按名配对就会错。
 */
async function freeStem(dir: string, base: string): Promise<string> {
  for (let index = 1; ; index++) {
    const stem = resolve(dir, `${base}${index === 1 ? '' : `-${index}`}`)
    if (!(await exists(`${stem}.json`)) && !(await exists(`${stem}.md`))) return stem
  }
}

export async function writeReport(
  report: ExperimentReport,
  outDir: string,
): Promise<WrittenReport> {
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })

  const stamp = report.meta.startedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const slug = `${stamp}-${reportSlug(report.summary.aId, report.summary.bId)}`

  /*
   * **绝不覆盖已有文件。** 同一秒内跑两次（或手工重跑）会撞名；直接写会把上一份
   * 结果无声吃掉，而「历史实验不能丢」是这套系统的硬要求。撞名时退到 `-2`、`-3`。
   */
  const stem = await freeStem(dir, slug)
  const jsonPath = `${stem}.json`
  const markdownPath = `${stem}.md`

  // 把结果路径写回报告本身：读者拿着 Markdown 也能追到完整逐局数据。
  const payload: ExperimentReport = {
    ...report,
    meta: { ...report.meta, resultFile: jsonPath },
  }

  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, `${renderMarkdown(payload)}\n`, 'utf8')

  return { jsonPath, markdownPath }
}
