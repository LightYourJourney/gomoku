import type { Board, Player, Point } from '../../src/core/types'
import { formatBoardLines, parseBoardLines } from '../../src/lib/board-lines'
import { nearlyFullBoard } from '../../src/test/board-fixtures'

/**
 * AI 评测的标准局面库。
 *
 * ## 这里的「预期」不是「引擎应该走哪」
 *
 * 每个局面只声明**可以用规则独立证明的性质**（见 `Expect`）。原因很直接：
 * 如果拿引擎某次运行的输出当标准答案，再用同一份引擎去验收，那测的只是
 * 「引擎是否稳定复现自己」——它变强、变弱、错了，断言都照样绿。
 *
 * 局面本身的性质由 `proof.ts` 的独立证明器或 `core/rules.ts` 直接判定：
 * 是否已有五连、某一方是否有立即成五点、是否存在「我方走一步后对手无论如何
 * 应手我都还能成五」的强制胜。这些都不经过搜索引擎。
 *
 * ## 局面怎么来的
 *
 * - `构造`：为评测专门摆的，人工可复核，坐标写在注释里；
 * - `复用`：与 `src/ai/search.test.ts` / `threat.test.ts` / `bench/engine.bench.ts`
 *   同源的局面，保持跨文件一致。
 *
 * ## 测试数据不得偷偷混入非法局面
 *
 * `positions.test.ts` 会逐条验证：局面里没有五连、棋子数守恒（黑比白多 0 或 1）、
 * 声明的性质全部成立、id 唯一、类别覆盖齐全。确实要测非法局面时，
 * 不可由合法手顺到达的战术局面显式标 `synthetic`，且只用于战术探针。
 */

export type PositionCategory =
  /** 空盘 */
  | 'empty'
  /** 常规开局 */
  | 'opening'
  /** 安静中盘：双方都没有立即成五点 */
  | 'quiet'
  /** 当前方直接成五 */
  | 'direct-win'
  /** 必须防守的单一威胁 */
  | 'must-block'
  /** 多个直接胜点 */
  | 'multi-win'
  /** 活三 / 冲四 */
  | 'open-three'
  /** 双重威胁 */
  | 'double-threat'
  /** 可证明的强制胜（VCF 一类的短链） */
  | 'forced-win'
  /** 有威胁但不构成必胜的反例 */
  | 'threat-not-win'
  /** 同一局面、不同手顺（置换用） */
  | 'transposition'
  /** 临近满盘 / 终局边界 */
  | 'endgame'

/**
 * 局面性质。**每条都能不经过搜索引擎独立验证**：
 * - `opening-center`：空盘时唯一合理的第一步是天元（规则层：任何非中心点都由对称性等价，这里只验中心可下）。
 * - `wins-immediately`：存在一步让当前方成五。
 * - `blocks-all-losses`：对手至少有一步成五，当前方必须把这些点全部堵住。
 * - `only-non-losing-move`：对手只有一个成五点，且当前方自己没有成五点 → 只有这一点不立即输。
 * - `forced-win`：存在一步，此后**无论对手应手如何**，当前方仍有成五点（在手数内）。
 * - `no-immediate-win-for-either`：双方都没有一步成五。
 */
export type Expect =
  | { readonly kind: 'opening-center' }
  | { readonly kind: 'wins-immediately' }
  | { readonly kind: 'blocks-all-losses' }
  | { readonly kind: 'only-non-losing-move'; readonly point: Point }
  | { readonly kind: 'forced-win'; readonly plies: 3 }
  | { readonly kind: 'no-immediate-win-for-either' }

export interface BenchPosition {
  readonly id: string
  readonly category: PositionCategory
  /** 该谁走。 */
  readonly player: Player
  readonly lines: readonly string[]
  /** 来源说明：构造 / 复用自哪个文件。 */
  readonly source: string
  readonly expects: readonly Expect[]
  readonly note: string
  /**
   * 局面**不可由合法手顺到达**（子力数不平衡）。
   *
   * 这不是「非法棋盘」——格子合法、无五连；但它不是任何真实对局能走到的局面，
   * 因为真实对局黑白交替、子力数最多差一枚。战术局面（比如「黑有四子、白一子都没有」）
   * 天然属于这一类。
   *
   * 约束：`synthetic` 局面**只能用于战术探针**，不得作为对局起点——
   * 对局起点走 `openings.ts`，那里的每条手顺都由 `replay()` 验证过。
   */
  readonly synthetic?: true
}

