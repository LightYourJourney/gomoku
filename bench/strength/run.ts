import { execFileSync } from 'node:child_process'
import { arch, cpus, loadavg, platform } from 'node:os'
import { test } from 'vitest'
import { ENGINE_VERSION } from '../../src/ai/version'
import { loadEngine } from './engines'
import { runExperiment } from './match'
import { OPENINGS, type MatchOpening } from './openings'
import { writeReport, type ExperimentReport, type RunMeta } from './report'
import { searchStats, summarize } from './stats'
import type { EngineSpec } from './types'
import type { Difficulty } from '../../src/ai/types'

/**
 * 评测入口：`yarn strength`。
 *
 * 走 vitest 而不是自己造一个 CLI 解析器：仓库已经用这套方式跑基准
 * （`bench/learn.measure.ts`），vitest 提供进程隔离、超时与报告，
 * 不必再引一个依赖。
 *
 * ## 用法
 *
 * ```bash
 * yarn strength                                      # 冒烟：入门 vs 初级，两个开局
 * STRENGTH_MODE=standard STRENGTH_A=medium STRENGTH_B=hard yarn strength
 * STRENGTH_A=medium STRENGTH_B=medium STRENGTH_A_FIXED=4 yarn strength   # 确定性对比
 * STRENGTH_B_MODULE=.engines/7a08f32.mjs STRENGTH_A=hard STRENGTH_B=hard yarn strength
 * ```
 *
 * ## 结束条件
 *
 * 每局都有手数上限；整个实验还有墙钟上限（`STRENGTH_ABORT_MS`），
 * 超出的对局记 `aborted`，不会被静默丢成和棋。
 */

const RESULT_DIR = 'bench/strength/results'

const MODE_PRESETS: Record<string, { openings: readonly string[]; repeats: number; maxMoves: number }> = {
  // 冒烟：几秒钟到一两分钟，日常开发用
  smoke: { openings: ['center-adjacent', 'center-diagonal'], repeats: 1, maxMoves: 80 },
  // 标准：人工触发的版本对比
  standard: {
    openings: ['center-adjacent', 'center-diagonal', 'center-knight', 'offset-first'],
    repeats: 1,
    maxMoves: 120,
  },
  // 扩展：重要算法变更后验证
  extended: { openings: OPENINGS.map((o) => o.id), repeats: 2, maxMoves: 160 },
}

