// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  bootstrapScoreRate,
  descriptiveElo,
  phaseOf,
  scoreFor,
  searchStats,
  summarize,
  tally,
} from './stats'
import type { GameOutcomeKind, GameRecord, PairedGameSet } from './types'

/**
 * 统计逻辑的已知答案测试。
 *
 * 这些用例的期望值都是**手算出来**的，不是从实现回填的——
 * 「评测器算错了，只是错得很稳定」是本阶段最需要防的一类问题。
 */

function record(
  opening: string,
  black: string,
  white: string,
  outcome: GameOutcomeKind,
  moves: { engine: string; nodes: number; depth: number; reason?: string }[] = [],
): GameRecord {
  return {
    opening,
    black,
    white,
    outcome,
    winner: outcome === 'black-win' ? 1 : outcome === 'white-win' ? 2 : null,
    moves: moves.map((m, i) => ({
      point: { x: i, y: 0 },
      player: (i % 2 === 0 ? 1 : 2) as 1 | 2,
      engine: m.engine,
      metrics: {
        depth: m.depth,
        nodes: m.nodes,
        ttHits: 0,
        reason: (m.reason ?? 'search') as never,
        elapsedMs: 1,
      },
    })),
    error: null,
    failAtMove: null,
    elapsedMs: 0,
  }
}

function pair(
  opening: string,
  aBlack: GameRecord,
  bBlack: GameRecord,
): PairedGameSet {
  return { opening, aBlack, bBlack }
}

describe('得分', () => {
  it('胜 1 / 和 0.5 / 负 0', () => {
    expect(scoreFor(record('o', 'A', 'B', 'black-win'), 'A')).toBe(1)
    expect(scoreFor(record('o', 'A', 'B', 'black-win'), 'B')).toBe(0)
    expect(scoreFor(record('o', 'B', 'A', 'white-win'), 'A')).toBe(1)
    expect(scoreFor(record('o', 'A', 'B', 'draw'), 'A')).toBe(0.5)
  })

  it('未完成的结局不给分', () => {
    for (const outcome of ['move-limit', 'aborted', 'illegal-move', 'no-move', 'engine-error'] as const) {
      expect(scoreFor(record('o', 'A', 'B', outcome), 'A')).toBeNull()
    }
  })

  it('记录里没有这个引擎就报错，而不是默默算 0', () => {
    expect(() => scoreFor(record('o', 'A', 'B', 'black-win'), 'C')).toThrow()
  })
})

describe('汇总计数', () => {
  const sets = [
    pair(
      'o1',
      record('o1', 'A', 'B', 'black-win'), // A 执黑胜
      record('o1', 'B', 'A', 'white-win'), // A 执白胜
    ),
    pair(
      'o2',
      record('o2', 'A', 'B', 'draw'),
      record('o2', 'B', 'A', 'black-win'), // B 执黑胜
    ),
    pair(
      'o3',
      record('o3', 'A', 'B', 'move-limit'),
      record('o3', 'B', 'A', 'engine-error'),
    ),
  ]

  it('各项计数与手算一致', () => {
    const t = tally(sets, 'A')
    expect(t.games).toBe(6)
    expect(t.scored).toBe(4)
    expect(t.aWins).toBe(2)
    expect(t.bWins).toBe(1)
    expect(t.draws).toBe(1)
    expect(t.moveLimit).toBe(1)
    expect(t.engineError).toBe(1)
  })

  it('得分率只除以计分局数', () => {
    const summary = summarize(sets, 'A', 'B')
    // (1 + 1 + 0.5 + 0) / 4 = 0.625
    expect(summary.scoreRate).toBeCloseTo(0.625, 10)
  })

  it('先后手分开统计', () => {
    const summary = summarize(sets, 'A', 'B')
    // A 执黑：胜 + 和 + 未完成 → 计分 2 局，得 1.5 分
    expect(summary.asBlack.games).toBe(2)
    expect(summary.asBlack.scoreRate).toBeCloseTo(0.75, 10)
    // A 执白：胜 + 负 → 计分 2 局，得 1 分
    expect(summary.asWhite.games).toBe(2)
    expect(summary.asWhite.scoreRate).toBeCloseTo(0.5, 10)
  })

  it('逐开局汇总', () => {
    const summary = summarize(sets, 'A', 'B')
    const o1 = summary.perOpening.find((row) => row.opening === 'o1')!
    expect(o1.aScoreRate).toBe(1)
    const o2 = summary.perOpening.find((row) => row.opening === 'o2')!
    expect(o2.aScoreRate).toBe(0.25)
  })
})

