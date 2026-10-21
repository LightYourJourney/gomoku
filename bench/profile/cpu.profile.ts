import { writeFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { test } from 'vitest'
import { DIFFICULTY_PARAMS } from '../../src/ai/difficulty'
import { startAiCounters, stopAiCounters } from '../../src/ai/metrics'
import { searchBoard, searchOptionsFor, type SearchOptions } from '../../src/ai/search'
import { findForcedWin } from '../../src/ai/threat'
import { aggregate, ms, pct, shareOf, startProfiling, stopProfiling } from './inspector'
import { candidateCount, searchWorkloads, vcfWorkloads, type Workload } from './workloads'

/**
 * 搜索热点的 CPU 剖析（`yarn profile`）。
 *
 * **固定深度 + 固定时钟**跑，所以节点数与采样分布可复现；唯一噪声来自机器负载
 * （报告里记录负载均值）。真实预算下的表现另见 `real-budget.profile.ts`。
 *
 * 三张表回答三个不同的问题：
 * 1. 任务表：哪些局面真的进了搜索、花了多少节点；
 * 2. 自身耗时表：CPU 时间落在哪些函数上（占比）；
 * 3. 调用次数表：这些函数到底被调用了多少次（由 `ai/metrics.ts` 计数）。
 *
 * 「单次耗时 × 调用次数」不能直接当占比用：`evaluateBoard` 单次很贵，但每个节点
 * 只调用 0.69 次；`analyzeFast` 单次便宜，却要被乘上「候选数 × 2 × 内部节点数」。
 */

const SAMPLE_INTERVAL_US = 100
const FIXED_BUDGET_MS = 1_000_000_000

type TaskKind = 'search' | 'threat'

interface Task {
  readonly id: string
  readonly category: string
  readonly kind: TaskKind
  readonly workload: Workload
  readonly depth?: number
}

function optionsFor(depth: number): SearchOptions {
  return {
    ...searchOptionsFor(DIFFICULTY_PARAMS.hard, { budgetMs: FIXED_BUDGET_MS }),
    maxDepth: depth,
  }
}

const REPRESENTATIVE = new Set(['bench-midgame', 'quiet-midgame', 'bench-double-three'])
const SEARCH_DEPTHS = [4, 5]

const TASKS: readonly Task[] = [
  ...searchWorkloads()
    .filter((w) => w.category !== 'VCF 有杀' && w.category !== 'VCF 无杀')
    .flatMap((workload) =>
      SEARCH_DEPTHS.filter((depth) => depth === 4 || REPRESENTATIVE.has(workload.id)).map((depth) => ({
        id: workload.id,
        category: workload.category,
        kind: 'search' as const,
        workload,
        depth,
      })),
    ),
  ...vcfWorkloads().map((workload) => ({
    id: workload.id,
    category: workload.category,
    kind: 'threat' as const,
    workload,
  })),
]

interface TaskResult {
  readonly id: string
  readonly category: string
  readonly kind: TaskKind
  readonly depth: number | null
  readonly candidates: number
  readonly nodes: number
  readonly depthReached: number
  readonly reason: string
  readonly elapsedMs: number
  readonly synthetic: boolean
}

function runTask(task: Task): TaskResult {
  const { workload } = task
  const startedAt = performance.now()

  if (task.kind === 'search') {
    const depth = task.depth ?? 4
    const outcome = searchBoard(workload.board, workload.player, optionsFor(depth), () => 0)
    return {
      id: task.id,
      category: task.category,
      kind: task.kind,
      depth,
      candidates: candidateCount(workload),
      nodes: outcome.nodes,
      depthReached: outcome.depth,
      reason: outcome.reason,
      elapsedMs: performance.now() - startedAt,
      synthetic: workload.synthetic,
    }
  }

  const result = findForcedWin(workload.board, workload.player, {
    maxPlies: DIFFICULTY_PARAMS.expert.threatPlies,
    allowThrees: false,
    deadline: Number.POSITIVE_INFINITY,
    now: () => 0,
  })
  return {
    id: task.id,
    category: task.category,
    kind: task.kind,
    depth: null,
    candidates: candidateCount(workload),
    nodes: result.nodes,
    depthReached: 0,
    reason: result.move === null ? 'no-win' : `win(${result.plies})`,
    elapsedMs: performance.now() - startedAt,
    synthetic: workload.synthetic,
  }
}

test('搜索热点 CPU 剖析', async () => {
  // 预热：把 JIT 编译与首次分配排除在采样之外
  for (const task of TASKS.slice(0, 4)) runTask(task)

  /*
   * **两遍跑**，而不是「开着计数器采样」：
   * 计数通道单独跑一遍拿精确调用次数；剖析通道把计数器关掉再采样，
   * 测到的才是发布路径（计数器默认关闭时的样子）。
   * 开着计数器采样会让 `countCall` 出现在样本里，把「测量工具的开销」
   * 混进「被测代码的占比」——任务书明确不许这么做。
   */
  const counter = startAiCounters()
  for (const task of TASKS) runTask(task)
  stopAiCounters()

  const session = await startProfiling(SAMPLE_INTERVAL_US)
  const results: TaskResult[] = []
  for (const task of TASKS) results.push(runTask(task))
  const profile = await stopProfiling(session)

  const totals = aggregate(profile)
  const searchNodes = results.filter((r) => r.kind === 'search' && r.reason === 'search').reduce((s, r) => s + r.nodes, 0)
  const timeoutNodes = results.filter((r) => r.reason === 'timeout').reduce((s, r) => s + r.nodes, 0)
  const total = searchNodes + timeoutNodes
  const evalCalls = counter.evaluateBoard

  const derived = {
    searchNodes,
    timeoutNodes,
    evaluateCalls: evalCalls,
    evaluationsPerNode: total === 0 ? 0 : evalCalls / total,
    candidatesPerOrdering: counter.orderMoves === 0 ? 0 : counter.orderCandidates / counter.orderMoves,
    analyzeFastPerCandidate: counter.orderCandidates === 0 ? 0 : counter.analyzeFast / counter.orderCandidates,
    evaluateShare: shareOf(totals, 'evaluateBoard'),
    gcShare: totals.totalUs === 0 ? 0 : totals.gcUs / totals.totalUs,
    anonymousShare: totals.totalUs === 0 ? 0 : totals.anonymousUs / totals.totalUs,
    countedInSeparatePass: true,
  }

  const payload = {
    sampleIntervalUs: SAMPLE_INTERVAL_US,
    sampledAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpuCount: cpus().length,
    loadAverage: loadavg()[0] ?? null,
    tasks: results,
    totals,
    calls: counter,
    derived,
  }

  writeFileSync(new URL('./last-cpu-profile.json', import.meta.url), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(new URL('./last-cpu-profile.cpuprofile', import.meta.url), `${JSON.stringify(profile)}\n`)

  console.log(`\n=== 任务（固定深度、固定时钟）===`)
  console.log('局面\t类别\t深度\t候选\t节点\t实际深度\t判断\t耗时(ms)')
  for (const row of results) {
    console.log(
      `${row.id}\t${row.category}\t${row.depth ?? '-'}\t${row.candidates}\t${row.nodes}\t${row.depthReached}\t${row.reason}\t${row.elapsedMs.toFixed(1)}`,
    )
  }

  console.log(`\n=== 自身耗时 Top 20（采样间隔 ${SAMPLE_INTERVAL_US} µs）===`)
  console.log('函数\t文件\t自身耗时\t占比\t采样数')
  for (const row of totals.functions.slice(0, 20)) {
    console.log(`${row.name}\t${row.url}\t${ms(row.selfUs)}\t${pct(row.share)}\t${row.hits}`)
  }

  console.log(`\n=== 调用次数（一次剖析会话合计）===`)
  for (const [name, value] of Object.entries(counter)) console.log(`${name}\t${value}`)
  console.log(
    `\n搜索节点合计 ${searchNodes}（超时行 ${timeoutNodes}），evaluateBoard 调用 ${evalCalls} 次` +
      `（每个节点约 ${derived.evaluationsPerNode.toFixed(2)} 次）；` +
      `orderMoves ${counter.orderMoves} 次，平均每次打分 ${derived.candidatesPerOrdering.toFixed(1)} 个候选`,
  )
  console.log(
    `GC ${ms(totals.gcUs)}（${pct(derived.gcShare)}）｜匿名内联帧 ${pct(derived.anonymousShare)}｜` +
      `idle ${ms(totals.idleUs)}｜program ${ms(totals.programUs)}｜采样总时长 ${ms(totals.totalUs)}`,
  )
  console.log(`结果已写入 bench/profile/last-cpu-profile.json`)
}, 900_000)
