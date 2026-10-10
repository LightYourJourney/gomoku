/**
 * Phase 2 引擎基准：把文档里要写的数字**跑出来**，而不是估出来。
 *
 * 单独一套 vitest 配置（`vitest.bench.config.ts`），不进 `yarn test` 的常规套件——
 * 它要花一两分钟，且结果依赖机器。
 *
 *   yarn bench
 *
 * 计时靠真实时钟（这里是基准，不是行为测试，注入假时钟没有意义）。
 */
import { writeFileSync } from 'node:fs'
import { test } from 'vitest'
import type { Board, Player } from '../src/core/types'
import { BLACK, WHITE } from '../src/core/types'
import { DIFFICULTIES, DIFFICULTY_PARAMS } from '../src/ai/difficulty'
import type { Difficulty } from '../src/ai/types'
import { evaluateBoard } from '../src/ai/evaluate'
import { chooseMove } from '../src/ai/search'
import { findForcedWin } from '../src/ai/threat'
import { boardFromLines } from '../src/test/board-fixtures'

/** 每个用例重复几次，取中位数，压掉单次抖动。 */
const RUNS = 5

const POSITIONS: ReadonlyArray<{ name: string; board: Board; player: Player }> = [
  {
    name: '开局',
    board: boardFromLines(['...............', '...............', '...............', '......WB.......']),
    player: BLACK,
  },
  {
    name: '中盘',
    board: boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '......WB.......',
      '.....BWB.......',
      '......BW.......',
      '.......B.......',
    ]),
    player: WHITE,
  },
  {
    name: '四连威胁',
    board: boardFromLines([
      '...............',
      '...............',
      '..........WWWW.',
      '.......B.......',
      '......B........',
      '.....B.........',
    ]),
    player: WHITE,
  },
  {
    name: '双三',
    board: boardFromLines([
      '...............',
      '...............',
      '...............',
      '..........B....',
      '.......B.......',
      '......B........',
      '.....W.W.......',
      '......W........',
    ]),
    player: WHITE,
  },
  {
    name: '接近满盘',
    board: boardFromLines([
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBWB',
      'WBWBWBWBWBWBWBW',
      'BWBWBWBWBWBWBW.',
    ]),
    player: WHITE,
  },
]

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/**
 * 取「耗时居中」的那一次运行的**完整**记录。
 *
 * 不能 depth 取最大值、nodes / 耗时各取中位数：那样一行里的三个数可能来自
 * 三次不同的运行，凑成一个从未真实出现过的组合（超时行的 depth 尤其容易失真）。
 */
function medianRun<T extends { readonly elapsedMs: number }>(runs: readonly T[]): T {
  const sorted = [...runs].sort((a, b) => a.elapsedMs - b.elapsedMs)
  return sorted[Math.floor(sorted.length / 2)]!
}

interface SearchRow {
  readonly difficulty: Difficulty
  readonly position: string
  readonly depth: number
  readonly nodes: number
  readonly elapsedMs: number
  readonly reason: string
}

function benchSearch(): SearchRow[] {
  const rows: SearchRow[] = []

  for (const difficulty of DIFFICULTIES) {
    for (const { name, board, player } of POSITIONS) {
      const runs: SearchRow[] = []

      for (let run = 0; run < RUNS; run++) {
        const response = chooseMove({
          requestId: run,
          gameVersion: 0,
          board,
          player,
          difficulty,
          purpose: 'play',
        })
        runs.push({
          difficulty,
          position: name,
          depth: response.depth,
          nodes: response.nodes,
          elapsedMs: response.elapsedMs,
          reason: response.reason,
        })
      }

      rows.push(medianRun(runs))
    }
  }

  return rows
}

/** 单次 `evaluateBoard` 的耗时，折算成微秒。 */
function benchEvaluate(): { perCallUs: number; calls: number } {
  const board = POSITIONS[1]!.board
  const CALLS = 200_000

  // 先热身，避免把 JIT 编译的时间算进去
  for (let i = 0; i < 10_000; i++) evaluateBoard(board, WHITE)

  const startedAt = performance.now()
  for (let i = 0; i < CALLS; i++) evaluateBoard(board, WHITE)
  const elapsed = performance.now() - startedAt

  return { perCallUs: (elapsed / CALLS) * 1000, calls: CALLS }
}

