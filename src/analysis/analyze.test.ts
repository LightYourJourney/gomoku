import { describe, expect, it } from 'vitest'
import type { Point } from '../core/types'
import { WIN_SCORE } from '../ai/types'
import { ENGINE_VERSION } from '../ai/version'
import {
  buildSummary,
  buildVerdict,
  cacheKey,
  horizonLoss,
  pathLabel,
  verdictLabel,
  type AfterMove,
  type MoveVerdict,
} from './analyze'

const AT: Point = { x: 7, y: 7 }
const AWAY: Point = { x: 3, y: 3 }

const searched = (score: number): AfterMove => ({ score, reason: 'search' })

function verdict(overrides: Partial<Parameters<typeof buildVerdict>[0]> = {}): MoveVerdict {
  return buildVerdict({
    moveIndex: 0,
    played: AT,
    engineMove: AT,
    isWinningMove: false,
    afterPlayed: null,
    afterEngine: null,
    reason: 'search',
    engineDepth: 2,
    engineNodes: 100,
    ...overrides,
  })
}

/** 着法与引擎不同、同视界分差恰为 `loss` 的一手。 */
function losing(loss: number, overrides: Partial<Parameters<typeof buildVerdict>[0]> = {}): MoveVerdict {
  return verdict({ engineMove: AWAY, afterPlayed: searched(loss), afterEngine: searched(0), ...overrides })
}

describe('buildVerdict', () => {
  it('与引擎一致时 loss 为 0', () => {
    expect(verdict().loss).toBe(0)
  })

  it('着法不同：loss 是两种走法之后的对手评分之差', () => {
    const result = verdict({ engineMove: AWAY, afterPlayed: searched(800), afterEngine: searched(300) })
    expect(result.loss).toBe(500)
  })

  it('实际着法之后对手反而更难受时 loss 钳到 0', () => {
    const result = verdict({ engineMove: AWAY, afterPlayed: searched(300), afterEngine: searched(900) })
    expect(result.loss).toBe(0)
  })

  it('两边评分不可比时 loss 为 null——没有算，不是没有亏损', () => {
    const result = verdict({
      engineMove: AWAY,
      afterPlayed: { score: 1_000_000, reason: 'block' },
      afterEngine: searched(0),
    })
    expect(result.loss).toBeNull()
  })

  it('终局手 loss 恒 0——赢棋不存在亏损', () => {
    const result = verdict({ engineMove: AWAY, isWinningMove: true })
    expect(result.loss).toBe(0)
  })

  it('如实带出引擎的深度与节点数', () => {
    const result = verdict({ engineDepth: 4, engineNodes: 1234 })
    expect(result.engineDepth).toBe(4)
    expect(result.engineNodes).toBe(1234)
  })
})

describe('buildSummary', () => {
  it('按 loss 降序取前 3', () => {
    const verdicts = [
      losing(100, { moveIndex: 0 }),
      verdict({ moveIndex: 1 }), // 与引擎一致 → 不入榜
      losing(800, { moveIndex: 2 }),
      losing(50, { moveIndex: 3 }),
      losing(500, { moveIndex: 4 }),
    ]

    const summary = buildSummary(verdicts)

    expect(summary.moveVerdicts).toHaveLength(5)
    expect(summary.topLosses.map((entry) => entry.moveIndex)).toEqual([2, 4, 0])
  })

  it('不足 3 条时有多少取多少', () => {
    const summary = buildSummary([losing(400)])
    expect(summary.topLosses).toHaveLength(1)
  })

  it('没算出分差的手不进亏损榜，也不打乱排序', () => {
    const uncomputed = verdict({ moveIndex: 1, engineMove: AWAY }) // 两边都缺 → null
    expect(uncomputed.loss).toBeNull()

    const summary = buildSummary([losing(100, { moveIndex: 0 }), uncomputed, losing(800, { moveIndex: 2 })])

    expect(summary.moveVerdicts).toHaveLength(3)
    expect(summary.topLosses.map((entry) => entry.moveIndex)).toEqual([2, 0])
  })
})

