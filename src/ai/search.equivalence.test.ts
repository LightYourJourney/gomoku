import { describe, expect, it } from 'vitest'
import { BLACK } from '../core/types'
import { boardFromLines, nearlyFullBoard } from '../test/board-fixtures'
import { DIFFICULTY_PARAMS } from './difficulty'
import { searchBoard, searchOptionsFor } from './search'

/**
 * 固定深度下的搜索输出快照。
 *
 * 用途只有一个：**给「纯性能优化」划一条语义红线**。这一阶段会改着法排序与候选生成的
 * 内部实现；只要它们真的只是「同样的事做得更快」，固定深度下的
 * 着法 / 分值 / 节点数 / 置换表命中数就**一个都不能变**。
 *
 * 这些数字是优化前（`6e16ed0`）用同一段代码跑出来的。它们不是「正确答案」，
 * 而是「行为没变的证据」。真要改搜索策略，就应该先改这里——那是一次显式决定。
 */

interface Golden {
  readonly name: string
  readonly board: ReturnType<typeof boardFromLines>
  readonly depth: number
  readonly move: { readonly x: number; readonly y: number }
  readonly score: number
  readonly reached: number
  readonly nodes: number
  readonly ttHits: number
  readonly reason: string
}

const QUIET_MIDGAME = boardFromLines([
  '...............',
  '...............',
  '...............',
  '.......W.......',
  '.......B.......',
  '.....B.....W...',
  '......WB.......',
  '....W.B.B......',
  '.......W.......',
])

const GOLDENS: readonly Golden[] = [
  {
    name: 'opening',
    board: boardFromLines(['...............', '...............', '...............', '......WB.......']),
    depth: 3,
    move: { x: 6, y: 4 },
    score: 800,
    reached: 3,
    nodes: 362,
    ttHits: 0,
    reason: 'search',
  },
  {
    name: 'quiet-midgame',
    board: QUIET_MIDGAME,
    depth: 4,
    move: { x: 6, y: 5 },
    score: 1600,
    reached: 4,
    nodes: 1142,
    ttHits: 28,
    reason: 'search',
  },
  {
    name: 'double-three',
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
    depth: 3,
    move: { x: 8, y: 3 },
    score: 3000,
    reached: 3,
    nodes: 278,
    ttHits: 0,
    reason: 'search',
  },
  {
    name: 'endgame（接近满盘）',
    board: nearlyFullBoard(),
    depth: 4,
    move: { x: 5, y: 5 },
    score: 0,
    reached: 4,
    nodes: 286,
    ttHits: 16,
    reason: 'search',
  },
]

describe('固定深度搜索输出（行为红线）', () => {
  it.each(GOLDENS.map((g) => [g.name, g] as const))('%s', (_name, golden) => {
    const options = {
      ...searchOptionsFor(DIFFICULTY_PARAMS.hard, { budgetMs: 1_000_000_000 }),
      maxDepth: golden.depth,
    }

    const result = searchBoard(golden.board, BLACK, options, () => 0)

    expect(result.move).toEqual(golden.move)
    expect(result.score).toBe(golden.score)
    expect(result.depth).toBe(golden.reached)
    expect(result.nodes).toBe(golden.nodes)
    expect(result.ttHits).toBe(golden.ttHits)
    expect(result.reason).toBe(golden.reason)
  })
})