interface ThreatRow {
  readonly name: string
  readonly expected: string
  readonly found: boolean
  readonly plies: number
  readonly nodes: number
  readonly elapsedMs: number
  /** 实际结果与预期不符。基准不该静默地把错数据的数字报出来。 */
  readonly mismatch: boolean
}

/**
 * 算杀（VCF）的耗时、节点数与**误报检查**。
 *
 * 「找不到杀」只是漏杀，还能忍；「报出一个不存在的杀」会让 AI 直接走进输棋，
 * 危险得多。所以无杀的局面必须和有杀的一起测，而且负例要挑**有威胁但被反先**
 * 的那种——纯安静的散子局面证明不了什么。
 */
function benchThreat(): ThreatRow[] {
  const cases: ReadonlyArray<{
    name: string
    board: Board
    expectWin: boolean
    expectPlies?: number
  }> = [
    {
      name: '活三（3 手胜）',
      board: boardFromLines(['...............', '...............', '...............', '...BBB.........']),
      expectWin: true,
      expectPlies: 3,
    },
    {
      name: '已成四（1 手胜）',
      board: boardFromLines(['...............', '...............', '...............', '...BBBB........']),
      expectWin: true,
      expectPlies: 1,
    },
    {
      name: '有活三但被反先（无杀）',
      board: boardFromLines([
        '...............',
        '...............',
        '...............',
        '...BBB.........',
        '...............',
        '...............',
        '...............',
        '...............',
        '...............',
        '...............',
        '...WWWW........',
      ]),
      expectWin: false,
    },
    {
      name: '散子安静局面（无杀）',
      board: boardFromLines(['...............', '...............', '...............', '...B.B.........']),
      expectWin: false,
    },
  ]

  return cases.map(({ name, board, expectWin, expectPlies }) => {
    const times: number[] = []
    let found = false
    let plies = 0
    let nodes = 0

    for (let run = 0; run < RUNS; run++) {
      const startedAt = performance.now()
      const result = findForcedWin(board, BLACK, {
        maxPlies: DIFFICULTY_PARAMS.expert.threatPlies,
        allowThrees: false,
        deadline: startedAt + 5000,
        now: () => performance.now(),
      })
      times.push(Math.round(performance.now() - startedAt))
      found = result.move !== null
      plies = result.plies
      nodes = result.nodes
    }

    const mismatch =
      found !== expectWin || (expectWin && expectPlies !== undefined && plies !== expectPlies)

    return {
      name,
      expected: expectWin ? `有杀（${expectPlies} 手）` : '无杀',
      found,
      plies,
      nodes,
      elapsedMs: median(times),
      mismatch,
    }
  })
}

interface VctRow {
  readonly name: string
  readonly vcfFound: boolean
  readonly vcfPlies: number
  readonly vcfMs: number
  readonly vctFound: boolean
  readonly vctPlies: number
  readonly vctMs: number
  /** 相对 VCF 的耗时倍数。VCT 默认关闭的依据就是这一列。 */
  readonly ratio: number
  /** VCT 是否换到了 VCF 给不出的结论。 */
  readonly gains: boolean
}

/**
 * VCF 与 VCT 的耗时对照——「VCT 默认关闭」这个决定**全靠这张表**。
 *
 * 若某个局面上 VCT 找到了 VCF 找不到的杀，「更贵」就还说得过去；若一个都没有，
 * 那这个开关就纯粹是白花钱。这里如实把两件事都记下来，包括对 VCT 不利的结果。
 */
