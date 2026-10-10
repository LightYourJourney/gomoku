import { describe, expect, it } from 'vitest'
import { BLACK, type Board } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import {
  AVAILABLE_DIFFICULTIES,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DIFFICULTY_PARAMS,
  isDifficulty,
} from './difficulty'
import { chooseMove } from './search'

function ask(board: Board, difficulty: (typeof DIFFICULTIES)[number]) {
  return chooseMove({
    requestId: 1,
    gameVersion: 0,
    board,
    player: BLACK,
    difficulty,
    // 预算给足，让深度成为约束，避免结果依赖机器快慢
    budgetMs: 30_000,
    purpose: 'play',
  })
}

describe('难度参数表', () => {
  it('五档的时间预算递增', () => {
    const budgets = DIFFICULTIES.map((d) => DIFFICULTY_PARAMS[d].budgetMs)

    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]!).toBeGreaterThan(budgets[i - 1]!)
    }
  })

  it('候选宽度随难度单调不减', () => {
    const widths = DIFFICULTIES.map((d) => DIFFICULTY_PARAMS[d].width)

    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!)
    }
  })

  it('算杀手数随难度单调不减，且只有入门与初级为 0', () => {
    const plies = DIFFICULTIES.map((d) => DIFFICULTY_PARAMS[d].threatPlies)

    expect(DIFFICULTY_PARAMS.beginner.threatPlies).toBe(0)
    expect(DIFFICULTY_PARAMS.easy.threatPlies).toBe(0)
    for (let i = 1; i < plies.length; i++) {
      expect(plies[i]!).toBeGreaterThanOrEqual(plies[i - 1]!)
    }
    expect(DIFFICULTY_PARAMS.medium.threatPlies).toBeGreaterThan(0)
  })

  it('活三算杀（VCT）默认全档关闭', () => {
    // 实测结论：打开 VCT 后专家档从 32 ms/手 涨到 500 ms/手（15 倍），
    // 而它相对 VCF 的增量收益没能被证实——构成的对照组局面里，VCF 已经
    // 覆盖了「活三成活四」这条线。能力保留在 ai/threat.ts 里并有独立测试，
    // 但默认不启用。详见 docs/AI_ENGINE.md。
    for (const difficulty of DIFFICULTIES) {
      expect(DIFFICULTY_PARAMS[difficulty].threatThrees).toBe(false)
    }
  })

  it('AVAILABLE_DIFFICULTIES 覆盖全部五档', () => {
    expect([...AVAILABLE_DIFFICULTIES].sort()).toEqual([...DIFFICULTIES].sort())
  })

  it('每一档都有中文名，且都能通过 isDifficulty 校验（存档兼容）', () => {
    for (const difficulty of DIFFICULTIES) {
      expect(DIFFICULTY_LABELS[difficulty]).toBeTruthy()
      expect(isDifficulty(difficulty)).toBe(true)
    }
  })
})

describe('难度差异是真实的行为差异', () => {
  /** 活三：补上任何一端都成两端开口的四，三步取胜。 */
  const OPEN_THREE = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '...BBB.........',
  ])

  it('中级靠算杀直接判定取胜，初级只能给出搜索结果', () => {
    // 这是难度参数里最要紧的一条差异：算杀开关真的改变结论，
    // 而不只是让同一个搜索跑得久一点。
    const easy = ask(OPEN_THREE, 'easy')
    const medium = ask(OPEN_THREE, 'medium')

    expect(easy.reason).toBe('search')
    expect(medium.reason).toBe('win')
    expect(medium.confidence).toBe('exact')
  })

  it('三档以上的算杀结论一致：都判定为胜', () => {
    for (const difficulty of ['medium', 'hard', 'expert'] as const) {
      expect(ask(OPEN_THREE, difficulty).reason).toBe('win')
    }
  })

  it('关闭算杀的两档给出的是同一个着法', () => {
    // 两档都不做算杀，深度也只差一层，在这个局面上应当看到同一手
    expect(ask(OPEN_THREE, 'beginner').move).toEqual(ask(OPEN_THREE, 'easy').move)
  })

  it('五档都能在各自预算内给出合法着法', () => {
    for (const difficulty of DIFFICULTIES) {
      const result = ask(OPEN_THREE, difficulty)
      expect(result.move).not.toBeNull()
      expect(OPEN_THREE[result.move!.y * 15 + result.move!.x]).toBe(0)
    }
  })
})
