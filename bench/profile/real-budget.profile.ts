import { writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { test } from 'vitest'
import { DIFFICULTY_PARAMS } from '../../src/ai/difficulty'
import { startAiCounters, stopAiCounters } from '../../src/ai/metrics'
import { searchBoard, searchOptionsFor, type SearchOptions } from '../../src/ai/search'
import { aggregate, ms, pct, shareOf, startProfiling, stopProfiling } from './inspector'
import { candidateCount, WORKLOADS } from './workloads'

/**
 * **真实预算**下的热点剖析（`yarn profile`）。
 *
 * 与 `cpu.profile.ts` 的固定深度剖析**不能混为一谈**：
 * - 固定深度：节点数确定、可复现，用来看「算法的哪一部分在花时间」；
 * - 真实预算：按墙钟停手，节点数随机器负载变化，用来看「用户实际等待的那 1.6 秒
 *   花在哪里」，以及迭代加深在超时前能走多深。
 *
 * 同样是**两遍跑**：计数一遍、剖析一遍（计数器关闭）。真实预算下两遍的节点数
 * 不会相同（墙钟停手），所以计数只用来算「每次评估对应多少节点」的**比例**，
 * 不拿来对某一次具体运行的节点数下结论。
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

function runSearches(options: SearchOptions): RealTask[] {
  const tasks: RealTask[] = []

  for (const id of BOARDS) {
    const workload = WORKLOADS.find((w) => w.id === id)!
    const startedAt = performance.now()
    const outcome = searchBoard(workload.board, workload.player, options, Date.now)
    tasks.push({
      id,
      category: workload.category,
      nodes: outcome.nodes,
      depth: outcome.depth,
      reason: outcome.reason,
      elapsedMs: performance.now() - startedAt,
      candidates: candidateCount(workload),
    })
  }

  return tasks
}

test('真实预算热点剖析', async () => {
  const options = searchOptionsFor(DIFFICULTY_PARAMS.hard, { budgetMs: BUDGET_MS })

  // 预热：短预算跑一次，把 JIT 与首次分配排除掉
  searchBoard(WORKLOADS[0]!.board, WORKLOADS[0]!.player, { ...options, budgetMs: 100 }, Date.now)

  const counter = startAiCounters()
  const counted = runSearches(options)
  stopAiCounters()

  const session = await startProfiling()
  const tasks = runSearches(options)
  const profile = await stopProfiling(session)

  const totals = aggregate(profile)
  const countedNodes = counted.reduce((sum, task) => sum + task.nodes, 0)
  const profiledNodes = tasks.reduce((sum, task) => sum + task.nodes, 0)

  const derived = {
    evaluationsPerNode: countedNodes === 0 ? 0 : counter.evaluateBoard / countedNodes,
    evaluateShare: shareOf(totals, 'evaluateBoard'),
    gcShare: totals.totalUs === 0 ? 0 : totals.gcUs / totals.totalUs,
    anonymousShare: totals.totalUs === 0 ? 0 : totals.anonymousUs / totals.totalUs,
    countedNodes,
    profiledNodes,
    timeouts: tasks.filter((t) => t.reason === 'timeout').length,
    countedInSeparatePass: true,
  }

  const payload = {
    sampledAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    budgetMs: BUDGET_MS,
    difficulty: 'hard',
    loadAverage: loadavg()[0] ?? null,
    tasks,
    counting: { tasks: counted, calls: counter },
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
    `\nevaluateBoard ${counter.evaluateBoard} 次（计数通道 ${countedNodes} 节点，每节点 ` +
      `${derived.evaluationsPerNode.toFixed(2)} 次），自身耗时占比 ${pct(derived.evaluateShare)}；` +
      `GC ${pct(derived.gcShare)}；匿名内联帧 ${pct(derived.anonymousShare)}；` +
      `剖析通道 ${profiledNodes} 节点 / 采样 ${ms(totals.totalUs)}`,
  )
  console.log(`结果已写入 bench/profile/last-real-budget.json`)
}, 900_000)
