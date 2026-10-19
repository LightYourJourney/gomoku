/**
 * 学习内容的判题 / 求解耗时。
 *
 * 为什么单独量：`PracticeBoard` 的第三级提示与落子判定都是**同步**跑在渲染 /
 * 事件路径上的（`solveMove` / `judgeMove`）。它们耗时多少、最坏落在哪道题，
 * 决定了「要不要挪进 Worker」这个决定。这里只量纯函数，不混入 DOM 与渲染——
 * 真实浏览器里的计时另见 `docs/release/RELEASE_READINESS.md`。
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

/** 每个用例重复几次，取中位数，压掉单次抖动。 */
const RUNS = 3
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

const time = (run: () => void): number => {
  const started = performance.now()
  run()
  return performance.now() - started
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
    solveMs: number
    judgeSolvedMs: number | null
    judgeWrongMs: number
    solved: boolean
  }> = []

  for (const entry of CASES) {
    const board = parseBoardLines(entry.practice.board.lines)
    let solution: Point | null = null

    const solveSamples = Array.from({ length: RUNS }, () =>
      time(() => {
        solution = solveMove(board, entry.practice.player, entry.practice.goal, now)
      }),
    )

    const solved = solution as Point | null
    const judgeSolvedSamples =
      solved === null
        ? []
        : Array.from({ length: RUNS }, () =>
            time(() => {
              judgeMove(board, entry.practice.player, solved, entry.practice.goal, now)
            }),
          )

    const wrong = firstEmpty(board)
    const judgeWrongSamples = Array.from({ length: RUNS }, () =>
      time(() => {
        judgeMove(board, entry.practice.player, wrong, entry.practice.goal, now)
      }),
    )

    rows.push({
      group: entry.group,
      id: entry.id,
      solveMs: Number(median(solveSamples).toFixed(2)),
      judgeSolvedMs:
        judgeSolvedSamples.length === 0
          ? null
          : Number(median(judgeSolvedSamples).toFixed(2)),
      judgeWrongMs: Number(median(judgeWrongSamples).toFixed(2)),
      solved: solved !== null,
    })
  }

  rows.sort((a, b) => b.solveMs - a.solveMs)

  console.log(`\n=== 学习内容：判题 / 求解（中位，RUNS=${RUNS}）===`)
  console.log('组\tid\t求解(ms)\t判题·正确解(ms)\t判题·无关点(ms)')
  for (const row of rows) {
    console.log(
      `${row.group}\t${row.id}\t${row.solveMs.toFixed(2)}\t` +
        `${row.judgeSolvedMs === null ? '—' : row.judgeSolvedMs.toFixed(2)}\t` +
        `${row.judgeWrongMs.toFixed(2)}`,
    )
  }

  const worst = rows[0]!
  const worstJudge = [...rows].sort(
    (a, b) => (b.judgeSolvedMs ?? 0) - (a.judgeSolvedMs ?? 0),
  )[0]!
  console.log(
    `\n最慢求解：${worst.group}|${worst.id} ${worst.solveMs.toFixed(2)} ms；` +
      `最慢判题：${worstJudge.group}|${worstJudge.id} ` +
      `${worstJudge.judgeSolvedMs === null ? '—' : worstJudge.judgeSolvedMs.toFixed(2)} ms`,
  )

  writeFileSync(
    'bench/learn-last-run.json',
    `${JSON.stringify({ runs: RUNS, rows }, null, 2)}\n`,
  )
  console.log('结果已写入 bench/learn-last-run.json')
})
