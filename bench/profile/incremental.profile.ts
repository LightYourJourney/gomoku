import { writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { test } from 'vitest'
import { candidateMoves } from '../../src/ai/candidates'
import { evaluateBoard } from '../../src/ai/evaluate'
import { createIncrementalEvaluator, type IncrementalEvaluator } from '../../src/ai/incrementalEvaluate'
import { idx } from '../../src/core/board'
import { BLACK, WHITE, type Board, type Player } from '../../src/core/types'
import { measureRetained, measureUs, sink } from './measure'
import { WORKLOADS } from './workloads'

/**
 * 增量评估的**全生命周期**对照（`yarn profile` 会一并跑）。
 *
 * 只比「缓存读取 vs 全盘扫描」是没有意义的——真正要回答的是：
 * 一次「落子 → 更新 → 取分 → 撤销」的完整循环，比一次 `evaluateBoard()` 便宜多少。
 * 所以主指标是 lifecycle（cycle），其余几项用来解释它为什么快/不快。
 *
 * 同一进程、同一块棋盘、相邻执行，A/B 只差实现本身。机器负载会同时放慢两边，
 * 因此**比值**比绝对数字可靠；绝对值连同负载一起报。
 */

function boardOf(id: string): Board {
  const workload = WORKLOADS.find((w) => w.id === id)
  if (workload === undefined) throw new Error(`没有局面 ${id}`)
  return workload.board
}

const BOARDS = ['opening-adjacent', 'bench-midgame', 'quiet-midgame', 'bench-double-three', 'nearly-full'] as const

const PLAYER: Player = BLACK

interface Row {
  readonly board: string
  readonly emptyCells: number
  readonly fullUs: number
  readonly initUs: number
  readonly scoreUs: number
  readonly lifecycleUs: number
  readonly ratio: number
}

/**
 * 从棋盘上挑一批空点，轮流落子。
 *
 * 取 `candidateMoves()` 的结果而不是「前 24 个空格」：搜索只会落在已有棋子附近，
 * 而那些点往往同时属于 4 条长斜线；棋盘最上面两行的空格只属于较短的斜线，
 * 拿它们测会把 `place` 的量级系统性低估（第一版就踩过：6.1 µs vs 3.2 µs）。
 */
function emptyIndices(board: Board, limit = 24): number[] {
  const points = candidateMoves(board)
  if (points.length === 0) return []

  const step = Math.max(1, Math.floor(points.length / limit))
  const indices: number[] = []
  for (let i = 0; i < points.length && indices.length < limit; i += step) {
    const point = points[i]!
    indices.push(idx(point.x, point.y))
  }
  return indices
}

/**
 * `place` 的单价：一次性落满一批（计时），再整批撤销（不计时）。
 *
 * 这样每批只有两次 `performance.now()`，不会把计时开销摊到每一次落子上。
 * `undo` 用完全对称的方式测。
 */
function measureStackCost(
  evaluator: IncrementalEvaluator,
  indices: readonly number[],
  player: Player,
  batches = 9,
): { placeUs: number; undoUs: number } {
  let placeTotal = 0
  let undoTotal = 0

  for (let batch = 0; batch < batches; batch++) {
    const startedAt = performance.now()
    for (const index of indices) evaluator.place(index, player)
    placeTotal += performance.now() - startedAt

    const undoStartedAt = performance.now()
    for (let i = 0; i < indices.length; i++) evaluator.undo()
    undoTotal += performance.now() - undoStartedAt
  }

  const calls = batches * indices.length
  return { placeUs: (placeTotal / calls) * 1000, undoUs: (undoTotal / calls) * 1000 }
}

function measureBoard(id: string): Row {
  const board = boardOf(id)
  const indices = emptyIndices(board)

  const full = measureUs(() => {
    sink.value += evaluateBoard(board, PLAYER)
  }, { warmup: 300, inner: 200 })

  const init = measureUs(() => {
    sink.value += createIncrementalEvaluator(board).score(PLAYER)
  }, { warmup: 100, inner: 100 })

  const evaluator = createIncrementalEvaluator(board)

  const score = measureUs(() => {
    sink.value += evaluator.score(PLAYER)
  }, { warmup: 1000, inner: 5000 })

  // 完整生命周期：落子 → 取分 → 撤销。这是搜索里真正会发生的序列。
  let cursor = 0
  const lifecycle = measureUs(() => {
    const index = indices[cursor % indices.length]!
    cursor++
    evaluator.place(index, PLAYER)
    sink.value += evaluator.score(PLAYER)
    evaluator.undo()
  }, { warmup: 500, inner: 2000 })

  return {
    board: id,
    emptyCells: indices.length,
    fullUs: full.minUs,
    initUs: init.minUs,
    scoreUs: score.minUs,
    lifecycleUs: lifecycle.minUs,
    ratio: lifecycle.minUs === 0 ? Number.POSITIVE_INFINITY : full.minUs / lifecycle.minUs,
  }
}

interface StackRow {
  readonly board: string
  readonly placeUs: number
  readonly undoUs: number
}

function measureStack(id: string): StackRow {
  const board = boardOf(id)
  const indices = emptyIndices(board, 12)
  const { placeUs, undoUs } = measureStackCost(createIncrementalEvaluator(board), indices, PLAYER)
  return { board: id, placeUs, undoUs }
}

/**
 * 递归落子 / 撤销的总体成本。
 *
 * 两棵树**结构完全相同**（同一候选顺序、同一宽度与深度），唯一差别在叶子怎么取分：
 * 一棵调 `evaluateBoard()`，另一棵读增量上下文。这样差值就只能来自叶子评估本身。
 */
interface TreeRow {
  readonly board: string
  readonly depth: number
  readonly width: number
  readonly leaves: number
  readonly fullMs: number
  readonly incrementalMs: number
  readonly ratio: number
}

function walkFull(board: Board, player: Player, depth: number, width: number, leaves: { count: number; sum: number }): void {
  if (depth === 0) {
    leaves.count++
    leaves.sum += evaluateBoard(board, player)
    return
  }

  for (const point of candidateMoves(board).slice(0, width)) {
    const index = point.y * 15 + point.x
    board[index] = player
    walkFull(board, player === BLACK ? WHITE : BLACK, depth - 1, width, leaves)
    board[index] = 0
  }
}

function walkIncremental(
  evaluator: IncrementalEvaluator,
  player: Player,
  depth: number,
  width: number,
  leaves: { count: number; sum: number },
): void {
  if (depth === 0) {
    leaves.count++
    leaves.sum += evaluator.score(player)
    return
  }

  for (const point of candidateMoves(evaluator.board).slice(0, width)) {
    const index = point.y * 15 + point.x
    evaluator.place(index, player)
    walkIncremental(evaluator, player === BLACK ? WHITE : BLACK, depth - 1, width, leaves)
    evaluator.undo()
  }
}

function measureTree(id: string, depth: number, width: number): TreeRow {
  const source = boardOf(id)

  const fullBoard = source.slice()
  const fullLeaves = { count: 0, sum: 0 }
  const full = measureUs(() => {
    fullLeaves.count = 0
    fullLeaves.sum = 0
    walkFull(fullBoard, PLAYER, depth, width, fullLeaves)
    sink.value += fullLeaves.sum
  }, { warmup: 3, inner: 5, batches: 7 })

  const evaluator = createIncrementalEvaluator(source)
  const incrementalLeaves = { count: 0, sum: 0 }
  const incremental = measureUs(() => {
    incrementalLeaves.count = 0
    incrementalLeaves.sum = 0
    walkIncremental(evaluator, PLAYER, depth, width, incrementalLeaves)
    sink.value += incrementalLeaves.sum
  }, { warmup: 3, inner: 5, batches: 7 })

  if (fullLeaves.count !== incrementalLeaves.count || fullLeaves.sum !== incrementalLeaves.sum) {
    throw new Error(
      `${id} 的两种走法结果不一致：叶子 ${fullLeaves.count}/${incrementalLeaves.count}，` +
        `分值和 ${fullLeaves.sum}/${incrementalLeaves.sum}`,
    )
  }

  return {
    board: id,
    depth,
    width,
    leaves: fullLeaves.count,
    fullMs: full.minUs / 1000,
    incrementalMs: incremental.minUs / 1000,
    ratio: incremental.minUs === 0 ? Number.POSITIVE_INFINITY : full.minUs / incremental.minUs,
  }
}

interface MemoryRow {
  readonly label: string
  readonly instances: number
  readonly heapDeltaBytes: number
  /** 定长 TypedArray 的底层缓冲区通常记在 external 而不是 heapUsed 里。 */
  readonly externalDeltaBytes: number
  readonly bytesPerInstance: number
  /** 没有 `--expose-gc` 时这个数是不可靠的，报告里要标出来。 */
  readonly gcAvailable: boolean
}

function measureMemory(): MemoryRow[] {
  const board = boardOf('bench-midgame')

  const keep: IncrementalEvaluator[] = []
  const retained = measureRetained(() => {
    for (let i = 0; i < 5000; i++) keep.push(createIncrementalEvaluator(board))
    // 确保实例没有被优化掉
    sink.value += keep.reduce((sum, evaluator) => sum + evaluator.score(BLACK), 0)
  })

  return [
    {
      label: 'createIncrementalEvaluator（棋盘副本 + 144 个线分）',
      instances: 5000,
      heapDeltaBytes: retained.heap,
      externalDeltaBytes: retained.external,
      bytesPerInstance: (retained.heap + retained.external) / 5000,
      gcAvailable: retained.gcAvailable,
    },
  ]
}

test('增量评估生命周期', () => {
  const rows = BOARDS.map(measureBoard)
  const stacks = BOARDS.map(measureStack)
  const trees = [
    measureTree('bench-midgame', 3, 6),
    measureTree('quiet-midgame', 3, 6),
    measureTree('bench-double-three', 2, 8),
  ]
  const memory = measureMemory()

  const payload = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    loadAverage: loadavg()[0] ?? null,
    sink: sink.value,
    lifecycle: rows,
    stack: stacks,
    trees,
    memory,
  }

  writeFileSync(new URL('./last-incremental.json', import.meta.url), `${JSON.stringify(payload, null, 2)}\n`)

  console.log(`\n=== 全生命周期（min 值，单位 µs）===`)
  console.log('局面\t全盘评估\tscore 读取\tinit\t落子+取分+撤销\t加速比')
  for (const row of rows) {
    console.log(
      `${row.board}\t${row.fullUs.toFixed(2)}\t${row.scoreUs.toFixed(3)}\t${row.initUs.toFixed(2)}\t${row.lifecycleUs.toFixed(3)}\t${row.ratio.toFixed(2)}x`,
    )
  }

  console.log(`\n=== 落子 / 撤销单价（µs）===`)
  console.log('局面\tplace\tundo')
  for (const row of stacks) console.log(`${row.board}\t${row.placeUs.toFixed(3)}\t${row.undoUs.toFixed(3)}`)

  console.log(`\n=== 递归树（同结构，只换叶子取分方式）===`)
  console.log('局面\t深度\t宽度\t叶子\t全盘(ms)\t增量(ms)\t加速比')
  for (const row of trees) {
    console.log(
      `${row.board}\t${row.depth}\t${row.width}\t${row.leaves}\t${row.fullMs.toFixed(2)}\t${row.incrementalMs.toFixed(2)}\t${row.ratio.toFixed(2)}x`,
    )
  }

  console.log(`\n=== 内存 ===`)
  for (const row of memory) {
    console.log(
      `${row.label}：${row.instances} 个实例，堆增 ${(row.heapDeltaBytes / 1024).toFixed(0)} KiB / ` +
        `external 增 ${(row.externalDeltaBytes / 1024).toFixed(0)} KiB（合计 ${row.bytesPerInstance.toFixed(0)} B/实例）` +
        `${row.gcAvailable ? '' : '（未启用 --expose-gc，数值不可靠）'}`,
    )
  }
  console.log(`\n结果已写入 bench/profile/last-incremental.json`)
}, 900_000)
