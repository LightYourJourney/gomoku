import { describe, expect, it } from 'vitest'
import { createBoard, idx } from '../core/board'
import { BLACK, WHITE, type Board } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import {
  computeKey,
  createTranspositionTable,
  toggleStone,
  toggleTurn,
  type TtEntry,
} from './transposition'

function entry(patch: Partial<TtEntry> = {}): TtEntry {
  return { lo: 0, depth: 3, score: 100, flag: 'exact', move: { x: 7, y: 7 }, ...patch }
}

describe('Zobrist 哈希', () => {
  it('同一局面多次计算得到同一个键', () => {
    const board = boardFromLines(['...............', '...............', '...BWB.........'])

    expect(computeKey(board, BLACK)).toEqual(computeKey(board, BLACK))
  })

  it('落子后再撤销，哈希回到原值', () => {
    const empty = createBoard()
    const before = computeKey(empty, BLACK)

    const placed = toggleStone(before, idx(7, 7), BLACK)
    const removed = toggleStone(placed, idx(7, 7), BLACK)

    expect(removed).toEqual(before)
  })

  it('增量落子算出的键与一次性计算一致', () => {
    const board = boardFromLines(['...............', '...............', '...BWB.........'])

    let key = computeKey(createBoard(), BLACK)
    key = toggleStone(key, idx(3, 2), BLACK)
    key = toggleTurn(key)
    key = toggleStone(key, idx(4, 2), WHITE)
    key = toggleTurn(key)
    key = toggleStone(key, idx(5, 2), BLACK)

    expect(key).toEqual(computeKey(board, BLACK))
  })

  it('只差一颗子，hi 与 lo 至少有一个不同', () => {
    const without = boardFromLines(['...............', '...............', '...BW..........'])
    const withStone = boardFromLines(['...............', '...............', '...BWB.........'])

    const a = computeKey(without, BLACK)
    const b = computeKey(withStone, BLACK)

    expect(a.hi !== b.hi || a.lo !== b.lo).toBe(true)
  })

  it('同一棋盘、轮到不同方，键不同', () => {
    const board = boardFromLines(['...............', '...............', '...BWB.........'])

    expect(computeKey(board, BLACK)).not.toEqual(computeKey(board, WHITE))
  })

  it('黑白互换后的局面键不同', () => {
    const blackFirst = boardFromLines(['...............', '...............', '...BWB.........'])
    const swapped = boardFromLines(['...............', '...............', '...WBW.........'])

    expect(computeKey(blackFirst, BLACK)).not.toEqual(computeKey(swapped, BLACK))
  })

  it('空盘与只放一子的局面键不同', () => {
    const one = toggleStone(computeKey(createBoard(), BLACK), idx(0, 0), BLACK)

    expect(one).not.toEqual(computeKey(createBoard(), BLACK))
  })

  it('键的两个分量都是 32 位无符号数', () => {
    const board = boardFromLines(['BWBWBWBWBWBWBWB', 'WBWBWBWBWBWBWBW', 'BWBWBWBWBWBWBWB'])

    for (const part of [computeKey(board, BLACK).hi, computeKey(board, BLACK).lo]) {
      expect(Number.isInteger(part)).toBe(true)
      expect(part).toBeGreaterThanOrEqual(0)
      expect(part).toBeLessThan(2 ** 32)
    }
  })

  it('落子与撤销在满盘上来回切换也稳定', () => {
    const board: Board = createBoard()
    board.fill(BLACK)

    const key = computeKey(board, WHITE)
    const removed = toggleStone(key, idx(14, 14), BLACK)

    expect(toggleStone(removed, idx(14, 14), BLACK)).toEqual(key)
  })
})

describe('置换表', () => {
  it('存入后能按同一 key 取出', () => {
    const table = createTranspositionTable()
    const key = computeKey(createBoard(), BLACK)

    table.store(key, entry({ depth: 4, score: 42 }))

    expect(table.probe(key, 4)).toMatchObject({ depth: 4, score: 42 })
  })

  it('lo 对不上时视为未命中', () => {
    const table = createTranspositionTable()
    const key = computeKey(createBoard(), BLACK)

    table.store(key, entry({ lo: key.lo }))

    // 主键相同、校验分量不同——模拟 32 位主键碰撞
    expect(table.probe({ hi: key.hi, lo: key.lo ^ 0xffff }, 1)).toBeNull()
  })

  it('已存条目的深度不足时不再返回', () => {
    const table = createTranspositionTable()
    const key = computeKey(createBoard(), BLACK)

    table.store(key, entry({ depth: 2 }))

    expect(table.probe(key, 2)).not.toBeNull()
    expect(table.probe(key, 3)).toBeNull()
  })

  it('返回的条目带着查表时用的那份 lo，调用方可据此判断真命中', () => {
    const table = createTranspositionTable()
    const key = computeKey(createBoard(), BLACK)

    table.store(key, entry({ lo: key.lo }))

    expect(table.probe(key, 1)?.lo).toBe(key.lo)
  })

  it('同一主键冲突时保留深度更大的条目', () => {
    const table = createTranspositionTable()
    const key = computeKey(createBoard(), BLACK)

    table.store(key, entry({ lo: key.lo, depth: 6, score: 600 }))
    table.store(key, entry({ lo: key.lo, depth: 2, score: 200 }))

    expect(table.probe(key, 1)?.score).toBe(600)
  })

  it('深度相同时后来者覆盖', () => {
    const table = createTranspositionTable()
    const key = computeKey(createBoard(), BLACK)

    table.store(key, entry({ lo: key.lo, depth: 3, score: 1 }))
    table.store(key, entry({ lo: key.lo, depth: 3, score: 2 }))

    expect(table.probe(key, 1)?.score).toBe(2)
  })

  it('size 反映当前条目数', () => {
    const table = createTranspositionTable()
    expect(table.size).toBe(0)
    expect(table.size).toBe(0)

    table.store(computeKey(createBoard(), BLACK), entry())
    table.store(computeKey(createBoard(), WHITE), entry())

    expect(table.size).toBe(2)
  })

  it('clear 之后取不到东西', () => {
    const table = createTranspositionTable()
    const key = computeKey(createBoard(), BLACK)
    table.store(key, entry())

    table.clear()

    expect(table.probe(key, 1)).toBeNull()
    expect(table.size).toBe(0)
  })
})
