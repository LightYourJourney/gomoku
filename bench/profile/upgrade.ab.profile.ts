import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { test } from 'vitest'
import { loadEngine } from '../strength/engines'
import type { EngineMove, EngineSpec } from '../strength/types'
import { candidateCount, searchWorkloads } from './workloads'

/**
 * 引擎升级的 A/B 计时（`yarn profile` 会跑）。
 *
 * **两边都必须走同一条构建管线**：旧版是旧提交打出的模块，新版是当前源码现打出的模块。
 * 这一点是实测逼出来的——把当前源码（经 vitest 的模块转换）和它自己打出的包放在一起比，
 * 同一个引擎、同样的节点数，**包比源码快约 5 倍**。拿「包 vs 源码」当 A/B 会得到
 * 一条与代码改动无关的假结论（详见 PHASE_10C.md 的「测量陷阱」一节）。
 *
 * 两段测量：
 *
 * 1. **固定深度**：节点数由 `search.equivalence.test.ts` 钉住，所以耗时比就是
 *    **单节点计算速度**的比，不掺搜索策略。
 * 2. **真实预算**（hard 1600 ms）：两边在同一进程、同一时段里交替跑，
 *    回答「用户等的那 1.6 秒里发生了什么」。跨会话比毫秒数会把负载差当成加速比。
 *
 * 旧包需要先手工生成一次（产物 gitignore）：
 *
 * ```bash
 * node bench/strength/bundle-engine.mjs --root . --out bench/strength/.engines/base-<commit>.mjs
 * ```
 *
 * 包不存在时打印提示并跳过，不判红——它是对照工具，不是门禁。
 */

const BASE_MODULE = 'bench/strength/.engines/base-6e16ed0.mjs'
const NEW_MODULE = 'bench/strength/.engines/ab-new.mjs'
const DEPTH = 4
/**
 * **必须是偶数**：严格交替时，两边当「每轮先跑的那个」的次数才会相等。
 *
 * 这是实测逼出来的：用同一份源码打出两个包互比（代码逐字节相同），5 轮
 * （奇数，先跑次数 3:2）得到 1.06–1.09x 的系统性偏差；改成 12 轮后控制组
 * 回到 1.00x 附近。原因未逐项拆解（模块布局与每轮先后都可能是来源），
 * 结论只取「奇数轮不可信」。详见 PHASE_10C.md 的「测量陷阱」。
 */
const ROUNDS = 12
/** 真实预算对局面的耗时随负载波动，取 3 轮的最快值；顺序仍然交替。 */
const REAL_BUDGET_ROUNDS = 3
const REAL_BUDGET_IDS = ['opening-adjacent', 'bench-midgame', 'bench-double-three'] as const

function fixedSpec(id: string): EngineSpec {
  return { id, label: id, difficulty: 'hard', clock: 'fixed', maxDepth: DEPTH }
}

function realSpec(id: string): EngineSpec {
  return { id, label: id, difficulty: 'hard', clock: 'real' }
}

interface TimedMove {
  readonly ms: number
  readonly result: EngineMove
}

interface PairedTiming {
  readonly old: TimedMove[]
  readonly new: TimedMove[]
}

/**
 * 两边交替跑、各自记录每次耗时。顺序按轮次交替，避免「谁先跑谁占缓存」。
 *
 * **轮数必须成对地用**：奇数轮时先跑的一方多一次，见 `ROUNDS` 的注释。
 */
function timePaired(
  oldRun: () => EngineMove,
  newRun: () => EngineMove,
  rounds: number,
): PairedTiming {
  const oldRuns: TimedMove[] = []
  const newRuns: TimedMove[] = []

  const time = (run: () => EngineMove, into: TimedMove[]): void => {
    const startedAt = performance.now()
    const result = run()
    into.push({ ms: performance.now() - startedAt, result })
  }

  for (let round = 0; round < rounds; round++) {
    if (round % 2 === 0) {
      time(oldRun, oldRuns)
      time(newRun, newRuns)
    } else {
      time(newRun, newRuns)
      time(oldRun, oldRuns)
    }
  }

  return { old: oldRuns, new: newRuns }
}

function fastest(runs: readonly TimedMove[]): TimedMove {
  return runs.reduce((best, run) => (run.ms < best.ms ? run : best))
}

function sameSearch(left: EngineMove, right: EngineMove): boolean {
  return (
    JSON.stringify(left.move) === JSON.stringify(right.move) &&
    left.nodes === right.nodes &&
    left.depth === right.depth &&
    left.ttHits === right.ttHits &&
    left.reason === right.reason
  )
}

interface FixedRow {
  readonly id: string
  readonly category: string
  readonly candidates: number
  readonly oldMs: number
  readonly newMs: number
  readonly ratio: number
  readonly sameMove: boolean
  /** 逐字段留档：耗时比只有配上「两边算的是同一棵树」才可解释。 */
  readonly oldNodes: number
  readonly newNodes: number
  readonly oldTtHits: number
  readonly newTtHits: number
  readonly oldDepth: number
  readonly newDepth: number
}

interface BudgetRow {
  readonly id: string
  readonly candidates: number
  readonly oldMs: number
  readonly newMs: number
  readonly oldNodes: number
  readonly newNodes: number
  readonly oldDepth: number
  readonly newDepth: number
  readonly oldReason: string
  readonly newReason: string
}

