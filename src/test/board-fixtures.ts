import { BOARD_SIZE, type Board } from '../core/types'

/**
 * 用字符画构造棋盘。rows[0] 对应 y = 0（最上面一行）。
 * 'B' = 黑，'W' = 白，其余字符（惯例用 '.'）= 空。
 * 行数或列数不足时按空补齐，方便只画关心的那几行。
 */
export function boardFromLines(rows: readonly string[]): Board {
  if (rows.length > BOARD_SIZE) {
    throw new Error(`局面有 ${rows.length} 行，超过棋盘 ${BOARD_SIZE} 行`)
  }

  const board = new Uint8Array(BOARD_SIZE * BOARD_SIZE)
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? ''
    if (row.length > BOARD_SIZE) {
      throw new Error(`第 ${y} 行有 ${row.length} 列，超过棋盘 ${BOARD_SIZE} 列`)
    }
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === 'B') board[y * BOARD_SIZE + x] = 1
      else if (ch === 'W') board[y * BOARD_SIZE + x] = 2
    }
  }
  return board
}

/** 把局面渲染回字符画，用于测试失败时的可读输出。 */
export function linesFromBoard(board: Board): string[] {
  const lines: string[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    let row = ''
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = board[y * BOARD_SIZE + x]
      row += cell === 1 ? 'B' : cell === 2 ? 'W' : '.'
    }
    lines.push(row)
  }
  return lines
}
