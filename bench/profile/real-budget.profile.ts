import { writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { test } from 'vitest'
import { DIFFICULTY_PARAMS } from '../../src/ai/difficulty'
import { startAiCounters, stopAiCounters } from '../../src/ai/metrics'
import { searchBoard, searchOptionsFor } from '../../src/ai/search'
import { aggregate, ms, pct, startProfiling, stopProfiling } from './inspector'
import { candidateCount, WORKLOADS } from './workloads'

/**
 * **真实预算**下的热点剖析（`yarn profile`）。
 *
 * 与 `cpu.profile.ts` 的固定深度剖析**不能混为一谈**：
 * - 固定深度：节点数确定、可复现，用来看「算法的哪一部分在花时间」；
 * - 真实预算：按墙钟停手，节点数随机器负载变化，用来看「用户实际等待的那 1.6 秒
 *   花在哪里」，以及迭代加深在超时前能走多深。
 *
 * 因此这里只跑少量局面，并且每次都记录负载均值。重复运行之间的百分比会比
 * 固定深度那组抖得多——这是测量对象本身的性质，不是脚本不稳。
 */

const BUDGET_MS = 1_600
const BOARDS = ['opening-adjacent', 'bench-midgame', 'bench-double-three'] as const

interface RealTask {
  readonly id: string
  readonly category: string
  readonly nodes: number
  readonly depth: number
  readonly reason: string
  readonly elapsedMs: number
  readonly candidates: number
}

test('真实预算热点剖析', async () => {
  const options = searchOptionsFor(DIFFICULTY_PARAMS.hard, { budgetMs: BUDGET_MS })

  // 预热：跑一次短预算，把 JIT 与首次分配排除掉
  searchBoard(WORKLOADS[0]!.board, WORKLOADS[0]!.player, { ...options, budgetMs: 100 }, Date.now)

  const counter = startAiCounters()
  const session = await startProfiling()

  const tasks: RealTask[] = []
  for (const id of BOARDS) {
    const workload = WORKLOADS.find((w) => w.id === id)!
    const startedAt = performance.now()
    const outcome = searchBoard(workload.board, workload.player, options, Date.now)
    const elapsedMs = performance.now() - startedAt
    tasks.push({
      id,
      category: workload.category,
      nodes: outcome.nodes,
      depth: outcome.depth,
      reason: outcome.reason,
      elapsedMs,
      candidates: candidateCount(workload),
    })
  }

  const profile = await stopProfiling(session)
  stopAiCounters()

  const totals = aggregate(profile)
  const evaluateRow = totals.functions.find((f) => f.name === 'evaluateBoard')
  const derived = {
    evaluationsPerNode: tasks.reduce((s, t) => s + t.nodes, 0) === 0
      ? 0
      : counter.evaluateBoard / tasks.reduce((s, t) => s + t.nodes, 0),
    evaluateShare: evaluateRow?.share ?? 0,
    gcShare: totals.totalUs === 0 ? 0 : totals.gcUs / totals.totalUs,
    anonymousShare: totals.totalUs === 0 ? 0 : totals.anonymousUs / totals.totalUs,
    timeouts: tasks.filter((t) => t.reason === 'timeout').length,
  }

  const payload = {
    sampledAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    budgetMs: BUDGET_MS,
    difficulty: 'hard',
    loadAverage: loadavg()[0] ?? null,
    tasks,
    totals,
    calls: counter,
    derived,
  }

  writeFileSync(new URL('./last-real-budget.json', import.meta.url), `${JSON.stringify(payload, null, 2)}\n`)

  console.log(`\n=== 真实预算（hard，${BUDGET_MS} ms）===`)
  console.log('局面\t类别\t候选\t节点\t完成深度\t判断\t耗时(ms)')
  for (const task of tasks) {
    console.log(
      `${task.id}\t${task.category}\t${task.candidates}\t${task.nodes}\t${task.depth}\t${task.reason}\t${task.elapsedMs.toFixed(0)}`,
    )
  }

  console.log(`\n=== 自身耗时 Top 12 ===`)
  for (const row of totals.functions.slice(0, 12)) {
    console.log(`${row.name}\t${row.url}\t${ms(row.selfUs)}\t${pct(row.share)}`)
  }

  console.log(
    `\nevaluateBoard ${counter.evaluateBoard} 次（每节点 ${derived.evaluationsPerNode.toFixed(2)}），` +
      `自身耗时占比 ${pct(derived.evaluateShare)}；GC ${pct(derived.gcShare)}；` +
      `匿名内联帧 ${pct(derived.anonymousShare)}；采样 ${ms(totals.totalUs)}`,
  )
  console.log(`结果已写入 bench/profile/last-real-budget.json`)
}, 900_000)
