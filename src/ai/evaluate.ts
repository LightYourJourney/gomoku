import { idx, opponentOf } from '../core/board'
import { BOARD_SIZE, WIN_LENGTH, type Board, type Player } from '../core/types'
import { WIN_SCORE } from './types'

export { WIN_SCORE }

/** 一条线段上的连续同色棋子的分值。openEnds 为两端可延展的数量。 */
const RUN_VALUE = {
  openFour: 200_000,
  four: 15_000,
  openThree: 12_000,
  three: 800,
  openTwo: 600,
  two: 100,
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

function runValue(length: number, openEnds: number): number {
  if (length >= WIN_LENGTH) return WIN_SCORE
  if (length === 4) {
    if (openEnds === 2) return RUN_VALUE.openFour
    if (openEnds === 1) return RUN_VALUE.four
    return 0
  }
  if (length === 3) {
    if (openEnds === 2) return RUN_VALUE.openThree
    if (openEnds === 1) return RUN_VALUE.three
    return 0
  }
  if (length === 2) {
    if (openEnds === 2) return RUN_VALUE.openTwo
    if (openEnds === 1) return RUN_VALUE.two
    return 0
  }

  // 单子还没有构成任何棋型。给它计分只会在评估里引入常数噪声。
  return 0
}

function scoreLine(board: Board, line: readonly number[], player: Player): number {
  let score = 0
  let i = 0

  while (i < line.length) {
    if (board[line[i]] !== player) {
      i++
      continue
    }

    let j = i
    while (j + 1 < line.length && board[line[j + 1]] === player) j++

    const length = j - i + 1
    const headOpen = i > 0 && board[line[i - 1]] === 0
    const tailOpen = j < line.length - 1 && board[line[j + 1]] === 0

    score += runValue(length, (headOpen ? 1 : 0) + (tailOpen ? 1 : 0))
    i = j + 1
  }

  return score
}

/**
 * 从 `player` 的视角评估整个局面：自己的棋型总分减去对手的棋型总分。
 *
 * 这是纯局面评估，不包含「轮到谁走」的信息——先手优势由搜索本身的
 * 必胜判断（能不能立刻成五）来处理，不在这里近似。
 */
export function evaluateBoard(board: Board, player: Player): number {
  const opponent = opponentOf(player)
  let score = 0

  for (const line of LINES) {
    score += scoreLine(board, line, player) - scoreLine(board, line, opponent)
  }

  return score
}
