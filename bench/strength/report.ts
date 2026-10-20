import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { GameRecord } from './types'
import type { SearchStats, StrengthSummary } from './stats'

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
  readonly spec: unknown
  readonly digest: string
  readonly kind: 'source' | 'module'
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
  lines.push('')

  lines.push('## 配置')
  lines.push('')
  lines.push('| 方 | 配置 | 来源 | 指纹 |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(`| A | \`${JSON.stringify(report.a.spec)}\` | ${report.a.kind} | \`${report.a.digest.slice(0, 12)}\` |`)
  lines.push(`| B | \`${JSON.stringify(report.b.spec)}\` | ${report.b.kind} | \`${report.b.digest.slice(0, 12)}\` |`)
  lines.push('')

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

  if (t.moveLimit + t.aborted + t.illegalMove + t.noMove + t.engineError > 0) {
    lines.push('### 未完成 / 异常（不计入胜率）')
    lines.push('')
    lines.push('| 类型 | 数量 |')
    lines.push('| --- | --- |')
    lines.push(`| 达到手数上限 | ${t.moveLimit} |`)
    lines.push(`| 实验超时中止 | ${t.aborted} |`)
    lines.push(`| 非法着法 | ${t.illegalMove} |`)
    lines.push(`| 未返回着法 | ${t.noMove} |`)
    lines.push(`| 引擎异常 | ${t.engineError} |`)
    lines.push('')
  }

  lines.push('## 先后手')
  lines.push('')
  lines.push('| A 执 | 局数 | 胜 / 和 / 负 | 得分率 |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(
    `| 黑 | ${summary.asBlack.games} | ${summary.asBlack.wins} / ${summary.asBlack.draws} / ${summary.asBlack.losses} | ${pct(summary.asBlack.scoreRate)} |`,
  )
  lines.push(
    `| 白 | ${summary.asWhite.games} | ${summary.asWhite.wins} / ${summary.asWhite.draws} / ${summary.asWhite.losses} | ${pct(summary.asWhite.scoreRate)} |`,
  )
  lines.push('')

  lines.push('## 逐开局')
  lines.push('')
  lines.push('| 开局 | 重复 | A 得分率 | A 执黑结局 | B 执黑结局 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const row of summary.perOpening) {
    lines.push(`| ${row.opening} | ${row.repeats} | ${pct(row.aScoreRate)} | ${row.aBlackOutcome} | ${row.bBlackOutcome} |`)
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

export async function writeReport(
  report: ExperimentReport,
  outDir: string,
): Promise<WrittenReport> {
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })

  const stamp = report.meta.startedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const slug = `${stamp}-${reportSlug(report.summary.aId, report.summary.bId)}`

  const jsonPath = resolve(dir, `${slug}.json`)
  const markdownPath = resolve(dir, `${slug}.md`)

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, `${renderMarkdown(report)}\n`, 'utf8')

  return { jsonPath, markdownPath }
}
