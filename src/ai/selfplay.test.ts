import { describe, expect, it } from 'vitest'
import { applyMove, createGame } from '../core/game'
import { BLACK, WHITE, type GameStatus, type Player, type Point } from '../core/types'
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

/**
 * 自对弈把深度压到 3，纯粹为了控制测试时长。
 *
 * **代价要说清楚**：钳到 3 之后，中级（上限 4）、高级（6）、专家（8）三档在本文件里
 * 走出的棋完全一样（实测四个开局都是 13 手黑胜），自对弈因此**证明不了**它们之间有
 * 强弱差异。档位差异由 `difficulty.test.ts` 的参数与接线测试、以及 `yarn bench`
 * 的实测数据负责，不靠这里。
 */
const MAX_DEPTH = 3

/**
 * 手数上限。
 *
 * 60 手不够：实测「初级对初级」要 49–76 手才分胜负，60 手会把局面卡在
 * `status === 'playing'` 上，于是「走完一整局」这条断言根本断言不到东西。
 */
const MAX_MOVES = 120

/**
 * 第 `index` 手（0-based）由谁落子。
 *
 * 刻意不 import store 里的 `moverAt`：`ai` 不得依赖 `store`，测试也不例外。
 * 自对弈的开局方恒为黑，两行就够。
 */
function moverAt(index: number): Player {
  return index % 2 === 0 ? BLACK : WHITE
}

interface GameOutcome {
  readonly status: GameStatus
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
        attack: params.attack,
        defense: params.defense,
      },
      CLOCK,
    )

    // 引擎的任何一步都必须是合法的——这是最硬的一条底线
    expect(outcome.move).not.toBeNull()
    const applied = applyMove(state, outcome.move!)
    if (!applied.ok) throw new Error(`引擎给出非法着法：${applied.error}`)
    state = applied.state
  }

  return { status: state.status, winner: state.winner, moves: state.moves }
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

      // 必须断言「真的分出了结果」。原来只断言 moves.length > 4，而循环到
      // MAX_MOVES 就无条件退出——一局走到一半被截断也照样是绿的。
      expect(game.status).not.toBe('playing')
      expect(game.moves.length).toBeGreaterThan(4)
    }
  }, 300_000)

  it('四个开局下五档都能走完，没有哪一档被手数上限截断', () => {
    const tiers: readonly Difficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert']

    for (const opening of OPENINGS) {
      for (const tier of tiers) {
        const game = playGame(tier, tier, opening)
        expect(game.status).not.toBe('playing')
      }
    }
  }, 300_000)

  it('赢家一定是最后落子的那一方', () => {
    // 钉住「引擎没有把胜利判给错误的一方」。原来那条用例是
    // `if (winner === WHITE) expect(moves.length % 2 === 0)`——白棋没赢时什么都不查，
    // 白棋赢了查的又是规则蕴含式（白棋本就只在偶数手落子），两条路径都不会红。
    //
    // 现在遍历四个开局，把 winner 与「最后落子的人」正面比一次：
    // 若某处把 winner 错设成对手，这里立刻红。
    let decided = 0

    for (const opening of OPENINGS) {
      const game = playGame('medium', 'medium', opening)
      if (game.winner === null) continue

      decided++
      expect(game.winner).toBe(moverAt(game.moves.length - 1))
    }

    // 防止上面整段空转（全都没分胜负时它就成了一条永远绿的用例）
    expect(decided).toBeGreaterThan(0)
  }, 300_000)
})
