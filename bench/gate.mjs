#!/usr/bin/env node
/*
 * 基准数值门禁：`yarn bench:check`。
 *
 * 为什么要有它：`yarn bench` 只产数字不判红，性能回退靠人工比对——那是「没人跑就不会跑」。
 * 但基准数字**对机器速度敏感**，直接对全部行断言会造出一台假红制造机
 * （慢 1.45 倍的 runner 就能让 hard 那两行从 search 翻成 timeout）。
 *
 * 所以判据分两半：
 *   1. `search` 里**余量充足**的行（基线耗时 ≤ 预算 × maxBudgetRatio，即 ≥5 倍余量）：
 *      断言 depth/nodes 与基线**完全相等**。跑成 timeout 是**响亮地红**——不是静默跳过。
 *      余量不足的行**跳过**，但逐行打印为什么跳过。
 *   2. **与机器速度无关的不变量**（棋型判定、VCT 结果、调用次数）：成本为零，一律断言。
 *
 * 断言集由 `bench/baseline.json` 的 `gated` 字段决定，**不由当次运行结果决定**：
 * 否则「search 翻成 timeout」这种退化会被静默跳过。预算是**冻结值**，
 * 不现从 `difficulty.ts` 算——现算的话，有人调小某档预算就会让那一行
 * 无声地掉出断言集。
 *
 * 用法：`node bench/gate.mjs [--current <产物路径>]`
 */

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 只打印耗时、不判定的字段——它们随机器变，判了就是假红。 */
const TIMING_FIELDS = ['elapsedMs', 'perCallUs', 'suggestionsMs', 'fastUs', 'pointUs', 'vcfMs', 'vctMs']

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    console.error(`✗ 读不到产物：${path}`)
    console.error(`  ${err.message}`)
    console.error('  先跑 `yarn bench`，或用 --current 指一份已有产物。')
    process.exit(2)
  }
}

const args = process.argv.slice(2)
const currentArg = args.indexOf('--current')
const baseline = await readJson(resolve(HERE, 'baseline.json'))
const current = await readJson(
  currentArg === -1 ? resolve(HERE, 'last-run.json') : resolve(args[currentArg + 1]),
)

const failures = []
const skipped = []
let gatedPassed = 0

// ── 第一半：search 行 ──────────────────────────────────────────────
const key = (r) => `${r.difficulty}|${r.position}`
const baseRows = new Map(baseline.rows.map((r) => [key(r), r]))
const curRows = new Map((current.search ?? []).map((r) => [key(r), r]))

for (const [k, b] of baseRows) {
  const c = curRows.get(k)
  if (c === undefined) {
    failures.push(`${k}：基线上有这一行，这次没有——局面集变了？改基线要显式改 bench/baseline.json`)
    continue
  }
  if (!b.gated) {
    const pct = ((c.elapsedMs / b.budgetMs) * 100).toFixed(0)
    skipped.push(`${k}：基线耗时占预算 ${pct}%（> ${baseline.maxBudgetRatio * 100}%），余量不足以跨机器断言，只打印`)
    continue
  }
  if (c.reason === 'timeout') {
    failures.push(
      `${k}：**这一行在基线上是搜完的**（${b.depth} 层 / ${b.nodes} 节点），这次没搜完就超时了。\n` +
        `      要么算法变重了，要么这台机器慢到没跑完——先比对耗时再判断，别直接放宽基线。`,
    )
    continue
  }
  if (c.depth !== b.depth || c.nodes !== b.nodes) {
    failures.push(
      `${k}：\n` +
        `      基线 depth=${b.depth} nodes=${b.nodes}\n` +
        `      本次 depth=${c.depth} nodes=${c.nodes}（reason=${c.reason}，耗时 ${c.elapsedMs}ms / 预算 ${b.budgetMs}ms）`,
    )
    continue
  }
  gatedPassed += 1
}

for (const [k] of curRows) {
  if (!baseRows.has(k)) {
    failures.push(`${k}：产物里有这一行，基线里没有——新增局面要显式加进基线，否则它会静默地不受断言保护`)
  }
}

// ── 第二半：与机器速度无关的不变量 ────────────────────────────────
let invariantChecks = 0
function assertField(where, name, actual, expected) {
  invariantChecks += 1
  if (actual !== expected) failures.push(`${where} 的 ${name}：基线 ${expected}，本次 ${actual}`)
}

for (const b of baseline.invariants.threat) {
  const c = (current.threat ?? []).find((t) => t.name === b.name)
  if (c === undefined) {
    failures.push(`threat「${b.name}」：基线上有，这次没有`)
    continue
  }
  for (const f of ['mismatch', 'found', 'plies']) {
    assertField(`threat「${b.name}」`, f, c[f], b[f])
  }
}
for (const b of baseline.invariants.vct) {
  const c = (current.vct ?? []).find((v) => v.name === b.name)
  if (c === undefined) {
    failures.push(`vct「${b.name}」：基线上有，这次没有`)
    continue
  }
  for (const f of ['vcfFound', 'vctFound', 'gains', 'vcfPlies', 'vctPlies']) {
    assertField(`vct「${b.name}」`, f, c[f], b[f])
  }
}
assertField('evaluate', 'calls', current.evaluate?.calls, baseline.invariants.evaluateCalls)
assertField('analysis', 'points', current.analysis?.points, baseline.invariants.analysisPoints)

// ── 汇总 ──────────────────────────────────────────────────────────
for (const line of skipped) console.log(`· 跳过 ${line}`)

const timed = (current.search ?? [])
  .filter((r) => r.reason === 'search')
  .map((r) => r.elapsedMs)
if (timed.length > 0) {
  console.log(
    `· 耗时只打印不判定（最慢一行 ${Math.max(...timed)}ms；${TIMING_FIELDS.join('/')} 都随机器变）`,
  )
}

if (failures.length > 0) {
  console.error(`\n✗ 基准门禁未通过：${failures.length} 项`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exitCode = 1
} else {
  console.log(
    `\n✓ 基准门禁通过：断言行 ${gatedPassed} 条一致 / 跳过 ${skipped.length} 条 / 不变量 ${invariantChecks} 项一致`,
  )
}
