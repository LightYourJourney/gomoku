#!/usr/bin/env node
/*
 * e2e 跳过棘轮的**运行期**判据：读 Playwright JSON 报告，数「没真跑 / 预期失败」的用例。
 *
 * 为什么静态扫描不够（`tests.ratchet.mjs` 那份）：静态扫描只能认字面写法，
 * `const t = test; t['sk' + 'ip'](…)`、在 helper 里拼出来的调用、运行期条件跳过……
 * 总有认不出的写法。跑完之后 Playwright 自己知道哪些用例被跳过了——问它，不去猜源码。
 *
 * 判据：
 *   1. **每份报告的条数必须精确等于基线**（允许 ±0）：
 *      `stats.expected + stats.unexpected + stats.flaky + stats.skipped`
 *      = 这份报告对应的 `tests.baseline.json` 总数。
 *      旧判据只拒绝「0 条真跑」，于是 `--grep 'pass one'` 的 1 条执行、0 跳过
 *      照样能过（实测）；条数对不上就说明这次跑的不是整套，任何「没有跳过」的
 *      结论都证明不了。`ran + skipped + 预期失败` 恰好就是这四项之和。
 *   2. 报告里逐条数出来的用例数也必须等于 stats 合计：报告结构变了、走漏了，失败关闭。
 *   3. `status === 'skipped'`（test.skip / test.fixme / 运行期 `testInfo.skip()`）
 *      与 `expectedStatus !== 'passed'`（test.fail——判据反过来了，等于关掉）
 *      两者合计 ≤ `tests.baseline.json` 的 `e2eSkipped`。
 *
 * 期望值按**文件名约定**从 tests.baseline.json 取（CI 的报告文件名是固定的）：
 *   e2e.json             → e2eTotal
 *   e2e-prod.json        → e2eProdTotal
 *   e2e-browsers.json    → e2eBrowsersTotal
 *   e2e-browsers-full.json → e2eBrowsersFullTotal
 * 本地单份报告也可以显式给 `--expected <n>`（一次只配一份报告）。
 *
 * 用法：`yarn check:e2e-skips <报告.json>…`。
 * 报告由 `PLAYWRIGHT_JSON_OUTPUT_FILE=<报告.json> yarn e2e --reporter=list,json`
 * 产出（CI 的 e2e / prod / browsers / browsers-full job 里就是这么接的）。
 */

import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { argValue, assertShape, readJson } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 报告文件名 → 基线键。CI 的报告名固定，本地可改用 `--expected <n>`。 */
const EXPECTED_KEYS = {
  'e2e.json': 'e2eTotal',
  'e2e-prod.json': 'e2eProdTotal',
  'e2e-browsers.json': 'e2eBrowsersTotal',
  'e2e-browsers-full.json': 'e2eBrowsersFullTotal',
}

const expectedArg = argValue('--expected')
const files = []
{
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expected') {
      i += 1
      continue
    }
    files.push(argv[i])
  }
}
if (files.length === 0) {
  console.error('✗ 没给报告文件：用法 `yarn check:e2e-skips [--expected <n>] <报告.json>…`')
  process.exit(2)
}
if (expectedArg !== undefined && files.length !== 1) {
  console.error(`✗ --expected 一次只能配一份报告（现在给了 ${files.length} 份）。多份报告请按文件名约定命名。`)
  process.exit(2)
}
if (expectedArg !== undefined && !/^\d+$/.test(expectedArg)) {
  console.error(`✗ --expected 要一个非负整数，实际给的是：${expectedArg}`)
  process.exit(2)
}

const baseline = await readJson(resolve(HERE, 'tests.baseline.json'), '基线')
assertShape(
  typeof baseline.e2eSkipped === 'number' ? [] : [`e2eSkipped 不是数字（实际 ${JSON.stringify(baseline.e2eSkipped)}）`],
  'quality/tests.baseline.json',
)

