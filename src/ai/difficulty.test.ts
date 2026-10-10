import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, type Board } from '../core/types'
import { createBoard, idx } from '../core/board'
import { boardFromLines } from '../test/board-fixtures'
import {
  AVAILABLE_DIFFICULTIES,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DIFFICULTY_PARAMS,
  isDifficulty,
} from './difficulty'
import { chooseMove, searchBoard, searchOptionsFor } from './search'

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
    // 实测结论（`yarn bench` 的「VCF 与 VCT 的代价对照」一节）：VCT 比 VCF 贵
    // 38–520 倍，而在测过的三个局面上 VCF 都给出了同样的「有杀」结论——
    // VCT 一次都没换到 VCF 给不出的东西，其中一例还返回了更长的取胜路线。
    // 能力保留在 ai/threat.ts 里并有独立测试，但默认不启用。
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

describe('深度参数真的接到了搜索上', () => {
  // 冻结时钟 → 时间预算永不生效 → 深度上限成为唯一约束，结果与机器快慢无关。
  const CLOCK = (): number => 0
  const NO_LIMIT = 1_000_000

  /**
   * 一盘填满但留了六个空位的和棋局面。
   *
   * 用 `(x + 2y) % 4 < 2` 上色，四个方向上最长只连得出两颗子——**构造上就不存在五连**，
   * 所以既不会触发「必胜」也不会触发「必防」的捷径，搜索真的会跑起来。
   * 候选点只有那六个空位，树窄得很，深度 8 也能在毫秒级搜完；
   * 换成中盘局面则要 13 秒，不可能放进单元测试。
   */
  function nearlyFullDraw(): Board {
    const board = createBoard()
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        board[idx(x, y)] = (x + 2 * y) % 4 < 2 ? BLACK : WHITE
      }
    }
    for (const [x, y] of [[7, 7], [7, 8], [8, 7], [8, 8], [6, 6], [9, 9]] as const) {
      board[idx(x, y)] = 0
    }
    return board
  }

  function optionsFor(difficulty: (typeof DIFFICULTIES)[number], maxDepth: number) {
    return {
      ...searchOptionsFor(DIFFICULTY_PARAMS[difficulty], { budgetMs: NO_LIMIT }),
      maxDepth,
      threatPlies: 0,
    }
  }

  it('给足时间时，每一档都完整搜到自己的深度上限', () => {
    // 计划里要求的「同一局面下高档在相同**预算**内达到的深度不低于低档」
    // 刻意没有写成断言：那个性质依赖真实时钟，在不同机器上会 flaky，而且
    // 它在实测里并不总成立（见 docs/AI_ENGINE.md 的实测表——专家档宽度更大，
    // 同样一层展开的节点多得多，多出来的预算会被这一项吃掉）。
    //
    // 能确定性地断言、也确实值得断言的是**接线**：深度参数有没有真的传到搜索。
    const board = nearlyFullDraw()

    for (const difficulty of DIFFICULTIES) {
      const result = searchBoard(board, WHITE, optionsFor(difficulty, DIFFICULTY_PARAMS[difficulty].depth), CLOCK)

      expect(result.reason).toBe('search')
      expect(result.depth).toBe(DIFFICULTY_PARAMS[difficulty].depth)
    }
  })

  it('深度上限越高，实际搜到的层数越深', () => {
    const board = nearlyFullDraw()
    const depths = DIFFICULTIES.map(
      (difficulty) =>
        searchBoard(board, WHITE, optionsFor(difficulty, DIFFICULTY_PARAMS[difficulty].depth), CLOCK)
          .depth,
    )

    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]!).toBeGreaterThan(depths[i - 1]!)
    }
  })
})
