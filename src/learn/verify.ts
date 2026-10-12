import { candidateMoves } from '../ai/candidates'
import { analyzePoint, dominantThreat, hasDoubleThreat, isWinningPoint } from '../ai/patterns'
import { isForcedWinStart } from '../ai/threat'
import { idx, opponentOf, pointFromIdx } from '../core/board'
import { findWinLine, validateMove } from '../core/rules'
import type { Board, Player, Point } from '../core/types'
import { formatPoint } from '../lib/coords'
import { SHAPE_LABELS, threatLabel } from '../lib/shape-labels'
import type { PuzzleGoal } from './types'

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export const OK: Verdict = { ok: true }

function fail(reason: string): Verdict {
  return { ok: false, reason }
}

/** 判题里给算杀留的预算。这是判题不是对局，不能让玩家等算杀跑满。 */
const JUDGE_THREAT_BUDGET_MS = 2000

/**
 * 落一手，返回**新的**棋盘。
 *
 * 与 `searchBoard` / `findForcedWin` 同一条硬约定：不改传入的棋盘。
 */
export function applyToBoard(board: Board, move: Point, player: Player): Board {
  const next = board.slice()
  next[idx(move.x, move.y)] = player
  return next
}

/** 全盘扫描有没有人已经连成五子。`findWinLine` 是围绕某一个点查的，所以逐子查一遍。 */
export function boardHasFive(board: Board): boolean {
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) continue

    const point = pointFromIdx(i)
    if (findWinLine(board, point) !== null) return true
  }
  return false
}

/** 此刻 `player` 落子就能成五的全部空点。 */
function winningPoints(board: Board, player: Player): Point[] {
  return candidateMoves(board, 1).filter((point) => isWinningPoint(board, point, player))
}

function pointList(points: readonly Point[]): string {
  return points.map(formatPoint).join('、')
}

/**
 * 判一手棋有没有达成目标，并且**在没达成时说清为什么**。
 *
 * 只说「不对」等于没教。每种目标都有一条专门的解释，而且是算出来的
 * （对手的成五点在哪、这一手实际做出了什么棋型），不是写死的文案。
 */
export function judgeMove(
  board: Board,
  player: Player,
  move: Point,
  goal: PuzzleGoal,
  now: () => number,
): Verdict {
  const illegal = validateMove(board, move)
  if (illegal !== null) return fail('这里不能落子，换一个空的交叉点试试。')

  const after = applyToBoard(board, move, player)

  // 不论目标是什么，成五了就是做对了——为胜势判错只会让学习者困惑。
  if (findWinLine(after, move) !== null) return OK

  switch (goal.kind) {
    case 'win':
      return fail('这一手没有连成五子。找一找，哪个点补上去能凑满五个？')

    case 'blockFive': {
      const threats = winningPoints(after, opponentOf(player))
      if (threats.length === 0) return OK

      return fail(
        `你下了 ${formatPoint(move)}，但对手下一手还能在 ${pointList(threats)} 连成五子，没堵住。`,
      )
    }

    case 'makeShape': {
      const counts = analyzePoint(after, move, player)
      // 活四是任何目标下的胜势，一律判对；其余按**精确匹配**，不做档位比较。
      // 引擎的 SHAPE_VALUE 把冲四排在活三之上，但那是给搜索排序用的权重，
      // 不是教学上的包含关系——冲四与活三是两种互不包含的棋型。
      if (counts.openFour > 0) return OK
      if (counts[goal.shape] > 0) return OK

      return fail(
        `这一手做出的是${threatLabel(dominantThreat(counts))}，题目要求${SHAPE_LABELS[goal.shape]}。`,
      )
    }

    case 'doubleThreat': {
      const counts = analyzePoint(after, move, player)
      if (counts.openFour > 0) return OK
      if (hasDoubleThreat(counts)) return OK

      return fail(`这一手做出的是${threatLabel(dominantThreat(counts))}，还没有形成双重威胁。`)
    }

    case 'forcedWin': {
      // **必须在落子前的盘面上判**，并要求玩家这一手就是取胜链的第一步。
      // 拿落子后的盘面去调 findForcedWin 是错的：那个函数假定「传进来的盘面
      // 轮到攻方走」，而玩家落子之后轮到的是对手——等于白送一手，把输棋判成赢棋。
      const starts = isForcedWinStart(board, player, move, {
        maxPlies: goal.maxPlies,
        allowThrees: false,
        deadline: now() + JUDGE_THREAT_BUDGET_MS,
        now,
      })

      return starts
        ? OK
        : fail('这一手之后引擎找不到强制取胜的路线——对手有办法防住。')
    }
  }
}

/**
 * 这道题在这个局面上成不成立。
 *
 * 判的是**题目**，不是玩家的着法——与「目标是否已经达成」是两件事：题目
 * 可解的定义就是「存在一手能达成目标」，用它当「已达成」的判据会自相矛盾。
 */
export function checkPrecondition(board: Board, player: Player, goal: PuzzleGoal): Verdict {
  switch (goal.kind) {
    case 'blockFive': {
      const threats = winningPoints(board, opponentOf(player))
      return threats.length > 0
        ? OK
        : fail('这个局面里对手没有成五点，没有可挡的东西，题目不成立。')
    }

    case 'forcedWin':
      // 一手取胜请用 win 表达；硬凑成 forcedWin 会让判定走空（maxPlies 1 时
      // attack 一进来就因 remaining < 1 收手）。
      return goal.maxPlies >= 3
        ? OK
        : fail('forcedWin 的 maxPlies 至少要 3——一手取胜请用 win 表达。')

    case 'win':
    case 'makeShape':
    case 'doubleThreat':
      return OK
  }
}
