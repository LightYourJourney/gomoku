import { createBoard, idx } from '../core/board'
import { BOARD_SIZE, type Board, type Point } from '../core/types'

/**
 * 用字符画构造棋盘。rows[0] 对应 y = 0（最上面一行）。
 * 'B' = 黑，'W' = 白，其余字符（惯例用 '.'）= 空。
 * 行数不足时按空补齐，方便只画关心的那几行。
 *
 * 行列超界直接报错而不是静默截断：测试数据写错一个点就会整体错位，
 * 悄悄吞掉只会让断言在错误的前提下通过。
 */
export function boardFromLines(rows: readonly string[]): Board {
  if (rows.length > BOARD_SIZE) {
    throw new Error(`局面有 ${rows.length} 行，超过棋盘 ${BOARD_SIZE} 行`)
  }

  const board = createBoard()
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? ''
    if (row.length > BOARD_SIZE) {
      throw new Error(`第 ${y} 行有 ${row.length} 列，超过棋盘 ${BOARD_SIZE} 列`)
    }

    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === 'B') board[idx(x, y)] = 1
      else if (ch === 'W') board[idx(x, y)] = 2
    }
  }

  return board
}

/**
 * 接近填满、但**构造上不存在五连**的局面。
 *
 * 上色规则 `(x + 2y) % 4 < 2`，四个方向上最长只连得出两颗子，所以既不会触发
 * 「必胜」也不会触发「必防」的捷径，搜索真的会跑起来；留出 `holes` 个空位，
 * 候选点因而很少。
 *
 * **不要拿「相邻行黑白交替」那类填充当近似满盘用**：那样主对角线 `x === y`
 * 全是一色，黑棋早就连成十四子，引擎只会走必防捷径——用它当样本，测的其实是
 * 捷径而不是满盘。
 */
export function nearlyFullBoard(holes: readonly Point[] = DEFAULT_HOLES): Board {
  const board = createBoard()

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      board[idx(x, y)] = (x + 2 * y) % 4 < 2 ? 1 : 2
    }
  }

  for (const { x, y } of holes) board[idx(x, y)] = 0

  return board
}

/** 八个空位，分散在棋盘中部，互不构成威胁。 */
const DEFAULT_HOLES: readonly Point[] = [
  { x: 7, y: 7 },
  { x: 6, y: 6 },
  { x: 8, y: 8 },
  { x: 5, y: 5 },
  { x: 9, y: 9 },
  { x: 7, y: 8 },
  { x: 8, y: 7 },
  { x: 3, y: 3 },
]

/** 把局面渲染回字符画，用于测试失败时的可读输出。 */
export function linesFromBoard(board: Board): string[] {
  const lines: string[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    let row = ''
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = board[idx(x, y)]
      row += cell === 1 ? 'B' : cell === 2 ? 'W' : '.'
    }
    lines.push(row)
  }

  return lines
}
