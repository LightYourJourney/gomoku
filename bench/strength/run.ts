import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { arch, cpus, loadavg, platform } from 'node:os'
import { test } from 'vitest'
import { ENGINE_VERSION } from '../../src/ai/version'
import { isDifficulty } from '../../src/ai/difficulty'
import type { Difficulty } from '../../src/ai/types'
import { loadEngine } from './engines'
import { resolveOptions } from './local'
import { runExperiment } from './match'
import { OPENINGS, type MatchOpening } from './openings'
import { writeReport, type BaselineComparison, type ExperimentReport, type RunMeta } from './report'
import { searchStats, summarize } from './stats'
import type { EngineSpec } from './types'

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
 * yarn strength                                          # 冒烟：入门 vs 初级
 * STRENGTH_MODE=standard STRENGTH_A=medium STRENGTH_B=hard yarn strength
 * STRENGTH_A=medium STRENGTH_A_FIXED=2 STRENGTH_B=medium STRENGTH_B_FIXED=4 yarn strength
 * STRENGTH_A=medium STRENGTH_A_FIXED=3 STRENGTH_B=medium STRENGTH_B_FIXED=3 \
 * STRENGTH_B_MODULE=bench/strength/.engines/base.mjs yarn strength
 * ```
 *
 * 同一难度下做版本对照时，B 的 id 会自动带上引擎包名（`hard@base`），
 * 不需要手工设 `_ID`。
 *
 * ## 结束条件
 *
 * 每局都有手数上限；整个实验还有墙钟上限（`STRENGTH_ABORT_MS`），
 * 超出的对局记 `aborted`，不会被静默丢成和棋。
 *
 * **已知边界**：搜索是同步的，墙钟只在两手之间检查。单步定深搜索若慢到超过上限，
 * 这一步仍会跑完（无法抢占不带 Worker 的同步代码）。真正的硬保护是 vitest 的进程超时，
 * 但那样不会留下报告——所以这里把它当兜底，不当作常规控制手段。
 */

const RESULT_DIR = 'bench/strength/results'
const BOOTSTRAP_SAMPLES = 2_000
const BOOTSTRAP_SEED = 0x9e3779b9

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

function boolEnv(name: string): boolean | undefined {
  const value = env(name)
  if (value === undefined) return undefined
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  throw new Error(`${name} 只接受 1/0 或 true/false，收到 ${value}`)
}

function difficultyEnv(name: string, fallback: Difficulty): Difficulty {
  const value = env(name) ?? fallback
  if (!isDifficulty(value)) {
    throw new Error(`${name}=${value} 不是合法难度（可选：beginner/easy/medium/hard/expert）`)
  }
  return value
}

function specFromEnv(prefix: 'A' | 'B', difficulty: Difficulty): EngineSpec {
  const fixed = env(`STRENGTH_${prefix}_FIXED`)
  const clock = fixed === undefined ? 'real' : 'fixed'
  const module_ = env(`STRENGTH_${prefix}_MODULE`)
  const budget = env(`STRENGTH_${prefix}_BUDGET`)
  const width = env(`STRENGTH_${prefix}_WIDTH`)
  const threatPlies = env(`STRENGTH_${prefix}_THREAT_PLIES`)
  const transposition = boolEnv(`STRENGTH_${prefix}_TRANSPOSITION`)
  const threatThrees = boolEnv(`STRENGTH_${prefix}_THREAT_THREES`)

  /*
   * 默认 id：难度 + 固定深度 + 引擎包名。
   *
   * 少了包名这一项，「同一难度、不同版本」的对照会撞 id ——而那正是版本对照
   * 的主用法（`STRENGTH_A=hard STRENGTH_B=hard STRENGTH_B_MODULE=...`）。
   * 首轮实测就撞在这里：报「A 与 B 的 id 相同」，版本对照根本跑不起来。
   */
  const suffix =
    (fixed === undefined ? '' : `-d${fixed}`) +
    (module_ === undefined ? '' : `@${basename(module_).replace(/\.mjs$/, '')}`)

  return {
    id: env(`STRENGTH_${prefix}_ID`) ?? `${difficulty}${suffix}`,
    label: env(`STRENGTH_${prefix}_LABEL`) ?? difficulty,
    difficulty,
    clock,
    ...(fixed === undefined ? {} : { maxDepth: Number(fixed) }),
    ...(budget === undefined ? {} : { budgetMs: Number(budget) }),
    ...(width === undefined ? {} : { width: Number(width) }),
    ...(threatPlies === undefined ? {} : { threatPlies: Number(threatPlies) }),
    ...(transposition === undefined ? {} : { transposition }),
    ...(threatThrees === undefined ? {} : { threatThrees }),
    ...(module_ === undefined ? {} : { module: module_ }),
  }
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function modePreset(mode: string): (typeof MODE_PRESETS)[string] {
  const preset = MODE_PRESETS[mode]
  if (preset === undefined) {
    throw new Error(`未知 STRENGTH_MODE=${mode}（可选：${Object.keys(MODE_PRESETS).join(' / ')}）`)
  }
  return preset
}

function selectOpenings(preset: { openings: readonly string[] }): MatchOpening[] {
  const ids = env('STRENGTH_OPENINGS')?.split(',') ?? preset.openings
  return ids.map((id) => {
    const found = OPENINGS.find((o) => o.id === id)
    if (found === undefined) throw new Error(`未知开局：${id}`)
    return found
  })
}

/** 开局集版本：id 与手顺的指纹。改动开局集就会换版本，历史结果不会混为一谈。 */
function openingsVersion(openings: readonly MatchOpening[]): string {
  const payload = JSON.stringify(openings.map((o) => ({ id: o.id, moves: o.moves })))
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/**
 * 记录**等价命令**：vitest 自身的 argv（`node .../vitest.mjs run`）对复现者没有意义。
 * 这里按实际生效的配置拼一条可直接粘贴的命令，包括每一个非默认覆盖项。
 */
function commandLine(mode: string, a: EngineSpec, b: EngineSpec, repeats: number, maxMoves: number): string {
  const describe = (prefix: 'A' | 'B', spec: EngineSpec): string[] => {
    const parts = [`STRENGTH_${prefix}=${spec.difficulty}`]
    if (spec.maxDepth !== undefined) parts.push(`STRENGTH_${prefix}_FIXED=${spec.maxDepth}`)
    if (spec.budgetMs !== undefined) parts.push(`STRENGTH_${prefix}_BUDGET=${spec.budgetMs}`)
    if (spec.width !== undefined) parts.push(`STRENGTH_${prefix}_WIDTH=${spec.width}`)
    if (spec.threatPlies !== undefined) parts.push(`STRENGTH_${prefix}_THREAT_PLIES=${spec.threatPlies}`)
    if (spec.transposition !== undefined) parts.push(`STRENGTH_${prefix}_TRANSPOSITION=${spec.transposition ? 1 : 0}`)
    if (spec.threatThrees !== undefined) parts.push(`STRENGTH_${prefix}_THREAT_THREES=${spec.threatThrees ? 1 : 0}`)
    if (spec.module !== undefined) parts.push(`STRENGTH_${prefix}_MODULE=${spec.module}`)
    parts.push(`STRENGTH_${prefix}_ID=${spec.id}`)
    return parts
  }

  return [
    'yarn strength',
    `STRENGTH_MODE=${mode}`,
    ...describe('A', a),
    ...describe('B', b),
    `STRENGTH_REPEATS=${repeats}`,
    `STRENGTH_MAX_MOVES=${maxMoves}`,
  ].join(' ')
}

/** 可选：与一份历史报告比较 A 的得分率。 */
async function readBaseline(aId: string, bId: string, current: number | null): Promise<BaselineComparison | undefined> {
  const path = env('STRENGTH_BASELINE')
  if (path === undefined) return undefined

  const raw = JSON.parse(await readFile(path, 'utf8')) as {
    summary?: { aId?: string; bId?: string; scoreRate?: number | null }
  }
  const previous = raw.summary
  if (previous === undefined || typeof previous.scoreRate !== 'number') {
    throw new Error(`基线文件缺少 summary.scoreRate：${path}`)
  }

  const samePairing = previous.aId === aId && previous.bId === bId
  return {
    path,
    aId: previous.aId ?? '?',
    bId: previous.bId ?? '?',
    scoreRate: previous.scoreRate,
    delta: samePairing && current !== null ? current - previous.scoreRate : null,
    note: samePairing
      ? '双方配置相同，差值可直接读。'
      : '双方配置不同，差值不给（不同对手的得分率不可相减）。',
  }
}

test('AI 强度评测', async () => {
  const mode = env('STRENGTH_MODE') ?? 'smoke'
  const preset = modePreset(mode)

  const aSpec = specFromEnv('A', difficultyEnv('STRENGTH_A', 'beginner'))
  const bSpec = specFromEnv('B', difficultyEnv('STRENGTH_B', 'easy'))

  // id 相同会让「谁赢了」无法归属，也说明对比配置没拉开
  if (aSpec.id === bSpec.id) {
    throw new Error('A 与 B 的 id 相同，无法区分归属；若两边确实不同（如仅宽度不同），用 STRENGTH_A_ID / STRENGTH_B_ID 区分')
  }
  // 一边真实时钟、一边固定深度，测出来的东西没有意义；宁可开跑前失败
  if (aSpec.clock !== bSpec.clock) {
    throw new Error('A 与 B 必须同为 fixed 或同为 real——混合模式的结果不可解释')
  }

  const openings = selectOpenings(preset)
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
  if (aSpec.clock === 'fixed') {
    noteParts.push('确定性模式（时钟固定、深度固定）：可复现，但**不代表**正式难度下的棋力。')
  } else {
    noteParts.push('真实时钟 + 正式难度预算：结果依赖机器速度与当时负载。')
  }
  noteParts.push(`负载均值（1 分钟）：${loadavg()[0]?.toFixed(2) ?? '未知'}`)

  const baseline = await readBaseline(aSpec.id, bSpec.id, summary.scoreRate)

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
    command: commandLine(mode, aSpec, bSpec, repeats, maxMoves),
    openingsVersion: openingsVersion(openings),
    statistics: {
      method: '配对 Bootstrap，以开局为簇重采样',
      bootstrapSamples: BOOTSTRAP_SAMPLES,
      bootstrapSeed: BOOTSTRAP_SEED,
      clusterUnit: 'opening',
    },
    ...(baseline === undefined ? {} : { baseline }),
    notes: noteParts,
  }

  const report: ExperimentReport = {
    meta,
    a: { spec: aSpec, resolved: resolveOptions(aSpec), digest: a.digest, kind: a.kind },
    b: { spec: bSpec, resolved: resolveOptions(bSpec), digest: b.digest, kind: b.kind },
    openings: openings.map((o) => ({ id: o.id, moves: o.moves.map((p) => ({ x: p.x, y: p.y })) })),
    maxMoves,
    repeats,
    summary,
    search: {
      a: searchStats(sets, aSpec.id, resolveOptions(aSpec).budgetMs),
      b: searchStats(sets, bSpec.id, resolveOptions(bSpec).budgetMs),
    },
    games: sets.flatMap((set) => [set.aBlack, set.bBlack]),
  }

  const written = await writeReport(report, RESULT_DIR)

  const t = summary.tally
  console.log(
    `\n=== ${aSpec.id} vs ${bSpec.id}（${mode}）===\n` +
      `对局 ${t.games}（计分 ${t.scored}）｜A 胜 ${t.aWins} / B 胜 ${t.bWins} / 和 ${t.draws}\n` +
      `未完成：手数上限 ${t.moveLimit}｜中止 ${t.aborted}｜非法 ${t.illegalMove}｜` +
      `无着法 ${t.noMove}｜引擎异常 ${t.engineError}｜环境错误 ${t.environmentError}\n` +
      `A 得分率 ${summary.scoreRate === null ? '—' : (summary.scoreRate * 100).toFixed(1) + '%'}` +
      (summary.ci === null
        ? ''
        : `（${(summary.ci.level * 100).toFixed(0)}% CI ${(summary.ci.low * 100).toFixed(1)}–${(summary.ci.high * 100).toFixed(1)}%）`) +
      `\n报告：${written.jsonPath}\n      ${written.markdownPath}`,
  )
}, 30 * 60_000)