const EMPTY_ROW = '...............'

/** 15 行空盘。 */
const EMPTY = Array.from({ length: 15 }, () => EMPTY_ROW)

/** 把若干行拼成完整 15 行（未写的行补空）。 */
function rows(partial: readonly string[]): string[] {
  return [...partial, ...Array.from({ length: 15 - partial.length }, () => EMPTY_ROW)]
}

export const POSITIONS: readonly BenchPosition[] = [
  {
    id: 'empty',
    category: 'empty',
    player: 1,
    lines: EMPTY,
    source: '构造',
    expects: [{ kind: 'opening-center' }],
    note: '空盘：走天元。这条同时也钉住「开局捷径不跑搜索」。',
  },
  {
    id: 'opening-adjacent',
    category: 'opening',
    player: 1,
    lines: rows(['', '', '', '', '', '', '', '.......B.......', '.......W.......']),
    source: '复用 src/ai/selfplay.test.ts 的开局',
    expects: [{ kind: 'no-immediate-win-for-either' }],
    note: '黑天元、白贴身应一手。',
  },
  {
    id: 'opening-diagonal',
    category: 'opening',
    player: 1,
    lines: rows(['', '', '', '', '', '', '', '.......B.......', '........W......']),
    source: '复用 src/ai/selfplay.test.ts 的开局',
    expects: [{ kind: 'no-immediate-win-for-either' }],
    note: '白斜向应手。',
  },
  {
    id: 'opening-knight',
    category: 'opening',
    player: 1,
    lines: rows(['', '', '', '', '', '', '........W......', '.......B.......']),
    source: '复用 src/ai/selfplay.test.ts 的开局',
    expects: [{ kind: 'no-immediate-win-for-either' }],
    note: '白马步应手。三条开局覆盖白棋三类常见应法。',
  },
  {
    id: 'quiet-midgame',
    category: 'quiet',
    player: 2,
    // 黑：(5,5) (7,4) (6,7) (8,7)；白：(7,3) (6,6) (7,6) (9,7)
    lines: rows([
      '',
      '',
      '',
      '.......W.......',
      '.......B.......',
      '.....B.....W...',
      '......WB.......',
      '....W.B.B......',
      '.......W.......',
    ]),
    source: '构造',
    expects: [{ kind: 'no-immediate-win-for-either' }],
    note: '双方各四子、都不成四，用来量「安静局面下的搜索深度与节点数」。',
  },
  {
    id: 'direct-win-open',
    category: 'direct-win',
    player: 1,
    lines: rows(['', '', '', '', '', '', '', '.....BBBB......']),
    synthetic: true,
    source: '复用 bench/engine.bench.ts 的思路',
    expects: [{ kind: 'wins-immediately' }],
    note: '黑横四、两端全开：两处都能成五，走哪边都对。',
  },
  {
    id: 'rush-four',
    category: 'open-three',
    player: 1,
    // 白堵住左端，只剩 (10,7)
    lines: rows(['', '', '', '', '', '', '', '.....WBBBB.....']),
    synthetic: true,
    source: '构造（冲四）',
    expects: [{ kind: 'wins-immediately' }],
    note: '冲四：只有 (10,7) 能成五。用来验证引擎不把「有四」当成「随便走」。',
  },
  {
    id: 'must-block-single',
    category: 'must-block',
    player: 1,
    // 白四个 (5,7)-(8,7)，黑占 (4,7)，白只有 (9,7) 能成五
    lines: rows(['', '', '', '', '', '', '', '....BWWWW......']),
    synthetic: true,
    source: '构造',
    expects: [{ kind: 'only-non-losing-move', point: { x: 9, y: 7 } }],
    note: '单一威胁：黑若不堵 (9,7) 立刻输。',
  },
  {
    id: 'must-block-double',
    category: 'must-block',
    player: 1,
    // 白横四 (4,7)-(7,7) 两端开 → (3,7) (8,7) 都能成五；黑堵不住全部
    lines: rows(['', '', '', '', '', '', '', '....WWWW.......']),
    synthetic: true,
    source: '构造',
    expects: [{ kind: 'blocks-all-losses' }],
    note: '活四：黑只能堵一头，另一头仍输。用来观察引擎在必败局面的选择（不是断言它「走对了」）。',
  },
  {
    id: 'multi-win',
    category: 'multi-win',
    player: 1,
    // 横四 (5,7)-(8,7) 两端开；竖四 (11,3)-(11,6) 也两端开
    lines: rows([
      '',
      '',
      '',
      '...........B...',
      '...........B...',
      '...........B...',
      '...........B...',
      '.....BBBB......',
    ]),
    synthetic: true,
    source: '构造',
    expects: [{ kind: 'wins-immediately' }],
    note: '四个成五点，任选其一即可。验证「多胜点时不必只认一个坐标」。',
  },
  {
    id: 'open-three',
    category: 'open-three',
    player: 1,
    // 黑 (6,7)-(8,7)，两端空
    lines: rows(['', '', '', '', '', '', '', '......BBB......']),
    synthetic: true,
    source: '复用 src/ai/threat.test.ts 的 OPEN_THREE',
    expects: [
      { kind: 'no-immediate-win-for-either' },
      { kind: 'forced-win', plies: 3 },
    ],
    note: '活三：当前方没有立即成五点，但存在强制胜（做出活四后对手堵不完）。',
  },
  {
    id: 'double-threat',
    category: 'double-threat',
    player: 1,
    // 横 (6,7)-(8,7) + 竖 (7,5)-(7,7)
    lines: rows([
      '',
      '',
      '',
      '',
      '',
      '.......B.......',
      '.......B.......',
      '......BBB......',
    ]),
    synthetic: true,
    source: '构造',
    expects: [{ kind: 'forced-win', plies: 3 }],
    note: '十字双三：任一端做出活四都是强制胜。',
  },
  {
    id: 'forced-win-vcf',
    category: 'forced-win',
    player: 1,
    // 黑 (6,7)-(8,7) 活三，白有一子干扰但不堵两端
    lines: rows([
      '',
      '',
      '',
      '',
      '',
      '.......W.......',
      '.......B.......',
      '......BBB......',
    ]),
    synthetic: true,
    source: '构造',
    expects: [{ kind: 'forced-win', plies: 3 }],
    note: '带干扰子的强制胜：证明器要确认白的那一子没有改变结论。',
  },
  {
    id: 'threat-not-win',
    category: 'threat-not-win',
    player: 1,
    // 白冲四 (5,5)-(8,5) 右端 (9,5) 可成五；黑另有活三 (6,7)-(8,7)
    lines: rows([
      '',
      '',
      '',
      '',
      '',
      '....BWWWW......',
      '',
      '......BBB......',
    ]),
    source: '构造',
    expects: [{ kind: 'only-non-losing-move', point: { x: 9, y: 5 } }],
    note: '反例：黑也有威胁，但白的冲四更快——黑的活三**不构成必胜**，必须先堵。',
  },
  {
    id: 'transposed',
    category: 'transposition',
    player: 1,
    // 与 opening-diagonal 同形，但注释里记录它可由两条手顺到达：
    // (7,7) (8,8) 或 (8,8)? —— 黑先手不可能先下白点，因此实际手顺是
    // 黑 (7,7)、白 (8,8)。这里保留为「同一局面进哈希表时不应区分路径」的样本。
    lines: rows(['', '', '', '', '', '', '', '.......B.......', '........W......']),
    source: '构造（与 opening-diagonal 同形）',
    expects: [{ kind: 'no-immediate-win-for-either' }],
    note: '置换样本：与 opening-diagonal 局面相同、id 不同，用来验证置换表不区分到达路径。',
  },
  {
    id: 'endgame-eight-holes',
    category: 'endgame',
    player: 2,
    lines: formatBoardLines(nearlyFullBoard()),
    synthetic: true,
    source: '复用 src/test/board-fixtures.ts 的 nearlyFullBoard',
    expects: [{ kind: 'no-immediate-win-for-either' }],
    note: '接近满盘、构造上无五连：候选点少，用来量残局搜索开销。',
  },
]

export function boardOf(position: BenchPosition): Board {
  return parseBoardLines(position.lines)
}
