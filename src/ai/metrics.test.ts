import { describe, expect, it, afterEach } from 'vitest'
import { BLACK } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import { DIFFICULTY_PARAMS } from './difficulty'
import { countCall, startAiCounters, stopAiCounters } from './metrics'
import { searchBoard, searchOptionsFor } from './search'

/**
 * 可选调用计数器。
 *
 * 它的产出是 Phase 10B 结论的一部分（「每个节点 0.69 次评估」），
 * 所以「默认不改变任何东西」这件事本身要有断言，不能只靠注释承诺。
 */

afterEach(() => {
  stopAiCounters()
})

describe('调用计数器', () => {
  it('默认关闭：调用是空操作，停止时也没有结果可返回', () => {
    expect(() => {
      countCall('evaluateBoard')
      countCall('analyzeFast')
    }).not.toThrow()

    expect(stopAiCounters()).toBeNull()
  })

  it('开启后按名字累加', () => {
    const counters = startAiCounters()

    countCall('evaluateBoard')
    countCall('evaluateBoard')
    countCall('ttProbe')

    expect(counters.evaluateBoard).toBe(2)
    expect(counters.ttProbe).toBe(1)
    expect(counters.orderMoves).toBe(0)
  })

  it('停止返回同一份结果，并且此后不再累加', () => {
    const counters = startAiCounters()
    countCall('candidateMoves')

    expect(stopAiCounters()).toBe(counters)

    countCall('candidateMoves')
    expect(counters.candidateMoves).toBe(1)
  })

  it('重复开启得到一份全新的计数器，不会继承上一次的数字', () => {
    const first = startAiCounters()
    countCall('evaluateBoard')
    stopAiCounters()

    const second = startAiCounters()
    expect(second.evaluateBoard).toBe(0)
    expect(second).not.toBe(first)
  })

  it('不影响搜索结果：开启前后逐字段相同', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '......WB.......',
      '.....BWB.......',
      '......BW.......',
    ])
    const options = { ...searchOptionsFor(DIFFICULTY_PARAMS.easy, { budgetMs: 1_000_000_000 }), maxDepth: 3 }

    const plain = searchBoard(board, BLACK, options, () => 0)

    const counters = startAiCounters()
    const counted = searchBoard(board, BLACK, options, () => 0)
    stopAiCounters()

    expect(counted).toEqual(plain)
    // 顺带确认这次运行真的经过了计数器，而不是「两边都没数」的假一致。
    // 搜索的叶子取分已改走增量评估、不再调用 `evaluateBoard`，所以这里数的是排序路径。
    expect(counters.analyzeFast).toBeGreaterThan(0)
    expect(counters.orderMoves).toBeGreaterThan(0)
  })
})
