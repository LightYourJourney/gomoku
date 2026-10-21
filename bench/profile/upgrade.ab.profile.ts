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
 * 只比「固定深度」：节点数由 `search.equivalence.test.ts` 钉住，所以耗时比就是
 * **单节点计算速度**的比，不掺搜索策略。
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

function specFor(id: string): EngineSpec {
  return { id, label: id, difficulty: 'hard', clock: 'fixed', maxDepth: DEPTH }
}

interface Row {
  readonly id: string
  readonly category: string
  readonly candidates: number
  readonly oldMs: number
  readonly newMs: number
  readonly ratio: number
  readonly sameMove: boolean
  /** 逐字段留档：耗时比只有配上「两边算的是同一棵树」才可解释。 */
  readonly oldNodes: number | null
  readonly newNodes: number | null
  readonly oldTtHits: number | null
  readonly newTtHits: number | null
  readonly oldDepth: number | null
  readonly newDepth: number | null
}

test('引擎升级 A/B：固定深度', async () => {
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

  const base = await loadEngine({ ...specFor('base'), module: BASE_MODULE })
  const next = await loadEngine({ ...specFor('next'), module: NEW_MODULE })
  const rows: Row[] = []

  for (const workload of searchWorkloads()) {
    const oldTimes: number[] = []
    const newTimes: number[] = []
    // 用对象持有：TS 的控制流分析看不到闭包里的赋值，会把它窄化成 null
    const seen: { old: EngineMove | null; next: EngineMove | null } = { old: null, next: null }

    for (let round = 0; round < ROUNDS; round++) {
      const runOld = (): void => {
        const startedAt = performance.now()
        const result = base.engine.choose(workload.board.slice(), workload.player)
        oldTimes.push(performance.now() - startedAt)
        if (round === 0) seen.old = result
      }
      const runNew = (): void => {
        const startedAt = performance.now()
        const result = next.engine.choose(workload.board.slice(), workload.player)
        newTimes.push(performance.now() - startedAt)
        if (round === 0) seen.next = result
      }

      // 交替顺序，避免「谁先跑谁占缓存」的系统性偏差
      if (round % 2 === 0) {
        runOld()
        runNew()
      } else {
        runNew()
        runOld()
      }
    }

    const sameMove =
      JSON.stringify(seen.old?.move ?? null) === JSON.stringify(seen.next?.move ?? null) &&
      seen.old?.nodes === seen.next?.nodes &&
      seen.old?.depth === seen.next?.depth &&
      seen.old?.ttHits === seen.next?.ttHits &&
      seen.old?.reason === seen.next?.reason

    const oldMs = Math.min(...oldTimes)
    const newMs = Math.min(...newTimes)
    rows.push({
      id: workload.id,
      category: workload.category,
      candidates: candidateCount(workload),
      oldMs,
      newMs,
      ratio: newMs === 0 ? Number.POSITIVE_INFINITY : oldMs / newMs,
      sameMove,
      oldNodes: seen.old?.nodes ?? null,
      newNodes: seen.next?.nodes ?? null,
      oldTtHits: seen.old?.ttHits ?? null,
      newTtHits: seen.next?.ttHits ?? null,
      oldDepth: seen.old?.depth ?? null,
      newDepth: seen.next?.depth ?? null,
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
  console.log(`结果已写入 bench/profile/last-upgrade-ab.json`)
}, 900_000)
