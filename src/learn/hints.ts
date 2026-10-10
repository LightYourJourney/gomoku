import { candidateMoves } from '../ai/candidates'
import { findForcedWin } from '../ai/threat'
import type { Board, Player, Point } from '../core/types'
import { SHAPE_LABELS } from '../lib/shape-labels'
import type { PuzzleGoal } from './types'
import { judgeMove } from './verify'

/** 三级提示：1 是文字点拨，2 是目标复述，3 是具体点位。 */
export const HINT_LEVELS = 3

/** 求解里给算杀留的预算。 */
const SOLVE_THREAT_BUDGET_MS = 3000

/**
 * 解出这道题的第一步。
 *
 * **建立在判定器之上**——「题目可解」与「玩家做对」因此用的是同一把尺子，
 * 不可能出现「提示指的那一手被判错」。内容自检也靠它逐题验证。
 *
 * 返回 null 表示这个局面上无解。自检会把这种题拦下来。
 */
export function solveMove(
  board: Board,
  player: Player,
  goal: PuzzleGoal,
  now: () => number,
): Point | null {
  // 算杀题的候选空间要靠搜索收窄：逐个候选去试的话，每个候选都要跑一遍算杀，
  // 一道题能卡上好几秒。findForcedWin 直接给出第一步。
  if (goal.kind === 'forcedWin') {
    return findForcedWin(board, player, {
      maxPlies: goal.maxPlies,
      allowThrees: false,
      deadline: now() + SOLVE_THREAT_BUDGET_MS,
      now,
    }).move
  }

  // 其余目标的判定本身很便宜（一次棋型分析或一次五连扫描），逐个试即可。
  for (const move of candidateMoves(board)) {
    if (judgeMove(board, player, move, goal, now).ok) return move
  }

  return null
}

/**
 * 第二级提示：把目标本身说清楚。
 *
 * **不许出现坐标**——具体点位是第三级的事，提前给等于剥夺了思考的机会。
 */
export function goalHint(goal: PuzzleGoal): string {
  switch (goal.kind) {
    case 'win':
      return '找一个能立刻连成五子的点。'
    case 'blockFive':
      return '对手下一手就能连成五子，先把那个点占住，别让自己的连子白做。'
    case 'makeShape':
      return `这一手要做出${SHAPE_LABELS[goal.shape]}——想想哪个点补上去正好成形。`
    case 'doubleThreat':
      return '同时做出两个威胁：双四、四三或者双活三，对手才堵不过来。'
    case 'forcedWin':
      return `这一手之后，无论对手怎么应，你都能在 ${goal.maxPlies} 手内连成五子。`
  }
}