function benchVct(): VctRow[] {
  const cases: ReadonlyArray<{ name: string; board: Board }> = [
    {
      name: '孤立活三',
      board: boardFromLines(['...............', '...............', '...............', '...BBB.........']),
    },
    {
      name: '两条活三',
      board: boardFromLines([
        '...............',
        '...............',
        '...............',
        '...BBB.........',
        '...............',
        '...............',
        '......BBB......',
      ]),
    },
    {
      name: '活三 + 远处活二',
      board: boardFromLines([
        '...............',
        '...............',
        '...............',
        '...BBB.........',
        '...............',
        '...............',
        '...............',
        '...............',
        '...........BB..',
      ]),
    },
  ]

  return cases.map(({ name, board }) => {
    const measure = (allowThrees: boolean): { found: boolean; plies: number; ms: number } => {
      const times: number[] = []
      let found = false
      let plies = 0

      for (let run = 0; run < RUNS; run++) {
        const startedAt = performance.now()
        const result = findForcedWin(board, BLACK, {
          maxPlies: 12,
          allowThrees,
          deadline: startedAt + 30_000,
          now: () => performance.now(),
        })
        times.push(performance.now() - startedAt)
        found = result.move !== null
        plies = result.plies
      }

      return { found, plies, ms: median(times) }
    }

    const vcf = measure(false)
    const vct = measure(true)

    return {
      name,
      vcfFound: vcf.found,
      vcfPlies: vcf.plies,
      vcfMs: vcf.ms,
      vctFound: vct.found,
      vctPlies: vct.plies,
      vctMs: vct.ms,
      ratio: vcf.ms > 0 ? vct.ms / vcf.ms : Number.POSITIVE_INFINITY,
      gains: vct.found && !vcf.found,
    }
  })
}

export interface BenchReport {
  readonly runs: number
  readonly search: readonly SearchRow[]
  readonly evaluate: { readonly perCallUs: number; readonly calls: number }
  readonly threat: readonly ThreatRow[]
  readonly vct: readonly VctRow[]
}

// 包在 test 里：vitest 拒绝执行「没有任何用例」的文件。
// 它不做断言——基准的产出是数字，不是通过与失败。
test('Phase 2 引擎基准', () => {
  const report: BenchReport = {
    runs: RUNS,
    search: benchSearch(),
    evaluate: benchEvaluate(),
    threat: benchThreat(),
    vct: benchVct(),
  }

  const OUT = new URL('./last-run.json', import.meta.url)
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`\n=== 搜索：五档 × 五个局面（${RUNS} 次取中位数）===`)
  console.log('难度\t局面\t深度\t节点\t耗时(ms)\t判断')
  for (const row of report.search) {
    console.log(
      `${row.difficulty}\t${row.position}\t${row.depth}\t${row.nodes}\t${row.elapsedMs}\t${row.reason}`,
    )
  }

  console.log(`\n=== evaluateBoard ===`)
  console.log(`${report.evaluate.perCallUs.toFixed(2)} µs/次（${report.evaluate.calls} 次）`)

  console.log(`\n=== 算杀 VCF ===`)
  console.log('局面\t预期\t实际\t手数\t节点\t耗时(ms)')
  for (const row of report.threat) {
    const actual = row.found ? '有杀' : '无杀'
    console.log(
      `${row.name}\t${row.expected}\t${actual}${row.mismatch ? ' ⚠不符' : ''}\t${row.plies}\t${row.nodes}\t${row.elapsedMs}`,
    )
  }
  console.log(`\n=== VCF vs VCT ===`)
  console.log('局面\tVCF(有杀/手数/ms)\tVCT(有杀/手数/ms)\t倍数\tVCT 换到新结论')
  for (const row of report.vct) {
    console.log(
      `${row.name}\t${row.vcfFound}/${row.vcfPlies}/${row.vcfMs.toFixed(1)}\t` +
        `${row.vctFound}/${row.vctPlies}/${row.vctMs.toFixed(1)}\t` +
        `${row.ratio === Number.POSITIVE_INFINITY ? '∞' : row.ratio.toFixed(1)}x\t${row.gains ? '是' : '否'}`,
    )
  }
  console.log(`\n结果已写入 bench/last-run.json`)
})
