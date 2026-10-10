import { createBoard, idx } from '../core/board'
import { BOARD_SIZE, type Board } from '../core/types'

/**
 * 用字符画构造棋盘。rows[0] 对应 y = 0（最上面一行）。
 * 'B' = 黑，'W' = 白，其余字符（惯例用 '.'）= 空。
 * 行数不足时按空补齐，方便只画关心的那几行。
 *
 * 行列超界直接报错而不是静默截断：内容数据写错一个点就会整体错位，
 * 悄悄吞掉只会让断言（或者一道题）在错误的前提下成立。
 *
 * 放在 `lib/` 而不是 `test/`：课程与题库是**产品内容**，运行时要解析它，
 * 不能依赖只给测试用的模块；而测试夹具反过来复用它，两边是同一份解析器。
 */
export function parseBoardLines(rows: readonly string[]): Board {
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

/** 把局面渲染回字符画，用于测试失败时的可读输出，以及内容数据的往返校验。 */
export function formatBoardLines(board: Board): string[] {
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
