#!/usr/bin/env node
/*
 * 测试条数棘轮：用例只许涨，不许跌。
 *
 * 为什么要有它：整套门禁里没有任何一处读测试条数——删掉一个 e2e 文件、给用例加个
 * `.skip`（`forbidOnly` 只拦 `.only`，拦不住 `.skip`），全绿。而那正是「安全网悄悄变小」。
 *
 * 四条判据：
 *   numTotalTests  ≥ 基线   删用例/删文件
 *   numPendingTests ≤ 基线  加 .skip
 *   numTodoTests    ≤ 基线  加 .todo
 *   e2e 总数        ≥ 基线  删 e2e 用例/文件
 *
 * 用法：`yarn check:tests`。前提是刚跑过 `yarn test`（它落盘 vitest-report.json）。
 */

import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

let baseline
try {
  baseline = JSON.parse(await readFile(resolve(HERE, 'tests.baseline.json'), 'utf8'))
} catch (err) {
  console.error(`✗ 读不到基线 quality/tests.baseline.json：${err.message}`)
  process.exit(2)
}

// ── 单测条数（读 yarn test 落盘的报告）─────────────────────────────
let report
try {
  report = JSON.parse(await readFile(resolve(REPO, 'vitest-report.json'), 'utf8'))
} catch (err) {
  // 读不到就响亮失败。静默跳过＝一条永远不红的判据。
  console.error(`✗ 读不到 vitest-report.json：${err.message}`)
  console.error('  先跑 `yarn test` —— 这份报告是它的产物（钩子里就在它后面，CI 里同理）。')
  process.exit(2)
}

// ── e2e 条数（问 playwright 要，不去数字符）────────────────────────
let e2eTotal = null
try {
  const out = execFileSync('yarn', ['playwright', 'test', '--list'], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const m = out.match(/Total:\s*(\d+)\s+tests?/)
  if (m) e2eTotal = Number(m[1])
} catch {
  // 下面的 `e2eTotal === null` 分支会响亮失败
}

const checks = [
  ['单测总数', report.numTotalTests, baseline.unitTotal, 'below'],
  ['单测被跳过的（.skip）', report.numPendingTests, baseline.unitPending, 'above'],
  ['单测待办的（.todo）', report.numTodoTests, baseline.unitTodo, 'above'],
  ['e2e 总数', e2eTotal, baseline.e2eTotal, 'below'],
]

const failures = []
for (const [name, actual, expected, dir] of checks) {
  if (actual === null || actual === undefined) {
    failures.push(`${name}：拿不到数值（playwright 没跑起来？）`)
    continue
  }
  const bad = dir === 'below' ? actual < expected : actual > expected
  if (bad) failures.push(`${name}：基线 ${expected} → 本次 ${actual}`)
}

if (failures.length > 0) {
  console.error(`✗ 测试条数棘轮：安全网变小了（${failures.length} 项）`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    '\n  这是有意的：删用例与跳用例都是把安全网改小。' +
      '\n  真要减，就显式改 quality/tests.baseline.json，并在提交信息里写明为什么。',
  )
  process.exitCode = 1
} else {
  console.log(
    `✓ 测试条数棘轮通过：单测 ${report.numTotalTests}（跳过 ${report.numPendingTests} / 待办 ${report.numTodoTests}）、e2e ${e2eTotal}`,
  )
}