/**
 * 这份报告的期望总条数。`--expected` 优先；否则按文件名查基线。
 * 查不到（文件名不在约定里、基线缺键）一律失败关闭——没有期望值就没法判断
 * 「跑的是不是整套」。
 */
function expectedFor(file) {
  if (expectedArg !== undefined) return Number(expectedArg)
  const key = EXPECTED_KEYS[basename(file)]
  if (key === undefined) {
    console.error(
      `✗ ${file}：文件名不是约定之一（${Object.keys(EXPECTED_KEYS).join(' / ')}）。\n` +
        '  按 CI 的名字重命名报告，或本地单份报告用 --expected <n> 显式给期望条数。',
    )
    process.exit(2)
  }
  const value = baseline[key]
  assertShape(
    typeof value === 'number' ? [] : [`${key} 不是数字（实际 ${JSON.stringify(value)}），${file} 没法比对条数`],
    'quality/tests.baseline.json',
  )
  return value
}

const problems = []
const offenders = []
let ran = 0
for (const file of files) {
  const report = await readJson(resolve(file), ' Playwright JSON 报告', '它是 `--reporter=list,json` + `PLAYWRIGHT_JSON_OUTPUT_FILE` 的产物。')
  const stats = report.stats ?? {}
  const bad = ['expected', 'unexpected', 'flaky', 'skipped'].filter((k) => typeof stats[k] !== 'number')
  if (bad.length > 0 || !Array.isArray(report.suites)) {
    problems.push(`${file}：不像 Playwright JSON 报告（stats 缺 ${bad.join('、') || '—'}，或没有 suites）`)
    continue
  }

  const counts = ['expected', 'unexpected', 'flaky', 'skipped'].map((k) => stats[k])
  const total = counts.reduce((sum, n) => sum + n, 0)
  const executed = stats.expected + stats.unexpected + stats.flaky
  if (executed === 0) problems.push(`${file}：一条用例都没真跑（stats ${JSON.stringify(stats)}），证明不了任何事`)
  ran += executed

  const expected = expectedFor(file)
  if (total !== expected) {
    problems.push(
      `${file}：实际 ${total} 条（通过/意外失败/重试通过/跳过 = ${counts.join('+')}），` +
        `基线期望 ${expected} 条，差 ${total - expected}——跑的不是整套 e2e，结论无效`,
    )
  }

  let walkedAll = 0
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        walkedAll += 1
        if (t.status === 'skipped' || t.expectedStatus !== 'passed') {
          const why = t.status === 'skipped' ? '跳过' : `预期 ${t.expectedStatus}`
          offenders.push(`${spec.file}:${spec.line} [${t.projectName}] ${spec.title}（${why}）`)
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  report.suites.forEach(visit)
  // 逐条走出来的总数不能和 stats 对不上：少了说明报告结构变了、走漏了（失败关闭）。
  if (walkedAll !== total) {
    problems.push(`${file}：stats 合计 ${total} 条，但逐条只数到 ${walkedAll} 条（报告结构变了？失败关闭）`)
  }
}

const count = offenders.length
if (count > baseline.e2eSkipped) {
  problems.push(`e2e 运行期跳过 / 预期失败：基线 ${baseline.e2eSkipped} → 本次 ${count}`)
}

if (problems.length > 0) {
  console.error(`✗ e2e 运行期跳过棘轮：${problems.length} 项`)
  for (const p of problems) console.error(`  - ${p}`)
  for (const o of offenders.slice(0, 30)) console.error(`    ${o}`)
  if (offenders.length > 30) console.error(`    ……还有 ${offenders.length - 30} 条`)
  console.error('\n  跳用例就是把安全网改小。真要减，显式改 quality/tests.baseline.json 并在提交信息里写明为什么。')
  process.exit(1)
}
console.log(
  `✓ e2e 运行期跳过棘轮通过：${files.length} 份报告、真跑 ${ran} 条，逐份条数与期望值精确一致，` +
    `跳过 / 预期失败 ${count} 条`,
)
