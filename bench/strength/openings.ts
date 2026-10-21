import { replay, type GameState } from '../../src/core/game'
import type { Point } from '../../src/core/types'

/**
 * 对局开局集。
 *
 * ## 为什么开局是**手顺**而不是棋盘
 *
 * 棋盘快照能表示「某局面」，但表示不了「它是怎么走到这里的」——而合法性、
 * 轮次、是否有历史胜负都只能从手顺重建（`core/game.ts` 里 `replay()` 是唯一
 * 构造路径）。用棋盘直接造局面等于绕过规则层，非法局面会悄悄混进评测。
 *
 * ## 为什么不能只有一个中心开局
 *
 * 五子棋先手优势显著。只用一个开局，配对赛实际上只测了「一种白棋应法」，
 * 换一个应法结论就可能翻转。这里的开局覆盖：贴身、斜向、马步、远角、
 * 非中心首手，以及两手之后的分叉。
 *
 * ## 固定且可追溯
 *
 * 这份列表是**实验的一部分**：改动它等于换了一组实验，历史结果不能直接比。
 * 报告会记录开局集的 id 与内容。
 */
export interface MatchOpening {
  readonly id: string
  readonly moves: readonly Point[]
  readonly source: string
  readonly note: string
}

export const OPENINGS: readonly MatchOpening[] = [
  {
    id: 'center-adjacent',
    moves: [{ x: 7, y: 7 }, { x: 7, y: 8 }],
    source: '复用 src/ai/selfplay.test.ts',
    note: '白贴身应一手：最常见的应法。',
  },
  {
    id: 'center-diagonal',
    moves: [{ x: 7, y: 7 }, { x: 8, y: 8 }],
    source: '复用 src/ai/selfplay.test.ts',
    note: '白斜向应手：棋盘对称性最容易被误判的一类。',
  },
  {
    id: 'center-knight',
    moves: [{ x: 7, y: 7 }, { x: 8, y: 6 }],
    source: '复用 src/ai/selfplay.test.ts',
    note: '白马步应手：拉开距离，早盘威胁更少。',
  },
  {
    id: 'center-far',
    moves: [{ x: 7, y: 7 }, { x: 5, y: 5 }],
    source: '构造',
    note: '白远角应手：黑有两处开放方向，先手优势被放大。',
  },
  {
    id: 'offset-first',
    moves: [{ x: 6, y: 7 }, { x: 7, y: 7 }],
    source: '构造',
    note: '黑首手不在天元：检验评测器没有把「天元开局」写死。',
  },
  {
    id: 'branch-a',
    moves: [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 8, y: 8 }, { x: 6, y: 6 }],
    source: '构造',
    note: '四手：双方各两子，开始出现斜向结构。',
  },
  {
    id: 'branch-b',
    moves: [{ x: 7, y: 7 }, { x: 8, y: 8 }, { x: 8, y: 7 }, { x: 6, y: 6 }],
    source: '构造',
    note: '四手：与 branch-a 不同的分叉，白棋更贴中心。',
  },
  {
    id: 'three-each',
    moves: [
      { x: 7, y: 7 }, { x: 7, y: 8 }, { x: 6, y: 7 },
      { x: 8, y: 8 }, { x: 8, y: 7 }, { x: 5, y: 7 },
    ],
    source: '构造',
    /*
     * 六手、双方各三子：中盘的起点，避免开局阶段全是捷径着法。
     *
     * 白第 6 手必须堵在 (5,7)。原先下在 (6,6)，于是黑棋在 (6,7)(7,7)(8,7)
     * 留下**两端全开的活三**、且轮到黑走——这已经是黑棋的强制胜（证明器给出
     * 首手 (5,7)）。换色只会决定谁执黑，谁执黑谁白拿一分，整组实验的得分率
     * 会被压向 50%。`positions.test.ts` 有一条不变量专门拦这种开局。
     */
    note: '六手、双方各三子：中盘的起点；白第 6 手堵住黑棋的活三，避免开局必胜。',
  },
]

/**
 * 把开局手顺还原成局面。
 *
 * 合法性、是否已经分出胜负都在这里拦住：一个「开局就五连」或「重复落子」的
 * 开局会让整组实验的结论失去意义，而且这种错误在报告里看不出来。
 */
export function openingState(opening: MatchOpening): GameState {
  const state = replay(opening.moves)

  if (state.moves.length !== opening.moves.length) {
    throw new Error(`开局 ${opening.id} 含非法手顺：只重放出 ${state.moves.length}/${opening.moves.length} 手`)
  }
  if (state.status !== 'playing') {
    throw new Error(`开局 ${opening.id} 已经结束（${state.status}），不能作为对局起点`)
  }

  return state
}
