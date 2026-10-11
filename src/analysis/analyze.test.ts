import { describe, expect, it } from 'vitest'
import type { Point } from '../core/types'
import { WIN_SCORE } from '../ai/types'
import { ENGINE_VERSION } from '../ai/version'
import { buildSummary, buildVerdict, cacheKey, verdictLabel, type MoveVerdict } from './analyze'

const AT: Point = { x: 7, y: 7 }

function verdict(overrides: Partial<Parameters<typeof buildVerdict>[0]> = {}): MoveVerdict {
  return buildVerdict({
    moveIndex: 0,
    played: AT,
    engineMove: AT,
    engineScore: 500,
    playedScore: 500,
    isWinningMove: false,
    confidence: 'exact',
    engineDepth: 2,
    engineNodes: 100,
    ...overrides,
  })
}

describe('buildVerdict', () => {
  it('与引擎一致时 loss 为 0', () => {
    expect(verdict().loss).toBe(0)
  })

  it('比引擎差时 loss = engineScore − playedScore', () => {
    const result = verdict({ engineScore: 800, playedScore: 300 })
    expect(result.loss).toBe(500)
  })

  it('playedScore 高于 engineScore（防御分支）时 loss 钳到 0', () => {
    const result = verdict({ engineScore: 300, playedScore: 900 })
    expect(result.loss).toBe(0)
  })

  it('终局手 loss 恒 0——赢棋不存在亏损', () => {
    const result = verdict({ engineScore: 42, playedScore: 0, isWinningMove: true })
    expect(result.loss).toBe(0)
  })

  it('如实带出引擎的深度、节点数与可靠度', () => {
    const result = verdict({ engineDepth: 4, engineNodes: 1234, confidence: 'heuristic' })
    expect(result.engineDepth).toBe(4)
    expect(result.engineNodes).toBe(1234)
    expect(result.confidence).toBe('heuristic')
  })
})

describe('buildSummary', () => {
  it('按 loss 降序取前 3', () => {
    const verdicts = [
      verdict({ moveIndex: 0, engineScore: 100, playedScore: 0 }), // loss 100
      verdict({ moveIndex: 1, engineScore: 0, playedScore: 0 }), // loss 0
      verdict({ moveIndex: 2, engineScore: 900, playedScore: 100 }), // loss 800
      verdict({ moveIndex: 3, engineScore: 500, playedScore: 450 }), // loss 50
      verdict({ moveIndex: 4, engineScore: 700, playedScore: 200 }), // loss 500
    ]

    const summary = buildSummary(verdicts)

    expect(summary.moveVerdicts).toHaveLength(5)
    expect(summary.topLosses.map((entry) => entry.moveIndex)).toEqual([2, 4, 0])
  })

  it('不足 3 条时有多少取多少', () => {
    const summary = buildSummary([verdict({ moveIndex: 0 })])
    expect(summary.topLosses).toHaveLength(1)
  })
})

describe('verdictLabel', () => {
  it('着法与引擎首选相同 → 与引擎一致', () => {
    expect(verdictLabel(verdict())).toBe('与引擎一致')
  })

  it('着法不同但分差为 0 → 与引擎首选相当，**不说「一致」**', () => {
    // 真实对局里出现过：开局捷径给 engineScore 0，而对手视角评分取负后
    // 大于 0，loss 被钳成 0——此时着法明明不同，说「一致」是误导。
    const label = verdictLabel(
      verdict({ played: AT, engineMove: { x: 3, y: 3 }, engineScore: 0, playedScore: 50 }),
    )
    expect(label).toBe('与引擎首选相当')
    expect(label).not.toContain('一致')
  })

  it('小分差 → 分差约 N 子（粗略换算）', () => {
    const label = verdictLabel(
      verdict({ engineScore: 30_000, playedScore: 10_000, engineMove: { x: 3, y: 3 } }),
    )
    expect(label).toBe('分差约 2 子')
  })

  it('大分差 → 分差极大——不声称「错过取胜」', () => {
    // 玩家可能本来就没有胜机（例如该防没防、局面直接崩），
    // 说「错过直接取胜」是在编造一个当时并不存在的机会。
    const label = verdictLabel(
      verdict({ engineScore: WIN_SCORE, playedScore: 0, engineMove: { x: 3, y: 3 } }),
    )
    expect(label).toBe('分差极大')
    expect(label).not.toContain('错过')
  })

  it('任何文案都不含「失误」——不设固定档位', () => {
    for (const loss of [0, 1, 5_000, 30_000, WIN_SCORE - 1]) {
      const entry = verdict({ engineScore: loss, playedScore: 0, engineMove: { x: 3, y: 3 } })
      expect(verdictLabel(entry)).not.toContain('失误')
    }
  })
})

describe('cacheKey', () => {
  const base = cacheKey(1, 'easy', 400)

  it('换档位 / 预算 / 局面都产生不同的键', () => {
    expect(cacheKey(1, 'medium', 400)).not.toBe(base)
    expect(cacheKey(1, 'easy', 800)).not.toBe(base)
    expect(cacheKey(2, 'easy', 400)).not.toBe(base)
  })

  it('同参数幂等', () => {
    expect(cacheKey(1, 'easy', 400)).toBe(base)
  })

  it('键掺引擎版本——换 ENGINE_VERSION 必须重算', () => {
    expect(base.startsWith(`v1:${ENGINE_VERSION}:`)).toBe(true)
  })
})
