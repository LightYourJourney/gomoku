import { idx, opponentOf } from '../../src/core/board'
import { findWinLine, validateMove } from '../../src/core/rules'
import type { Board, Player, Point } from '../../src/core/types'
import type { Difficulty } from '../../src/ai/types'
import { isForcedWinMove, winningPoints } from './proof'
import type { BenchPosition } from './positions'
import type { Engine } from './types'

/**
 * 战术探针：把 `POSITIONS` 喂给一个引擎，用**独立判据**判定它这一手对不对。
 *
 * 三条纪律：
 * 1. 判据只依赖 `core/rules` 与 `proof.ts` 的独立证明器，**不读引擎的分数**；
 * 2. 「必败局面」（活四、双四）只记录选择，不计入通过率——那里没有正确答案；
 * 3. 每题只问一手。多手战术属于对局评测，不在这一层冒充。
 */

export type TacticVerdict = 'pass' | 'fail' | 'diagnostic'

type Criterion = 'win-now' | 'exact' | 'forced-win' | 'diagnostic' | 'safe'

export interface TacticCaseResult {
  readonly position: string
  readonly category: string
  readonly criterion: Criterion
  readonly expected: string
  readonly verdict: TacticVerdict
  readonly move: Point | null
  readonly depth: number
  readonly nodes: number
  readonly reason: string
  readonly elapsedMs: number
}

export interface TacticTierResult {
  readonly engineId: string
  readonly difficulty: Difficulty
  readonly label: string
  readonly budgetMs: number
  readonly cases: readonly TacticCaseResult[]
  readonly passed: number
  readonly failed: number
  readonly diagnostic: number
}

export interface TightBudgetResult {
  readonly engineId: string
  readonly difficulty: Difficulty
  readonly position: string
  readonly verdict: TacticVerdict
  readonly move: Point | null
  readonly reason: string
  readonly elapsedMs: number
}

export interface TacticsReport {
  readonly generatedAt: string
  readonly loadAverage: number
  readonly tiers: readonly TacticTierResult[]
  readonly tightBudget: readonly TightBudgetResult[]
}

/**
 * 强制胜的证明预算：我方最多再走两手（合计五手链）。
 *
 * 只用三手会把「冲四 → 对手堵 → 做活四」这类同样正确的五手胜判成失败，
 * 而证明边界本身不是棋力。报告里必须写明这个上界。
 */
const FORCED_WIN_PLAYER_MOVES = 2

const EXPECTED_LABEL: Record<Criterion, string> = {
  'win-now': '立即成五',
  exact: '唯一不输的落点',
  'forced-win': '五手内强制胜',
  diagnostic: '必败局面（只记录）',
  safe: '合法且不送立即成五',
}

/**
 * 从局面的**独立声明**推出「这一手该怎么判」。
 *
 * 顺序有讲究：`open-three` 同时声明了「双方都没有立即成五」与「存在强制胜」，
 * 后者才是对**着法**的要求，必须优先。
 */
function criterionOf(position: BenchPosition): Criterion {
  const kinds = position.expects.map((expect) => expect.kind)
  if (kinds.includes('wins-immediately')) return 'win-now'
  if (kinds.includes('only-non-losing-move')) return 'exact'
  if (kinds.includes('forced-win')) return 'forced-win'
  if (kinds.includes('blocks-all-losses')) return 'diagnostic'
  return 'safe'
}

function expectedLabel(position: BenchPosition, criterion: Criterion): string {
  if (criterion !== 'exact') return EXPECTED_LABEL[criterion]
  const expect = position.expects.find((item) => item.kind === 'only-non-losing-move')
  return expect?.kind === 'only-non-losing-move'
    ? `唯一不输：( ${expect.point.x} , ${expect.point.y} )`
    : EXPECTED_LABEL.exact
}

function placeOnCopy(board: Board, point: Point, player: Player): Board {
  const next = board.slice()
  next[idx(point.x, point.y)] = player
  return next
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y
}

/**
 * 判定一手棋。
 *
 * `safe` 一条值得解释：在「双方都没有立即成五」的局面里，引擎可以随便下，
 * 但**不能把立即成五送给对手**。这既覆盖「无杀局面避免误判」，
 * 也覆盖低档不会无理由送棋。
 */
function judgeMove(
  position: BenchPosition,
  board: Board,
  move: Point | null,
): TacticVerdict {
  const criterion = criterionOf(position)

  if (move === null || validateMove(board, move) !== null) return 'fail'
  if (criterion === 'diagnostic') return 'diagnostic'

  if (criterion === 'win-now') {
    return findWinLine(placeOnCopy(board, move, position.player), move) !== null ? 'pass' : 'fail'
  }

  if (criterion === 'exact') {
    const expect = position.expects.find((item) => item.kind === 'only-non-losing-move')
    if (expect?.kind !== 'only-non-losing-move') return 'fail'
    return samePoint(move, expect.point) ? 'pass' : 'fail'
  }

  if (criterion === 'forced-win') {
    return isForcedWinMove(board, position.player, move, FORCED_WIN_PLAYER_MOVES) ? 'pass' : 'fail'
  }

  const after = placeOnCopy(board, move, position.player)
  if (findWinLine(after, move) !== null) return 'pass'
  return winningPoints(after, opponentOf(position.player)).length === 0 ? 'pass' : 'fail'
}

/** 对一个引擎跑完全部战术局面。`board` 由调用方按局面提供。 */
export function probePosition(
  engine: Engine,
  position: BenchPosition,
  board: Board,
): TacticCaseResult {
  const result = engine.choose(board.slice(), position.player)
  const move = result.move
  const criterion = criterionOf(position)

  return {
    position: position.id,
    category: position.category,
    criterion,
    expected: expectedLabel(position, criterion),
    verdict: judgeMove(position, board, move),
    move,
    depth: result.depth,
    nodes: result.nodes,
    reason: result.reason,
    elapsedMs: result.elapsedMs,
  }
}

export function aggregateTier(
  engine: Engine,
  difficulty: Difficulty,
  label: string,
  budgetMs: number,
  cases: readonly TacticCaseResult[],
): TacticTierResult {
  return {
    engineId: engine.id,
    difficulty,
    label,
    budgetMs,
    cases,
    passed: cases.filter((item) => item.verdict === 'pass').length,
    failed: cases.filter((item) => item.verdict === 'fail').length,
    diagnostic: cases.filter((item) => item.verdict === 'diagnostic').length,
  }
}
