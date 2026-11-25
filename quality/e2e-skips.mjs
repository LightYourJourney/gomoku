#!/usr/bin/env node
/*
 * e2e 跳过棘轮的**运行期**判据：读 Playwright JSON 报告，数「没真跑 / 预期失败」的用例。
 *
 * 为什么静态扫描不够（`tests.ratchet.mjs` 那份）：静态扫描只能认字面写法，
 * `const t = test; t['sk' + 'ip'](…)`、在 helper 里拼出来的调用、运行期条件跳过……
 * 总有认不出的写法。跑完之后 Playwright 自己知道哪些用例被跳过了——问它，不去猜源码。
 *
 * 判据（所有报告合计 ≤ `tests.baseline.json` 的 `e2eSkipped`）：
 *   - `status === 'skipped'`：test.skip / test.fixme / 运行期 `testInfo.skip()` 都落在这里；
 *   - `expectedStatus !== 'passed'`：test.fail（预期失败——判据反过来了，等于关掉）。
 * 另外每份报告至少得真跑了一条：0 条的报告证明不了任何事，失败关闭。
 *
 * 用法：`yarn check:e2e-skips <报告.json>…`。报告由
 *   `PLAYWRIGHT_JSON_OUTPUT_FILE=<报告.json> yarn e2e --reporter=list,json`
 * 产出（CI 的 e2e / browsers job 里就是这么接的）。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertShape, readJson } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('✗ 没给报告文件：用法 `yarn check:e2e-skips <报告.json>…`')
  process.exit(2)
}

const baseline = await readJson(resolve(HERE, 'tests.baseline.json'), '基线')
assertShape(
  typeof baseline.e2eSkipped === 'number' ? [] : [`e2eSkipped 不是数字（实际 ${JSON.stringify(baseline.e2eSkipped)}）`],
  'quality/tests.baseline.json',
)

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
  const executed = stats.expected + stats.unexpected + stats.flaky
  if (executed === 0) problems.push(`${file}：一条用例都没真跑（stats ${JSON.stringify(stats)}），证明不了任何事`)
  ran += executed

  let walked = 0
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status === 'skipped' || t.expectedStatus !== 'passed') {
          walked += 1
          const why = t.status === 'skipped' ? '跳过' : `预期 ${t.expectedStatus}`
          offenders.push(`${spec.file}:${spec.line} [${t.projectName}] ${spec.title}（${why}）`)
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  report.suites.forEach(visit)
  // 逐条走出来的数不能比 stats 少：少了说明报告结构变了、走漏了，按 stats 算（失败关闭）。
  if (walked < stats.skipped) {
    offenders.push(`${file}：stats.skipped = ${stats.skipped}，但逐条只找到 ${walked} 条`)
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
console.log(`✓ e2e 运行期跳过棘轮通过：${files.length} 份报告、真跑 ${ran} 条，跳过 / 预期失败 ${count} 条`)
