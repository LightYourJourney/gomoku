#!/usr/bin/env node
/*
 * 覆盖棘轮：探针扫到的状态与控件**只许涨，不许跌**。
 *
 * 为什么要有它：`bench/ui.probe.mjs` 的 `checkCriteria(rows)` 只吃**本次扫到的行**，
 * 板子量不到时直接跳过判据；全仓唯一读既有 `measurements.json` 的地方是「拒绝覆盖基线」
 * 的守卫，**不是比对**。所以从 `STATES` 里删掉一个状态、或某颗控件从 DOM 里消失
 * （Phase 02 那次「显示与声音」折叠后三颗控件从所有扫描里消失，就是这种形态），
 * 探针只是**少几行量测**——不报错、不红。
 *
 * 这道棘轮把那种退化变成会红的：本次覆盖必须是入库基线的**超集**。
 * 新增状态/按钮**不用**改基线（那只说明覆盖变多了）；少一条才红。
 *
 * 用法：
 *   node quality/coverage.ratchet.mjs --baseline <f> --current <f>
 *   yarn check:coverage          # 用两个默认路径
 */

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

const DEFAULTS = {
  baseline: resolve(HERE, 'coverage.baseline.json'),
  current: resolve(REPO, 'docs/ui-redesign/screenshots/after-phase02/measurements.json'),
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`✗ ${name} 后面要跟一个路径，实际给的是：${v ?? '（没有）'}`)
    process.exit(2)
  }
  return resolve(v)
}

/**
 * 基线形状校验。**没有它，基线丢一个 `buttons` 字段就等于把这道闸门整个关掉**：
 * `?? []` 会让每条控件判据都跑 0 次，然后印 ✓ 退出 0——正是它自己要防的那种形态。
 */
function assertBaselineShape(baseline) {
  const bad = []
  if (!Array.isArray(baseline.rows) || baseline.rows.length === 0) bad.push('rows 不是非空数组')
  for (const [i, r] of (baseline.rows ?? []).entries()) {
    const where = `rows[${i}]（${r?.state ?? '?'}|${r?.size ?? '?'}|${r?.theme ?? '?'}）`
    if (!Array.isArray(r?.buttons)) bad.push(`${where}：buttons 不是数组`)
    if (!Array.isArray(r?.headings)) bad.push(`${where}：headings 不是数组`)
    if (typeof r?.hasBoard !== 'boolean') bad.push(`${where}：hasBoard 不是布尔`)
  }
  if (bad.length > 0) {
    console.error(`✗ 基线形状不对（quality/coverage.baseline.json）——${bad.length} 处：`)
    for (const b of bad.slice(0, 10)) console.error(`  - ${b}`)
    if (bad.length > 10) console.error(`  ……还有 ${bad.length - 10} 处`)
    console.error('  基线坏了就判不出东西，所以这里直接停：修好基线再跑。')
    process.exit(2)
  }
}

async function readJson(path, what) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    // 读不到就**响亮地失败**，绝不静默跳过——静默跳过就是一条永远不红的判据。
    console.error(`✗ 读不到${what}：${path}`)
    console.error(`  ${err.message}`)
    process.exit(2)
  }
}

const baseline = await readJson(argValue('--baseline') ?? DEFAULTS.baseline, '基线')
const measured = await readJson(argValue('--current') ?? DEFAULTS.current, '量测产物')

const key = (r) => `${r.state}|${r.size}|${r.theme}`
assertBaselineShape(baseline)

const baseRows = new Map(baseline.rows.map((r) => [key(r), r]))
const curRows = new Map((measured.measurements ?? []).map((r) => [key(r), r]))

const failures = []
/** 实际比对过的控件/标题条数。**必须报出来**：判据跑了 0 次与跑了几千次都印 ✓ 的话，读的人看不出差别。 */
let comparisons = 0

for (const [k, b] of baseRows) {
  const c = curRows.get(k)
  if (c === undefined) {
    failures.push(`${k}：基线里扫过这个状态/尺寸，这次**整条不见了**`)
    continue
  }

  const curButtons = new Set(c.buttons ?? [])
  for (const btn of b.buttons) {
    comparisons += 1
    if (!curButtons.has(btn)) {
      failures.push(`${k}：丢了按钮「${btn}」`)
    }
  }

  // 棋盘在不在也要棘轮：判据 2/3（尺寸、占比）在 `board === null` 时是**直接跳过**的，
  // 所以「棋盘量不到了」本身不会红——它只会让判据悄悄少判两条。
  if (b.hasBoard === true && c.board == null) {
    failures.push(`${k}：这一行以前量得到棋盘，这次量不到了（棋盘尺寸与占比判据会被静默跳过）`)
  }

  const curHeadings = new Set(
    (c.headings ?? []).map((h) => (typeof h === 'string' ? h : `${h.level}:${h.text}`)),
  )
  for (const h of b.headings) {
    comparisons += 1
    if (!curHeadings.has(h)) {
      failures.push(`${k}：丢了标题「${h}」`)
    }
  }
}

// 一条都没比对 = 基线坏了（形状校验之外的第二道保险）。
if (comparisons === 0) {
  failures.push(
    '**一条控件/标题都没比对**：基线里所有行的 buttons 与 headings 都是空的。' +
      '这不可能是真实情况——去查 quality/coverage.baseline.json 是不是被改坏了。',
  )
}

const grew = [...curRows.keys()].filter((k) => !baseRows.has(k))

if (failures.length > 0) {
  console.error(`✗ 覆盖棘轮：安全网变小了（${failures.length} 项）`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    '\n  这几条以前是被扫到的。要么是改动误伤（那就修回来），' +
      '\n  要么是有意收窄覆盖——那就显式改 quality/coverage.baseline.json 并在提交信息里说明。',
  )
  process.exitCode = 1
} else {
  const extra = grew.length > 0 ? `，另有 ${grew.length} 条新增覆盖（不报错）` : ''
  console.log(
    `✓ 覆盖棘轮通过：${baseRows.size} 条 / ${new Set(baseline.rows.map((r) => r.state)).size} 个状态，` +
      `实比控件与标题 ${comparisons} 条，覆盖未缩小${extra}`,
  )
}