function env(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function specFromEnv(prefix: 'A' | 'B', difficulty: Difficulty): EngineSpec {
  const fixed = env(`STRENGTH_${prefix}_FIXED`)
  const clock = fixed === undefined ? 'real' : 'fixed'
  const budget = env(`STRENGTH_${prefix}_BUDGET`)
  const width = env(`STRENGTH_${prefix}_WIDTH`)

  return {
    id: env(`STRENGTH_${prefix}_ID`) ?? `${difficulty}${fixed === undefined ? '' : `-d${fixed}`}`,
    label: env(`STRENGTH_${prefix}_LABEL`) ?? difficulty,
    difficulty,
    clock,
    ...(fixed === undefined ? {} : { maxDepth: Number(fixed) }),
    ...(budget === undefined ? {} : { budgetMs: Number(budget) }),
    ...(width === undefined ? {} : { width: Number(width) }),
    ...(env(`STRENGTH_${prefix}_MODULE`) === undefined
      ? {}
      : { module: env(`STRENGTH_${prefix}_MODULE`) }),
  }
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function selectOpenings(mode: string): MatchOpening[] {
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.smoke!
  const ids = env('STRENGTH_OPENINGS')?.split(',') ?? preset.openings
  return ids.map((id) => {
    const found = OPENINGS.find((o) => o.id === id)
    if (found === undefined) throw new Error(`未知开局：${id}`)
    return found
  })
}

test('AI 强度评测', async () => {
  const mode = env('STRENGTH_MODE') ?? 'smoke'
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.smoke!
  const aSpec = specFromEnv('A', (env('STRENGTH_A') ?? 'beginner') as Difficulty)
  const bSpec = specFromEnv('B', (env('STRENGTH_B') ?? 'easy') as Difficulty)

  // id 相同会让「谁赢了」无法归属，也说明对比配置没拉开
  if (aSpec.id === bSpec.id) throw new Error('A 与 B 的 id 相同，无法区分归属')

  const openings = selectOpenings(mode)
  const repeats = Number(env('STRENGTH_REPEATS') ?? preset.repeats)
  const maxMoves = Number(env('STRENGTH_MAX_MOVES') ?? preset.maxMoves)
  const abortAfterMs = env('STRENGTH_ABORT_MS')

  const startedAt = new Date()
  const a = await loadEngine(aSpec)
  const b = await loadEngine(bSpec)

  const sets = runExperiment(a.engine, b.engine, {
    openings,
    maxMoves,
    repeats,
    ...(abortAfterMs === undefined ? {} : { abortAfterMs: Number(abortAfterMs) }),
  })

  const finishedAt = new Date()
  const summary = summarize(sets, aSpec.id, bSpec.id)

  const noteParts: string[] = []
  if (aSpec.clock === 'fixed' || bSpec.clock === 'fixed') {
    noteParts.push('确定性模式（时钟固定、深度固定）：可复现，但**不代表**正式难度下的棋力。')
  } else {
    noteParts.push('真实时钟 + 正式难度预算：结果依赖机器速度与当时负载。')
  }
  noteParts.push(`负载均值（1 分钟）：${loadavg()[0]?.toFixed(2) ?? '未知'}`)

  const meta: RunMeta = {
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']) !== '',
    engineVersion: ENGINE_VERSION,
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpuCount: cpus().length,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    mode,
    // 记录**等价命令**而不是 vitest 的内部 argv：后者是 `node .../vitest.mjs run`，
    // 对复现者没有意义。这里按实际生效的配置拼一条可以直接粘贴的命令。
    command: [
      'yarn strength',
      `STRENGTH_MODE=${mode}`,
      `STRENGTH_A=${aSpec.difficulty}${aSpec.maxDepth === undefined ? '' : ` STRENGTH_A_FIXED=${aSpec.maxDepth}`}`,
      `STRENGTH_B=${bSpec.difficulty}${bSpec.maxDepth === undefined ? '' : ` STRENGTH_B_FIXED=${bSpec.maxDepth}`}`,
      ...(bSpec.module === undefined ? [] : [`STRENGTH_B_MODULE=${bSpec.module}`]),
      ...(repeats === preset.repeats ? [] : [`STRENGTH_REPEATS=${repeats}`]),
      ...(maxMoves === preset.maxMoves ? [] : [`STRENGTH_MAX_MOVES=${maxMoves}`]),
    ].join(' '),
    notes: noteParts,
  }

  const report: ExperimentReport = {
    meta,
    a: { spec: aSpec, digest: a.digest, kind: a.kind },
    b: { spec: bSpec, digest: b.digest, kind: b.kind },
    openings: openings.map((o) => ({ id: o.id, moves: o.moves.map((p) => ({ x: p.x, y: p.y })) })),
    maxMoves,
    repeats,
    summary,
    search: { a: searchStats(sets, aSpec.id), b: searchStats(sets, bSpec.id) },
    games: sets.flatMap((set) => [set.aBlack, set.bBlack]),
  }

  const written = await writeReport(report, RESULT_DIR)

  const t = summary.tally
  console.log(
    `\n=== ${aSpec.id} vs ${bSpec.id}（${mode}）===\n` +
      `对局 ${t.games}（计分 ${t.scored}）｜A 胜 ${t.aWins} / B 胜 ${t.bWins} / 和 ${t.draws}\n` +
      `未完成：手数上限 ${t.moveLimit}｜中止 ${t.aborted}｜非法 ${t.illegalMove}｜无着法 ${t.noMove}｜异常 ${t.engineError}\n` +
      `A 得分率 ${summary.scoreRate === null ? '—' : (summary.scoreRate * 100).toFixed(1) + '%'}` +
      (summary.ci === null
        ? ''
        : `（${(summary.ci.level * 100).toFixed(0)}% CI ${(summary.ci.low * 100).toFixed(1)}–${(summary.ci.high * 100).toFixed(1)}%）`) +
      `\n报告：${written.jsonPath}\n      ${written.markdownPath}`,
  )
}, 30 * 60_000)