test('引擎升级 A/B：固定深度与真实预算', async () => {
  if (!existsSync(BASE_MODULE)) {
    console.log(
      `\n[跳过] 找不到旧引擎包 ${BASE_MODULE}\n` +
        `      先生成：node bench/strength/bundle-engine.mjs --root . --out ${BASE_MODULE}\n`,
    )
    return
  }

  // 当前源码现打一份，和旧包走同一条 esbuild/Vite 管线
  execFileSync('node', ['bench/strength/bundle-engine.mjs', '--root', '.', '--out', NEW_MODULE], {
    stdio: 'pipe',
  })

  const base = await loadEngine({ ...fixedSpec('base'), module: BASE_MODULE })
  const next = await loadEngine({ ...fixedSpec('next'), module: NEW_MODULE })
  const rows: FixedRow[] = []

  for (const workload of searchWorkloads()) {
    const timing = timePaired(
      () => base.engine.choose(workload.board.slice(), workload.player),
      () => next.engine.choose(workload.board.slice(), workload.player),
      ROUNDS,
    )
    const old = fastest(timing.old)
    const now = fastest(timing.new)

    rows.push({
      id: workload.id,
      category: workload.category,
      candidates: candidateCount(workload),
      oldMs: old.ms,
      newMs: now.ms,
      ratio: now.ms === 0 ? Number.POSITIVE_INFINITY : old.ms / now.ms,
      sameMove: sameSearch(old.result, now.result),
      oldNodes: old.result.nodes,
      newNodes: now.result.nodes,
      oldTtHits: old.result.ttHits,
      newTtHits: now.result.ttHits,
      oldDepth: old.result.depth,
      newDepth: now.result.depth,
    })
  }

  const baseReal = await loadEngine({ ...realSpec('base-real'), module: BASE_MODULE })
  const nextReal = await loadEngine({ ...realSpec('next-real'), module: NEW_MODULE })
  const budgetRows: BudgetRow[] = []
  const byId = new Map(searchWorkloads().map((workload) => [workload.id, workload]))

  for (const id of REAL_BUDGET_IDS) {
    const workload = byId.get(id)
    if (workload === undefined) throw new Error(`未知局面：${id}`)

    const timing = timePaired(
      () => baseReal.engine.choose(workload.board.slice(), workload.player),
      () => nextReal.engine.choose(workload.board.slice(), workload.player),
      REAL_BUDGET_ROUNDS,
    )
    const old = fastest(timing.old)
    const now = fastest(timing.new)

    budgetRows.push({
      id,
      candidates: candidateCount(workload),
      oldMs: old.ms,
      newMs: now.ms,
      oldNodes: old.result.nodes,
      newNodes: now.result.nodes,
      oldDepth: old.result.depth,
      newDepth: now.result.depth,
      oldReason: old.result.reason,
      newReason: now.result.reason,
    })
  }

  const totals = rows.reduce(
    (acc, row) => ({ old: acc.old + row.oldMs, next: acc.next + row.newMs }),
    { old: 0, next: 0 },
  )
  const mismatches = rows.filter((row) => !row.sameMove).length

  const payload = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    loadAverage: loadavg()[0] ?? null,
    baseModule: BASE_MODULE,
    depth: DEPTH,
    rounds: ROUNDS,
    rows,
    totals: {
      ...totals,
      ratio: totals.next === 0 ? Number.POSITIVE_INFINITY : totals.old / totals.next,
      mismatches,
    },
    realBudget: {
      difficulty: 'hard',
      rounds: REAL_BUDGET_ROUNDS,
      rows: budgetRows,
    },
  }

  writeFileSync(new URL('./last-upgrade-ab.json', import.meta.url), `${JSON.stringify(payload, null, 2)}\n`)

  console.log(`\n=== 旧版 vs 新版（固定深度 ${DEPTH}，${ROUNDS} 轮取 min）===`)
  console.log('局面\t类别\t候选\t旧版(ms)\t新版(ms)\t加速比\t着法一致')
  for (const row of rows) {
    console.log(
      `${row.id}\t${row.category}\t${row.candidates}\t${row.oldMs.toFixed(1)}\t${row.newMs.toFixed(1)}\t` +
        `${row.ratio.toFixed(2)}x\t${row.sameMove ? '是' : '否'}`,
    )
  }
  console.log(
    `合计\t旧版 ${totals.old.toFixed(1)} ms\t新版 ${totals.next.toFixed(1)} ms\t` +
      `${(totals.old / totals.next).toFixed(2)}x\t不一致 ${mismatches} 个局面`,
  )

  console.log(`\n=== 真实预算（hard 1600 ms，${REAL_BUDGET_ROUNDS} 轮取最快，同一会话）===`)
  console.log('局面\t候选\t旧版(ms)\t新版(ms)\t旧深度\t新深度\t旧节点\t新节点\t判断')
  for (const row of budgetRows) {
    // 两边都是 timeout 时，耗时必然都贴近预算，只能读节点数（吞吐）。
    const note = row.oldReason === 'timeout' && row.newReason === 'timeout' ? '双超时，读节点' : '同层完成'
    console.log(
      `${row.id}\t${row.candidates}\t${row.oldMs.toFixed(0)}\t${row.newMs.toFixed(0)}\t` +
        `${row.oldDepth}\t${row.newDepth}\t${row.oldNodes}\t${row.newNodes}\t${note}`,
    )
  }

  console.log(`结果已写入 bench/profile/last-upgrade-ab.json`)
}, 900_000)