describe('置信区间', () => {
  it('同一份数据、同一个种子给出相同区间', () => {
    const sets = [
      pair('o1', record('o1', 'A', 'B', 'black-win'), record('o1', 'B', 'A', 'white-win')),
      pair('o2', record('o2', 'A', 'B', 'black-win'), record('o2', 'B', 'A', 'black-win')),
    ]
    const first = bootstrapScoreRate(sets, 'A', { seed: 42, samples: 500 })
    const second = bootstrapScoreRate(sets, 'A', { seed: 42, samples: 500 })
    expect(first).toEqual(second)
  })

  it('全胜时区间收敛到 1', () => {
    const sets = [
      pair('o1', record('o1', 'A', 'B', 'black-win'), record('o1', 'B', 'A', 'white-win')),
    ]
    const ci = bootstrapScoreRate(sets, 'A', { seed: 1, samples: 200 })
    expect(ci?.low).toBe(1)
    expect(ci?.high).toBe(1)
  })

  it('没有计分局时返回 null', () => {
    const sets = [pair('o1', record('o1', 'A', 'B', 'move-limit'), record('o1', 'B', 'A', 'aborted'))]
    expect(bootstrapScoreRate(sets, 'A')).toBeNull()
  })
})

describe('描述性 Elo', () => {
  it('五五开为 0', () => {
    expect(descriptiveElo(0.5)).toBeCloseTo(0, 10)
  })

  it('全胜 / 全负没有有限值', () => {
    expect(descriptiveElo(1)).toBeNull()
    expect(descriptiveElo(0)).toBeNull()
  })

  it('得分率越高差值越大', () => {
    expect(descriptiveElo(0.75)!).toBeGreaterThan(0)
    expect(descriptiveElo(0.25)!).toBeLessThan(0)
  })
})

describe('搜索指标', () => {
  it('阶段划分的边界', () => {
    expect(phaseOf(0)).toBe('opening')
    expect(phaseOf(19)).toBe('opening')
    expect(phaseOf(20)).toBe('middle')
    expect(phaseOf(59)).toBe('middle')
    expect(phaseOf(60)).toBe('end')
  })

  it('按引擎拆开统计，不把对手的节点算进来', () => {
    const game = record('o1', 'A', 'B', 'white-win', [
      { engine: 'A', nodes: 100, depth: 3 },
      { engine: 'B', nodes: 10, depth: 1 },
      { engine: 'A', nodes: 300, depth: 5, reason: 'timeout' },
    ])
    const sets = [pair('o1', game, record('o1', 'B', 'A', 'black-win', []))]

    const stats = searchStats(sets, 'A')
    expect(stats.moves).toBe(2)
    expect(stats.avgNodes).toBe(200)
    expect(stats.maxNodes).toBe(300)
    expect(stats.avgDepth).toBe(4)
    expect(stats.timeouts).toBe(1)
    expect(stats.searched).toBe(1)
  })

  it('捷径与搜索分开计数', () => {
    const game = record('o1', 'A', 'B', 'white-win', [
      { engine: 'A', nodes: 0, depth: 0, reason: 'win' },
      { engine: 'B', nodes: 1, depth: 1 },
      { engine: 'A', nodes: 0, depth: 0, reason: 'block' },
      { engine: 'B', nodes: 1, depth: 1 },
      { engine: 'A', nodes: 500, depth: 4 },
    ])
    const stats = searchStats([pair('o1', game, record('o1', 'B', 'A', 'black-win', []))], 'A')

    expect(stats.shortcuts).toBe(2)
    expect(stats.searched).toBe(1)
  })
})
