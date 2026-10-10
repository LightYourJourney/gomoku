import { idx, opponentOf } from '../core/board'
import { BOARD_SIZE, WIN_LENGTH, type Board, type Player } from '../core/types'
import { WIN_SCORE } from './types'

export { WIN_SCORE }

/**
 * 盘面评估的棋型分值。
 *
 * 与 `patterns.ts` 的排序分值表是两套刻度，不要互相套用：那张表用于**单点排序**
 * （比较的是「这一手好不好」），这张表用于**整盘评估**（比较的是「这个局面对谁有利」），
 * 量级不同是有意的。
 */
export const SHAPE_VALUES = {
  openFour: 200_000,
  four: 15_000,
  openThree: 12_000,
  three: 800,
} as const

/** 棋盘上全部长度不小于 5 的线段（横 / 竖 / 两个斜向），用一维索引表示。 */
function buildLines(): number[][] {
  const lines: number[][] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    const line: number[] = []
    for (let x = 0; x < BOARD_SIZE; x++) line.push(idx(x, y))
    lines.push(line)
  }

  for (let x = 0; x < BOARD_SIZE; x++) {
    const line: number[] = []
    for (let y = 0; y < BOARD_SIZE; y++) line.push(idx(x, y))
    lines.push(line)
  }

  // ↘：从第一行出发，再从第一列出发（跳过起点那格，避免重复）。
  for (let start = 0; start < BOARD_SIZE; start++) {
    const line: number[] = []
    for (let x = start, y = 0; x < BOARD_SIZE; x++, y++) line.push(idx(x, y))
    if (line.length >= WIN_LENGTH) lines.push(line)
  }
  for (let start = 1; start < BOARD_SIZE; start++) {
    const line: number[] = []
    for (let x = 0, y = start; y < BOARD_SIZE; x++, y++) line.push(idx(x, y))
    if (line.length >= WIN_LENGTH) lines.push(line)
  }

  // ↗：从最后一行出发，再从第一列出发。
  for (let start = 0; start < BOARD_SIZE; start++) {
    const line: number[] = []
    for (let x = start, y = BOARD_SIZE - 1; x < BOARD_SIZE; x++, y--) line.push(idx(x, y))
    if (line.length >= WIN_LENGTH) lines.push(line)
  }
  for (let start = BOARD_SIZE - 2; start >= 0; start--) {
    const line: number[] = []
    for (let x = 0, y = start; y >= 0; x++, y--) line.push(idx(x, y))
    if (line.length >= WIN_LENGTH) lines.push(line)
  }

  return lines
}

const LINES = buildLines()

/**
 * 段内只有「己方子」与「空位」两种（对手子与棋盘边都是段的边界），
 * 所以窗口里数出 4 颗己方子时，剩下的那一格必然是空的——不必再判空。
 */
function scoreSegment(
  board: Board,
  line: readonly number[],
  start: number,
  end: number,
  player: Player,
): number {
  if (end - start + 1 < WIN_LENGTH) return 0

  let maxOwn = 0
  const winningIndices: number[] = []

  for (let from = start; from + WIN_LENGTH - 1 <= end; from++) {
    let own = 0
    let onlyEmpty = -1

    for (let k = from; k < from + WIN_LENGTH; k++) {
      const cell = board[line[k]]
      if (cell === player) own++
      else if (cell === 0) onlyEmpty = k
    }

    if (own > maxOwn) maxOwn = own
    if (own === WIN_LENGTH) return WIN_SCORE

    // 四颗己方子 + 一个空位：那个空位就是成五点。滑窗会让同一个四
    // 被相邻窗口各命中一次，所以按空位下标去重，一个段只算一个四。
    if (own === WIN_LENGTH - 1 && !winningIndices.includes(onlyEmpty)) {
      winningIndices.push(onlyEmpty)
    }
  }

  if (maxOwn === WIN_LENGTH - 1) {
    return winningIndices.length >= 2 ? SHAPE_VALUES.openFour : SHAPE_VALUES.four
  }

  if (maxOwn === WIN_LENGTH - 2) return scoreThreeRuns(board, line, start, end, player)

  return 0
}

/**
 * 段内的三：沿用「连续三子 + 两端在段内可延展」的便宜口径。
 *
 * 不在这里做精确的活三判定（试放一子后重数成五点）：那段代码单条线段就要
 * 上千次读格，而本函数在每个叶子节点都要跑满 72 条线。精确口径在
 * `patterns.ts` 的 `analyzePoint` 里，供提示与威胁展示使用。
 */
function scoreThreeRuns(
  board: Board,
  line: readonly number[],
  start: number,
  end: number,
  player: Player,
): number {
  let best = 0

  for (let i = start; i + 2 <= end; i++) {
    if (
      board[line[i]] !== player ||
      board[line[i + 1]] !== player ||
      board[line[i + 2]] !== player
    ) {
      continue
    }
    // 更长的连子会让 maxOwn 达到 4，走不到这里；这一句是防御性的。
    if (i > start && board[line[i - 1]] === player) continue

    // 段外是对手子或棋盘边，都算被堵；段内紧邻的那一格必然不是己方子，即空位。
    const openEnds = (i > start ? 1 : 0) + (i + 3 <= end ? 1 : 0)
    const value =
      openEnds === 2 ? SHAPE_VALUES.openThree : openEnds === 1 ? SHAPE_VALUES.three : 0

    if (value > best) best = value
  }

  return best
}

function scoreLine(board: Board, line: readonly number[], player: Player): number {
  const opponent = opponentOf(player)
  let score = 0
  let cursor = 0

  while (cursor < line.length) {
    if (board[line[cursor]] === opponent) {
      cursor++
      continue
    }

    let end = cursor
    while (end + 1 < line.length && board[line[end + 1]] !== opponent) end++

    score += scoreSegment(board, line, cursor, end, player)
    cursor = end + 1
  }

  return score
}

/**
 * 从 `player` 的视角评估整个局面：自己的棋型总分减去对手的棋型总分。
 *
 * 这是纯局面评估，不含「轮到谁走」的信息——先手优势由搜索本身的
 * 必胜判断处理，不在这里近似。
 */
export function evaluateBoard(board: Board, player: Player): number {
  const opponent = opponentOf(player)
  let score = 0

  for (const line of LINES) {
    score += scoreLine(board, line, player) - scoreLine(board, line, opponent)
  }

  return score
}
