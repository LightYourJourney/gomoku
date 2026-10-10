import { describe, expect, it } from 'vitest'
import { applyMove, createGame } from '../core/game'
import { BLACK, WHITE, type Player, type Point } from '../core/types'
import { DIFFICULTY_PARAMS } from './difficulty'
import { searchBoard } from './search'
import type { Difficulty } from './types'

/**
 * 固定时钟：时间预算永远不生效，**深度成为唯一约束**。
 *
 * 这是自对弈测试可复现的前提。按真实时间搜索时，超时命中哪一层依机器快慢
 * 而定，同一份代码在两台机器上会走出不同的棋谱，断言就成了掷骰子。
 */
const CLOCK = (): number => 0
const BUDGET = 1_000_000

/** 自对弈把深度压到 3，纯粹为了控制测试时长；档位差异靠算杀开关体现。 */
const MAX_DEPTH = 3
const MAX_MOVES = 60

interface GameOutcome {
  readonly winner: Player | null
  readonly moves: readonly Point[]
}

function playGame(black: Difficulty, white: Difficulty, opening: readonly Point[]): GameOutcome {
  let state = createGame()

  for (const move of opening) {
    const applied = applyMove(state, move)
    if (!applied.ok) throw new Error(`开局手顺非法：${applied.error}`)
    state = applied.state
  }

  while (state.status === 'playing' && state.moves.length < MAX_MOVES) {
    const params = DIFFICULTY_PARAMS[state.current === BLACK ? black : white]
    const outcome = searchBoard(
      state.board,
      state.current,
      {
        width: params.width,
        maxDepth: Math.min(params.depth, MAX_DEPTH),
        budgetMs: BUDGET,
        transposition: true,
        threatPlies: params.threatPlies,
        threatThrees: params.threatThrees,
      },
      CLOCK,
    )

    // 引擎的任何一步都必须是合法的——这是最硬的一条底线
    expect(outcome.move).not.toBeNull()
    const applied = applyMove(state, outcome.move!)
    if (!applied.ok) throw new Error(`引擎给出非法着法：${applied.error}`)
    state = applied.state
  }

  return { winner: state.winner, moves: state.moves }
}

/** 四个不同开局：黑棋下天元，白棋应手各不相同。 */
const OPENINGS: readonly (readonly Point[])[] = [
  [{ x: 7, y: 7 }, { x: 7, y: 8 }],
  [{ x: 7, y: 7 }, { x: 8, y: 8 }],
  [{ x: 7, y: 7 }, { x: 6, y: 6 }],
  [{ x: 7, y: 7 }, { x: 8, y: 6 }],
]

describe('引擎自对弈', () => {
  it('高级在四个不同开局下至少赢下入门三局', () => {
    const wins = OPENINGS.filter((opening) => playGame('hard', 'beginner', opening).winner === BLACK)

    // 不断言「必然全胜」——棋类对局有偶然性。若这里达不到多数优势，
    // 说明难度参数没拉开差距，该回头调参数而不是放宽断言。
    expect(wins.length).toBeGreaterThanOrEqual(3)
  }, 120_000)

  it('同一难度自对弈时，不同开局会走出不同棋局', () => {
    const first = playGame('medium', 'medium', OPENINGS[0]!)
    const second = playGame('medium', 'medium', OPENINGS[1]!)

    // 没有这一条，「四个开局跑了四局」可能其实只跑了一局
    expect(first.moves).not.toEqual(second.moves)
  }, 120_000)

  it('自对弈结果可复现：同一开局跑两次得到完全相同的棋谱', () => {
    const first = playGame('medium', 'hard', OPENINGS[0]!)
    const second = playGame('medium', 'hard', OPENINGS[0]!)

    expect(first.moves).toEqual(second.moves)
    expect(first.winner).toBe(second.winner)
  }, 120_000)

  it('五档都能走完一整局，且全程不产生非法着法', () => {
    const tiers: readonly Difficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert']

    for (const tier of tiers) {
      const game = playGame(tier, tier, OPENINGS[0]!)
      expect(game.moves.length).toBeGreaterThan(4)
    }
  }, 180_000)

  it('同一难度自对弈时白棋不会凭空取胜', () => {
    const game = playGame('easy', 'easy', OPENINGS[0]!)

    // 这条是在钉「引擎没有随手把胜利判给某一方」这个最基本的正确性
    if (game.winner === WHITE) {
      expect(game.moves.length % 2).toBe(0)
    }
  }, 120_000)
})
