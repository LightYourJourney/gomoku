import { describe, expect, it } from 'vitest'
import { idx } from '../core/board'
import { BLACK, BOARD_SIZE, WHITE } from '../core/types'
import { formatBoardLines, parseBoardLines } from './board-lines'

describe('parseBoardLines', () => {
  it('B 是黑、W 是白、其余字符是空', () => {
    const board = parseBoardLines(['.B.', 'W..'])

    expect(board[idx(1, 0)]).toBe(BLACK)
    expect(board[idx(0, 1)]).toBe(WHITE)
    expect(board[idx(0, 0)]).toBe(0)
    expect(board[idx(2, 0)]).toBe(0)
  })

  it('行数不足时按空补齐，棋盘总是整块', () => {
    const board = parseBoardLines(['B'])

    expect(board).toHaveLength(BOARD_SIZE * BOARD_SIZE)
    expect(board[idx(0, 0)]).toBe(BLACK)
  })

  it('空数组也返回一块空盘', () => {
    expect([...parseBoardLines([])].every((cell) => cell === 0)).toBe(true)
  })

  it('超过 15 行直接报错，不静默截断', () => {
    // 测试数据写错一个点就会整体错位，悄悄吞掉只会让断言在错误的前提下通过。
    const rows = Array.from({ length: BOARD_SIZE + 1 }, () => '.')

    expect(() => parseBoardLines(rows)).toThrow(/行/)
  })

  it('某一行超过 15 列直接报错', () => {
    expect(() => parseBoardLines(['.'.repeat(BOARD_SIZE + 1)])).toThrow(/列/)
  })
})

describe('formatBoardLines', () => {
  it('把棋盘还原成等宽的 15 行字符画', () => {
    const lines = formatBoardLines(parseBoardLines(['...B...', '..W....']))

    expect(lines).toHaveLength(BOARD_SIZE)
    expect(lines[0]).toBe(`...B...${'.'.repeat(BOARD_SIZE - 7)}`)
    expect(lines[1]).toBe(`..W....${'.'.repeat(BOARD_SIZE - 7)}`)
    expect(lines[2]).toBe('.'.repeat(BOARD_SIZE))
  })

  it('与 parseBoardLines 互为逆运算', () => {
    const source = [
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ]

    expect(formatBoardLines(parseBoardLines(source))).toEqual([
      ...source,
      ...Array.from({ length: BOARD_SIZE - source.length }, () => '.'.repeat(BOARD_SIZE)),
    ])
  })
})
