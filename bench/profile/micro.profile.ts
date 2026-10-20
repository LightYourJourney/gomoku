import { writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { test } from 'vitest'
import { candidateMoves } from '../../src/ai/candidates'
import { idx, inBounds } from '../../src/core/board'
import { evaluateBoard } from '../../src/ai/evaluate'
import { analyzeFast, threatScoreWith } from '../../src/ai/patterns'
import { computeKey, createTranspositionTable, toggleStone } from '../../src/ai/transposition'
import { findForcedWin } from '../../src/ai/threat'
import { BLACK, WHITE, type Board } from '../../src/core/types'
import { measureRetained, measureUs, sink, type Measurement } from './measure'
import { WORKLOADS } from './workloads'

/**
 * 热点函数的**单价**（`yarn profile` 会一并跑）。
 *
 * CPU profile 回答「时间花在谁身上」，这张表回答「一次调用值多少」。
 * 两者缺一不可：一个 100 µs 的函数如果只调用 10 次，就不如一个 1 µs 但调用
 * 十万次的函数值得优化（见 `docs/ai-research/CPU_PROFILE.md` 的换算）。
 */

interface Row {
  readonly name: string
  readonly board: string
  readonly measurement: Measurement
  /**
   * 一次 `fn()` 里做了多少件同类工作。
   *
   * 有的测量一次只处理一个点，有的一次跑完整个候选列表；不除这个数，
   * 表里的「单点耗时」会直接大出几十倍（第一版就踩过：142 µs 的 analyzeFast
   * 其实是 81 个点的合计）。
   */
  readonly divisor: number
}

function boardOf(id: string): Board {
  const workload = WORKLOADS.find((w) => w.id === id)
  if (workload === undefined) throw new Error(`没有局面 ${id}`)
  return workload.board
}

const BOARDS = ['bench-midgame', 'quiet-midgame', 'bench-double-three', 'nearly-full'] as const

function evaluateRows(): Row[] {
  return BOARDS.map((id) => {
    const board = boardOf(id)
    return {
      name: 'evaluateBoard（单方）',
      board: id,
      measurement: measureUs(() => {
        sink.value += evaluateBoard(board, BLACK)
      }, { warmup: 500, inner: 200 }),
      divisor: 1,
    }
  })
}

function candidateRows(): Row[] {
  return BOARDS.map((id) => {
    const board = boardOf(id)
    return {
      name: 'candidateMoves',
      board: id,
      measurement: measureUs(() => {
        sink.value += candidateMoves(board).length
      }, { warmup: 500, inner: 500 }),
      divisor: 1,
    }
  })
}

function patternRows(): Row[] {
  const board = boardOf('quiet-midgame')
  const points = candidateMoves(board)

  return [
    {
      name: 'analyzeFast（单点）',
      board: 'quiet-midgame',
      measurement: measureUs(() => {
        for (const point of points) sink.value += analyzeFast(board, point, BLACK).winningPoints.length
      }, { warmup: 200, inner: 100 }),
      divisor: points.length,
    },
    {
      name: 'threatScoreWith（单点，含 analyzeFast）',
      board: 'quiet-midgame',
      measurement: measureUs(() => {
        for (const point of points) {
          const fast = analyzeFast(board, point, BLACK)
          sink.value += threatScoreWith(board, point, BLACK, fast)
        }
      }, { warmup: 200, inner: 100 }),
      divisor: points.length,
    },
    {
      name: '一个节点的排序原料（candidateMoves + 双方 analyzeFast + threatScoreWith）',
      board: 'quiet-midgame',
      measurement: measureUs(() => {
        const list = candidateMoves(board)
        for (const point of list) {
          sink.value += threatScoreWith(board, point, BLACK, analyzeFast(board, point, BLACK))
          sink.value += threatScoreWith(board, point, WHITE, analyzeFast(board, point, WHITE))
        }
      }, { warmup: 100, inner: 50 }),
      divisor: 1,
    },
  ]
}

function transpositionRows(): Row[] {
  const board = boardOf('bench-midgame')
  const base = computeKey(board, BLACK)
  const table = createTranspositionTable()

  // 准备一批键：命中与未命中各测一份
  const keys = [] as { hi: number; lo: number }[]
  let key = base
  for (let i = 0; i < 2048; i++) {
    key = toggleStone(key, (i * 37) % 225, BLACK)
    keys.push(key)
    table.store(key, { lo: key.lo, depth: 4, score: i, flag: 'exact', move: { x: i % 15, y: 0 } })
  }

  let cursor = 0
  const hitRow: Row = {
    name: 'tt.probe（命中）',
    board: 'bench-midgame',
    measurement: measureUs(() => {
      const probe = keys[cursor % keys.length]!
      cursor++
      sink.value += table.probe(probe, 1) === null ? 0 : 1
    }, { warmup: 1000, inner: 2000 }),
    divisor: 1,
  }

  let missCursor = 0
  const missRow: Row = {
    name: 'tt.probe（未命中）',
    board: 'bench-midgame',
    measurement: measureUs(() => {
      missCursor++
      sink.value += table.probe({ hi: 0xffff_0000 + (missCursor % 1000), lo: missCursor }, 1) === null ? 0 : 1
    }, { warmup: 1000, inner: 2000 }),
    divisor: 1,
  }

  let storeCursor = 0
  const storeRow: Row = {
    name: 'tt.store',
    board: 'bench-midgame',
    measurement: measureUs(() => {
      storeCursor++
      const k = keys[storeCursor % keys.length]!
      table.store(k, { lo: k.lo, depth: 2, score: storeCursor, flag: 'exact', move: { x: 0, y: 0 } })
    }, { warmup: 500, inner: 1000 }),
    divisor: 1,
  }

  return [hitRow, missRow, storeRow]
}

function primitiveRows(): Row[] {
  // 固定一批「棋盘内」与「棋盘外」混着的坐标：纯整数输入，走的是 Number.isInteger 那条路径
  const coords: { x: number; y: number }[] = []
  for (let i = 0; i < 256; i++) coords.push({ x: (i % 20) - 2, y: (Math.floor(i / 20) % 20) - 2 })

  return [
    {
      name: 'inBounds（整数输入）',
      board: '-',
      measurement: measureUs(() => {
        for (const c of coords) sink.value += inBounds(c.x, c.y) ? 1 : 0
      }, { warmup: 2000, inner: 2000 }),
      divisor: coords.length,
    },
    {
      // 参考实现：只在「调用方保证是整数」时可用。用来量化 Number.isInteger 的代价，
      // 不是建议直接换掉 inBounds（它对 NaN / Infinity 有语义）。
      name: 'inBounds 的等价纯比较（参考，不用于生产）',
      board: '-',
      measurement: measureUs(() => {
        for (const c of coords) {
          sink.value += c.x >= 0 && c.x < 15 && c.y >= 0 && c.y < 15 ? 1 : 0
        }
      }, { warmup: 2000, inner: 2000 }),
      divisor: coords.length,
    },
    {
      name: 'idx',
      board: '-',
      measurement: measureUs(() => {
        for (const c of coords) sink.value += idx(c.x & 15, c.y & 15)
      }, { warmup: 2000, inner: 2000 }),
      divisor: coords.length,
    },
  ]
}

function vcfRows(): Row[] {
  return ['bench-vcf-win', 'bench-vcf-counters'].map((id) => {
    const board = boardOf(id)
    return {
      name: 'findForcedWin',
      board: id,
      measurement: measureUs(() => {
        const result = findForcedWin(board, BLACK, {
          maxPlies: 13,
          allowThrees: false,
          deadline: Number.POSITIVE_INFINITY,
          now: () => 0,
        })
        sink.value += result.plies
      }, { warmup: 50, inner: 50 }),
      divisor: 1,
    }
  })
}

/**
 * 置换表的内存代价。
 *
 * 每个条目 = 一个 Map 键（number）+ 一个条目对象（含 `move: Point`）。
 * 这里存 20,000 条（接近一次专家档搜索的量级），量堆增量。
 * 没有强制 GC，所以这个数**只作量级参考**，不是精确分配统计。
 */
function transpositionMemory(): {
  entries: number
  heapDeltaBytes: number
  bytesPerEntry: number
  gcAvailable: boolean
} {
  const table = createTranspositionTable()

  const retained = measureRetained(() => {
    for (let i = 0; i < 20_000; i++) {
      const hi = Math.imul(i + 1, 0x9e3779b1) >>> 0
      table.store({ hi, lo: i }, { lo: i, depth: 4, score: i, flag: 'exact', move: { x: i % 15, y: 0 } })
    }
    sink.value += table.size
  })

  return {
    entries: 20_000,
    heapDeltaBytes: retained.heap,
    bytesPerEntry: retained.heap / 20_000,
    gcAvailable: retained.gcAvailable,
  }
}

test('热点函数单价', () => {
  const rows: Row[] = [
    ...evaluateRows(),
    ...candidateRows(),
    ...patternRows(),
    ...transpositionRows(),
    ...primitiveRows(),
    ...vcfRows(),
  ]

  const payload = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    loadAverage: loadavg()[0] ?? null,
    sink: sink.value,
    transpositionMemory: transpositionMemory(),
    rows: rows.map((row) => ({
      name: row.name,
      board: row.board,
      minUs: row.measurement.minUs / row.divisor,
      medianUs: row.measurement.medianUs / row.divisor,
      maxUs: row.measurement.maxUs / row.divisor,
      calls: row.measurement.calls,
    })),
  }

  writeFileSync(new URL('./last-micro.json', import.meta.url), `${JSON.stringify(payload, null, 2)}\n`)

  console.log(`\n=== 热点函数单价（min / 中位 / max，单位 µs）===`)
  console.log('函数\t局面\tmin\t中位\tmax\t批内调用')
  for (const row of rows) {
    const m = row.measurement
    console.log(
      `${row.name}\t${row.board}\t${(m.minUs / row.divisor).toFixed(3)}\t${(m.medianUs / row.divisor).toFixed(3)}\t${(m.maxUs / row.divisor).toFixed(3)}\t${m.calls}`,
    )
  }
  const tt = payload.transpositionMemory
  console.log(
    `\n=== 置换表内存 ===\n${tt.entries} 条：堆增 ${(tt.heapDeltaBytes / 1024).toFixed(0)} KiB（约 ${tt.bytesPerEntry.toFixed(0)} B/条）`,
  )
  console.log(`\n结果已写入 bench/profile/last-micro.json`)
}, 900_000)