describe('verdictLabel', () => {
  it('着法与引擎首选相同 → 与引擎一致', () => {
    expect(verdictLabel(verdict())).toBe('与引擎一致')
  })

  it('着法不同但分差为 0 → 与引擎首选相当，**不说「一致」**', () => {
    // 着法明明不同，说「一致」是误导——哪怕两种走法之后的评分一模一样。
    const label = verdictLabel(losing(0))
    expect(label).toBe('与引擎首选相当')
    expect(label).not.toContain('一致')
  })

  it('小分差 → 分差约 N 子（粗略换算）', () => {
    expect(verdictLabel(losing(20_000))).toBe('分差约 2 子')
  })

  it('半子以下的亏损 → 不说「分差约 0 子」', () => {
    // `buildSummary` 只把 loss > 0 的手排进「亏损最多」，而一个活三在
    // shapeScore 里是 800——`Math.round(800 / 10_000)` 得 0，榜单上会出现
    // 「关键手：分差约 0 子」这种自相矛盾的说法。
    const label = verdictLabel(losing(800))
    expect(label).toBe('分差很小（不足 1 子）')
    expect(label).not.toContain('0 子')
  })

  it('大分差 → 分差极大——不声称「错过取胜」', () => {
    // 玩家可能本来就没有胜机（例如该防没防、局面直接崩），
    // 说「错过直接取胜」是在编造一个当时并不存在的机会。
    const label = verdictLabel(losing(WIN_SCORE))
    expect(label).toBe('分差极大')
    expect(label).not.toContain('错过')
  })

  it('没算出分差 → 未算分差——不说成「相当」或「一致」', () => {
    const label = verdictLabel(verdict({ engineMove: AWAY }))
    expect(label).toBe('未算分差')
  })

  it('着法相同时仍说「与引擎一致」，哪怕没有任何后续评分', () => {
    // 「一致」是着法上的事实，不依赖评分；它必须排在「未算分差」之前判断。
    expect(verdictLabel(verdict({ afterPlayed: null, afterEngine: null }))).toBe('与引擎一致')
  })

  it('任何文案都不含「失误」——不设固定档位', () => {
    for (const loss of [0, 1, 5_000, 30_000, WIN_SCORE - 1]) {
      expect(verdictLabel(losing(loss))).not.toContain('失误')
    }
    expect(verdictLabel(verdict({ engineMove: AWAY }))).not.toContain('失误')
  })
})

describe('cacheKey', () => {
  const base = cacheKey('a', 'easy', 400)

  it('换档位 / 预算 / 局面都产生不同的键', () => {
    expect(cacheKey('a', 'medium', 400)).not.toBe(base)
    expect(cacheKey('a', 'easy', 800)).not.toBe(base)
    expect(cacheKey('b', 'easy', 400)).not.toBe(base)
  })

  it('同参数幂等', () => {
    expect(cacheKey('a', 'easy', 400)).toBe(base)
  })

  it('键掺引擎版本——换 ENGINE_VERSION 必须重算', () => {
    expect(base.startsWith(`v2:${ENGINE_VERSION}:`)).toBe(true)
  })
})

describe('着法相同即无亏损（捷径评分与真实评估不可比）', () => {
  it('与引擎首选相同时 loss 恒 0，哪怕两个评分来自不同量纲', () => {
    // 真引擎实测：必胜/必防走的是捷径（±WIN_SCORE 量纲），
    // 而「走完之后」的评分来自真实评估——两者相减没有意义。
    // 着法都相同了，说自己亏了 98 万是荒谬的。
    const result = verdict({
      afterPlayed: searched(12_000),
      afterEngine: { score: 1_000_000, reason: 'block' },
      engineDepth: 0,
      engineNodes: 0,
    })
    expect(result.loss).toBe(0)
  })

  it('亏损榜不含着法与引擎一致的着手', () => {
    const verdicts = [
      // 着法相同：就算有人把两个差得很远的评分塞进来，也不算亏
      verdict({ moveIndex: 0, afterPlayed: searched(1_000_000), afterEngine: searched(1) }),
      losing(800, { moveIndex: 1 }),
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
})

describe('horizonLoss —— 同视界分差', () => {
  it('两边都搜满：对手在实际着法之后更好受多少，就亏多少', () => {
    expect(horizonLoss(searched(800), searched(300))).toBe(500)
  })

  it('实际着法反而更好时钳到 0，不出现负亏损', () => {
    expect(horizonLoss(searched(300), searched(800))).toBe(0)
  })

  it('同一个局面比自己恒为 0——这条口径不靠「着法相同」特判也自洽', () => {
    // −14,200 是旧口径在引擎自对弈上的偏差中位数（`yarn bench:review-loss` 第一项）
    expect(horizonLoss(searched(-14_200), searched(-14_200))).toBe(0)
  })

  it('引擎首选当场成五：对手已经输了，按 −WIN_SCORE 计', () => {
    expect(horizonLoss(searched(100), 'ended')).toBe(WIN_SCORE + 100)
  })

  it('实际着法之后对手有必胜（win）：与常规搜索同一量纲，可以相减', () => {
    expect(horizonLoss({ score: WIN_SCORE, reason: 'win' }, searched(0))).toBe(WIN_SCORE)
  })

  it.each(['block', 'timeout', 'opening', 'no_move'] as const)(
    '任一边是 %s：分数不在同一把尺子上，不算',
    (reason) => {
      expect(horizonLoss({ score: 5, reason }, searched(0))).toBeNull()
      expect(horizonLoss(searched(0), { score: 5, reason })).toBeNull()
    },
  )

  it('任一边缺失：不算', () => {
    expect(horizonLoss(null, searched(0))).toBeNull()
    expect(horizonLoss(searched(0), null)).toBeNull()
  })
})
