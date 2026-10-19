import { describe, expect, it } from 'vitest'
import type { Point } from '../core/types'
import { WIN_SCORE } from '../ai/types'
import { ENGINE_VERSION } from '../ai/version'
import { buildSummary, buildVerdict, cacheKey, pathLabel, pathSummary, verdictLabel, type MoveVerdict } from './analyze'

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
    reason: 'search',
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
    const result = verdict({ engineMove: { x: 3, y: 3 }, engineScore: 800, playedScore: 300 })
    expect(result.loss).toBe(500)
  })

  it('playedScore 高于 engineScore（防御分支）时 loss 钳到 0', () => {
    const result = verdict({ engineMove: { x: 3, y: 3 }, engineScore: 300, playedScore: 900 })
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
    const away = { x: 3, y: 3 }
    const verdicts = [
      verdict({ moveIndex: 0, engineMove: away, engineScore: 100, playedScore: 0 }), // loss 100
      verdict({ moveIndex: 1, engineScore: 0, playedScore: 0 }), // 与引擎一致 → 不入榜
      verdict({ moveIndex: 2, engineMove: away, engineScore: 900, playedScore: 100 }), // loss 800
      verdict({ moveIndex: 3, engineMove: away, engineScore: 500, playedScore: 450 }), // loss 50
      verdict({ moveIndex: 4, engineMove: away, engineScore: 700, playedScore: 200 }), // loss 500
    ]

    const summary = buildSummary(verdicts)

    expect(summary.moveVerdicts).toHaveLength(5)
    expect(summary.topLosses.map((entry) => entry.moveIndex)).toEqual([2, 4, 0])
  })

  it('不足 3 条时有多少取多少', () => {
    const summary = buildSummary([
      verdict({ moveIndex: 0, engineMove: { x: 3, y: 3 }, engineScore: 500, playedScore: 100 }),
    ])
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

  it('半子以下的亏损 → 不说「分差约 0 子」', () => {
    // `buildSummary` 只把 loss > 0 的手排进「亏损最多」，而一个活三在
    // shapeScore 里是 800——`Math.round(800 / 10_000)` 得 0，榜单上会出现
    // 「关键手：分差约 0 子」这种自相矛盾的说法。
    const label = verdictLabel(
      verdict({ engineScore: 800, playedScore: 0, engineMove: { x: 3, y: 3 } }),
    )
    expect(label).toBe('分差很小（不足 1 子）')
    expect(label).not.toContain('0 子')
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

describe('着法相同即无亏损（捷径评分与真实评估不可比）', () => {
  it('与引擎首选相同时 loss 恒 0，哪怕两个评分来自不同量纲', () => {
    // 真引擎实测：必胜/必防走的是捷径（±WIN_SCORE 量纲），
    // 而「走完之后」的评分来自真实评估——两者相减没有意义。
    // 着法都相同了，说自己亏了 98 万是荒谬的。
    const result = buildVerdict({
      moveIndex: 0,
      played: AT,
      engineMove: AT,
      engineScore: 1_000_000,
      playedScore: 12_000,
      isWinningMove: false,
      confidence: 'exact',
      reason: 'search',
      engineDepth: 0,
      engineNodes: 0,
    })
    expect(result.loss).toBe(0)
  })

  it('亏损榜不含着法与引擎一致的着手', () => {
    const verdicts = [
      buildVerdict({ moveIndex: 0, played: AT, engineMove: AT, engineScore: 1_000_000, playedScore: 1, isWinningMove: false, confidence: 'exact', reason: 'search', engineDepth: 0, engineNodes: 0 }),
      buildVerdict({ moveIndex: 1, played: { x: 1, y: 1 }, engineMove: { x: 2, y: 2 }, engineScore: 900, playedScore: 100, isWinningMove: false, confidence: 'exact', reason: 'search', engineDepth: 2, engineNodes: 50 }),
    ]

    const summary = buildSummary(verdicts)

    expect(summary.moveVerdicts).toHaveLength(2)
    expect(summary.topLosses.map((v) => v.moveIndex)).toEqual([1])
  })
})


describe('搜索路径的语义（Phase 09A）', () => {
  it('buildVerdict 原样带出引擎的 reason——不靠 depth/nodes 反推', () => {
    expect(verdict({ reason: 'win' }).reason).toBe('win')
    expect(verdict({ reason: 'block' }).reason).toBe('block')
    expect(verdict({ reason: 'timeout' }).reason).toBe('timeout')
  })

  it('四类路径各有各的说法', () => {
    expect(pathLabel('search')).toBe('搜索完成')
    expect(pathLabel('shortcut')).toBe('规则/快速路径判定')
    expect(pathLabel('aborted')).toBe('预算内未搜完（启发式）')
    expect(pathLabel('none')).toBe('无可用着法')
  })

  it('快速路径与常规搜索不许混为一谈', () => {
    // 这条钉的正是 Phase 08 发现的那个缺陷：深度 0、节点 0 的规则判定
    // 仍然写着「搜索完成」。
    expect(pathLabel('shortcut')).not.toContain('搜索完成')
    expect(pathLabel('shortcut')).not.toBe(pathLabel('search'))
  })

  it('pathSummary：路径与可靠度正交，启发式结论必须补在路径后面', () => {
    // 回归：首选搜索完成、但后续一手超时，`verdict.confidence` 是 heuristic。
    // 只写 pathLabel 会让同一张卡片上出现「搜索完成」与「（启发式）」两种说法。
    expect(pathSummary('search', 'exact')).toBe('搜索完成')
    expect(pathSummary('search', 'heuristic')).toBe('搜索完成 · 结论为启发式')
    expect(pathSummary('shortcut', 'heuristic')).toBe('规则/快速路径判定 · 结论为启发式')
    // `aborted` 的文案本身已含「启发式」，不再重复。
    expect(pathSummary('aborted', 'heuristic')).toBe('预算内未搜完（启发式）')
    expect(pathSummary('none', 'heuristic')).toBe('无可用着法')
  })
})
