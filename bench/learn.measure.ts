/**
 * 学习内容的判题 / 求解耗时。
 *
 * 为什么单独量：`PracticeBoard` 的第三级提示与落子判定都是**同步**跑在渲染 /
 * 事件路径上的（`solveMove` / `judgeMove`）。它们耗时多少、最坏落在哪道题，
 * 决定了「要不要挪进 Worker」这个决定。这里只量纯函数，不混入 DOM 与渲染——
 * 真实浏览器里的点击 → DOM 耗时另见 `yarn bench:blocking`（`bench/blocking.probe.mjs`）。
 *
 *   yarn bench:learn
 *
 * 结果同时写到 `bench/learn-last-run.json`（gitignore 的暂存产物，与引擎基准
 * 同一条规矩：写进文档的数字必须能从这里复跑出来）。
 */
import { writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { pointFromIdx } from '../src/core/board'
import type { Board, Point } from '../src/core/types'
import { solveMove } from '../src/learn/hints'
import { LESSONS } from '../src/learn/lessons'
import { PUZZLES } from '../src/learn/puzzles'
import type { Practice } from '../src/learn/types'
import { judgeMove } from '../src/learn/verify'
import { parseBoardLines } from '../src/lib/board-lines'

/** 每个用例重复几次（正式采样前另有 1 次预热）；最小值对抢占稳健，7 次足够。 */
const RUNS = 7
/** 与生产一致：求解/判定都注入真实时钟（它们自带 2–3 s 的预算上限）。 */
const now = Date.now

interface Case {
  readonly group: 'lesson' | 'puzzle'
  readonly id: string
  readonly practice: Practice
}

const CASES: readonly Case[] = [
  ...LESSONS.map((lesson) => ({ group: 'lesson' as const, id: lesson.id, practice: lesson.practice })),
  ...PUZZLES.map((puzzle) => ({ group: 'puzzle' as const, id: puzzle.id, practice: puzzle })),
]

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * 同一次运行同时记录 wall 与进程 CPU 时间（毫秒）。
 *
 * 为什么正文用**最小 CPU 时间**：这台机器的负载不由 benchmark 控制——实测在
 * 并行任务多时，同一段纯计算的 wall 时间能从 5 ms 漂到 100 ms 以上（load average 45），
 * 中位数完全不可复现。CPU 时间不受操作系统抢占影响；取多次运行的**最小值**又能
 * 把 JIT 分层编译、GC 这些一次性的后台开销留在早期样本里。
 * `AGENTS.md` 要求写进文档的数字能重跑出来，这个指标满足。
 *
 * 注意它是**进程** CPU，包含 V8 后台线程，因此是「这段代码相关工作的上界」，
 * 不是主线程独占的精确值。wall 也记录：那才是用户可能遇到的延迟；空载时两者接近。
 */
const measure = (run: () => void): { wall: number; cpu: number } => {
  const wallBefore = performance.now()
  const cpuBefore = process.cpuUsage()
  run()
  const cpuAfter = process.cpuUsage()
  const wallAfter = performance.now()
  return {
    wall: wallAfter - wallBefore,
    cpu: (cpuAfter.user - cpuBefore.user + cpuAfter.system - cpuBefore.system) / 1000,
  }
}

/** 盘面上第一个空点：用来量「走一个无关点」的判题路径。 */
function firstEmpty(board: Board): Point {
  const index = board.findIndex((cell) => cell === 0)
  return pointFromIdx(index)
}

test('学习内容：判题 / 求解耗时', () => {
  const rows: Array<{
    group: string
    id: string
    solveCpuMinMs: number
    solveCpuMedianMs: number
    solveWallMinMs: number
    judgeSolvedCpuMinMs: number | null
    judgeSolvedCpuMedianMs: number | null
    judgeSolvedWallMinMs: number | null
    judgeWrongCpuMinMs: number
    judgeWrongCpuMedianMs: number
    judgeWrongWallMinMs: number
    solved: boolean
  }> = []

  for (const entry of CASES) {
    const board = parseBoardLines(entry.practice.board.lines)

    // 先解一次：既拿到正确解，也顺带把 JIT 预热掉（预热样本不计入统计）。
    const solved = solveMove(board, entry.practice.player, entry.practice.goal, now)
    const wrong = firstEmpty(board)
    if (solved !== null) {
      judgeMove(board, entry.practice.player, solved, entry.practice.goal, now)
    }
    judgeMove(board, entry.practice.player, wrong, entry.practice.goal, now)

    const solveSamples = Array.from({ length: RUNS }, () =>
      measure(() => {
        solveMove(board, entry.practice.player, entry.practice.goal, now)
      }),
    )
    const judgeSolvedSamples =
      solved === null
        ? []
        : Array.from({ length: RUNS }, () =>
            measure(() => {
              judgeMove(board, entry.practice.player, solved, entry.practice.goal, now)
            }),
          )
    const judgeWrongSamples = Array.from({ length: RUNS }, () =>
      measure(() => {
        judgeMove(board, entry.practice.player, wrong, entry.practice.goal, now)
      }),
    )

    const round = (n: number): number => Number(n.toFixed(2))
    const min = (samples: readonly { cpu: number }[]): number =>
      round(Math.min(...samples.map((s) => s.cpu)))
    const med = (samples: readonly { cpu: number }[]): number =>
      round(median(samples.map((s) => s.cpu)))
    const wallMin = (samples: readonly { wall: number }[]): number =>
      round(Math.min(...samples.map((s) => s.wall)))

    rows.push({
      group: entry.group,
      id: entry.id,
      solveCpuMinMs: min(solveSamples),
      solveCpuMedianMs: med(solveSamples),
      solveWallMinMs: wallMin(solveSamples),
      judgeSolvedCpuMinMs: judgeSolvedSamples.length === 0 ? null : min(judgeSolvedSamples),
      judgeSolvedCpuMedianMs:
        judgeSolvedSamples.length === 0 ? null : med(judgeSolvedSamples),
      judgeSolvedWallMinMs:
        judgeSolvedSamples.length === 0 ? null : wallMin(judgeSolvedSamples),
      judgeWrongCpuMinMs: min(judgeWrongSamples),
      judgeWrongCpuMedianMs: med(judgeWrongSamples),
      judgeWrongWallMinMs: wallMin(judgeWrongSamples),
      solved: solved !== null,
    })
  }

  rows.sort((a, b) => b.solveCpuMinMs - a.solveCpuMinMs)

  console.log(
    `\n=== 学习内容：判题 / 求解（CPU 最小/中位 + wall 最小，RUNS=${RUNS}，已预热）===`,
  )
  console.log('组\tid\t求解 CPU min/med\t求解 wall min\t判题·正确解 CPU min/med\t判题·无关点 CPU min/med')
  for (const row of rows) {
    console.log(
      `${row.group}\t${row.id}\t${row.solveCpuMinMs.toFixed(2)} / ${row.solveCpuMedianMs.toFixed(2)}\t` +
        `${row.solveWallMinMs.toFixed(2)}\t` +
        `${row.judgeSolvedCpuMinMs === null ? '—' : `${row.judgeSolvedCpuMinMs.toFixed(2)} / ${row.judgeSolvedCpuMedianMs!.toFixed(2)}`}\t` +
        `${row.judgeWrongCpuMinMs.toFixed(2)} / ${row.judgeWrongCpuMedianMs.toFixed(2)}`,
    )
  }

  const worst = rows[0]!
  const worstJudge = [...rows].sort(
    (a, b) => (b.judgeSolvedCpuMinMs ?? 0) - (a.judgeSolvedCpuMinMs ?? 0),
  )[0]!
  console.log(
    `\n最慢求解（CPU 最小值）：${worst.group}|${worst.id} ${worst.solveCpuMinMs.toFixed(2)} ms；` +
      `最慢判题（CPU 最小值）：${worstJudge.group}|${worstJudge.id} ` +
      `${worstJudge.judgeSolvedCpuMinMs === null ? '—' : worstJudge.judgeSolvedCpuMinMs.toFixed(2)} ms`,
  )

  writeFileSync(
    'bench/learn-last-run.json',
    `${JSON.stringify({ runs: RUNS, rows }, null, 2)}\n`,
  )
  console.log('结果已写入 bench/learn-last-run.json')
})
