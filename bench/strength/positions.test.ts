// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { idx, opponentOf } from '../../src/core/board'
import { replay } from '../../src/core/game'
import { findWinLine } from '../../src/core/rules'
import { BOARD_SIZE, type Board } from '../../src/core/types'
import { OPENINGS, openingState } from './openings'
import { boardOf, POSITIONS, type BenchPosition } from './positions'
import { proveForcedWin, winningPoints } from './proof'

/**
 * 局面库自检。
 *
 * 这一层的价值在于：**错误的标准答案比没有标准答案更糟**。如果局面库里
 * 混进一个「其实已经五连」或「其实白棋也能成五」的局面，后面的战术断言
 * 会在错误的前提下通过，而且报告看起来一切正常。
 */

function stonesOf(board: Board): { black: number; white: number } {
  let black = 0
  let white = 0
  for (const cell of board) {
    if (cell === 1) black++
    else if (cell === 2) white++
  }
  return { black, white }
}

function hasAnyFive(board: Board): boolean {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[idx(x, y)] === 0) continue
      if (findWinLine(board, { x, y }) !== null) return true
    }
  }
  return false
}

function check(position: BenchPosition): void {
  const board = boardOf(position)
  const counts = stonesOf(board)

  // 已经有五连的局面不能作为对局起点
  expect(hasAnyFive(board), `${position.id} 已存在五连`).toBe(false)

  /*
   * 子力数守恒只对**可由真实对局到达**的局面成立（黑先手：黑 = 白 或 黑 = 白 + 1）。
   * 战术局面天然不满足——「黑有四子、白一子都没有」这种局面从合法手顺走不出来，
   * 因此显式标 `synthetic`，并且只用于战术探针、不作为对局起点。
   */
  if (position.synthetic !== true) {
    expect(
      counts.black === counts.white || counts.black === counts.white + 1,
      `${position.id} 棋子数不守恒：B=${counts.black} W=${counts.white}（若是有意构造的战术局面，请标 synthetic）`,
    ).toBe(true)
  }

  const opponent = opponentOf(position.player)

  for (const expect_ of position.expects) {
    switch (expect_.kind) {
      case 'opening-center': {
        expect(counts.black + counts.white, `${position.id} 不是空盘`).toBe(0)
        break
      }
      case 'wins-immediately': {
        expect(
          winningPoints(board, position.player).length,
          `${position.id} 声称可以立即成五，但找不到成五点`,
        ).toBeGreaterThan(0)
        break
      }
      case 'blocks-all-losses': {
        expect(
          winningPoints(board, opponent).length,
          `${position.id} 声称对手有直接威胁，但找不到对手的成五点`,
        ).toBeGreaterThan(0)
        break
      }
      case 'only-non-losing-move': {
        const threats = winningPoints(board, opponent)
        expect(threats, `${position.id} 应有恰好一个对手成五点`).toHaveLength(1)
        expect(threats[0]).toEqual(expect_.point)
        expect(winningPoints(board, position.player), `${position.id} 当前方不应有成五点`).toHaveLength(0)
        break
      }
      case 'no-immediate-win-for-either': {
        expect(winningPoints(board, position.player), `${position.id} 当前方有成五点`).toHaveLength(0)
        expect(winningPoints(board, opponent), `${position.id} 对手有成五点`).toHaveLength(0)
        break
      }
      case 'forced-win': {
        const proof = proveForcedWin(board, position.player)
        expect(proof, `${position.id} 声称存在 ${expect_.plies} 手强制胜，但证明器证不出来`).not.toBeNull()
        break
      }
    }
  }
}

describe('标准局面库', () => {
  it('id 唯一', () => {
    const ids = POSITIONS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('覆盖声明的全部类别（任务要求 12 类，冲四另立一类）', () => {
    const required = [
      'empty',
      'opening',
      'quiet',
      'direct-win',
      'must-block',
      'multi-win',
      'open-three',
      'rush-four',
      'double-threat',
      'forced-win',
      'threat-not-win',
      'transposition',
      'endgame',
    ] as const

    for (const category of required) {
      expect(
        POSITIONS.some((p) => p.category === category),
        `缺少类别 ${category}`,
      ).toBe(true)
    }
  })

  it.each(POSITIONS.map((p) => [p.id, p] as const))('%s 的局面合法且声明成立', (_id, position) => {
    check(position)
  })

  it('置换局面确实能由两条不同手顺到达同一盘面', () => {
    const position = POSITIONS.find((p) => p.category === 'transposition')!
    expect(position.orders, `${position.id} 没有记录到达手顺`).toBeDefined()
    expect(position.orders!.length, `${position.id} 至少需要两条手顺`).toBeGreaterThanOrEqual(2)

    const target = boardOf(position)
    const sequences = new Set<string>()
    for (const order of position.orders!) {
      const state = replay(order)
      expect(state.moves, `${position.id} 的手顺有非法着法`).toHaveLength(order.length)
      expect(state.status, `${position.id} 的手顺中途分出了胜负`).toBe('playing')
      expect(
        Array.from(state.board),
        `${position.id} 的手顺重放出的盘面与 lines 不一致`,
      ).toEqual(Array.from(target))
      sequences.add(order.map((p) => `${p.x},${p.y}`).join(' '))
    }
    // 真的不同路径，而不是把同一条手顺抄了两遍
    expect(sequences.size, `${position.id} 的两条手顺其实是同一条`).toBe(position.orders!.length)
  })

  it('每个局面都写清来源与预期', () => {
    for (const position of POSITIONS) {
      expect(position.source.length, `${position.id} 缺少来源`).toBeGreaterThan(0)
      expect(position.expects.length, `${position.id} 没有声明任何预期性质`).toBeGreaterThan(0)
      expect(position.note.length, `${position.id} 缺少说明`).toBeGreaterThan(0)
    }
  })
})

describe('开局集', () => {
  it('开局 id 唯一', () => {
    const ids = OPENINGS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个开局都合法、且没有预先分出胜负', () => {
    for (const opening of OPENINGS) {
      const state = openingState(opening)
      expect(state.status, `${opening.id} 开局已结束`).toBe('playing')
      expect(state.moves).toHaveLength(opening.moves.length)
    }
  })

  it('没有开局在起始局面就是某一方的强制胜', () => {
    // 一个「轮到黑、黑已必胜」的开局会让整组实验被先手写死：
    // 换色只决定谁执黑，谁执黑谁白拿一分。Phase 10D 的验证集曾因此把
    // 得分率压向 50%（three-each 的黑棋活三未被堵）。
    for (const opening of OPENINGS) {
      const state = openingState(opening)
      const opponent = opponentOf(state.current)
      expect(proveForcedWin(state.board, state.current), `${opening.id} 对轮到的一方是强制胜`).toBeNull()
      expect(proveForcedWin(state.board, opponent), `${opening.id} 对等待的一方是强制胜`).toBeNull()
    }
  })

  it('覆盖多种白棋应手，而不是只有一个中心开局', () => {
    const twoPly = OPENINGS.filter((o) => o.moves.length === 2)
    expect(twoPly.length).toBeGreaterThanOrEqual(4)

    // 白棋第二手不能全落在同一个点上
    const replies = new Set(twoPly.map((o) => `${o.moves[1]!.x},${o.moves[1]!.y}`))
    expect(replies.size).toBeGreaterThanOrEqual(4)

    // 至少有一个非天元首手
    expect(twoPly.some((o) => o.moves[0]!.x !== 7 || o.moves[0]!.y !== 7)).toBe(true)
  })
})

describe('证明器', () => {
  it('空盘证不出强制胜', () => {
    expect(proveForcedWin(new Uint8Array(225), 1)).toBeNull()
  })

  it('活三局面存在三步强制胜', () => {
    const position = POSITIONS.find((p) => p.id === 'open-three')!
    expect(proveForcedWin(boardOf(position), 1)).not.toBeNull()
  })

  it('必败局面证不出强制胜', () => {
    // 对手活四：我方堵一头，另一头仍输
    const position = POSITIONS.find((p) => p.id === 'must-block-double')!
    expect(proveForcedWin(boardOf(position), 1)).toBeNull()
  })

  it('当前方自己就能成五时也算成立', () => {
    const position = POSITIONS.find((p) => p.id === 'direct-win-open')!
    expect(proveForcedWin(boardOf(position), 1)).not.toBeNull()
  })
})

describe('棋子数守恒的边界', () => {
  it('非 synthetic 局面：黑子数只能等于或多于白子一枚', () => {
    for (const position of POSITIONS) {
      if (position.synthetic === true) continue
      const counts = stonesOf(boardOf(position))
      expect(counts.black - counts.white === 0 || counts.black - counts.white === 1).toBe(true)
    }
  })

  it('synthetic 局面不得作为对局起点', () => {
    // 对局起点全部来自 openings.ts，那里每条手顺都由 replay() 验过；
    // 这条按**盘面**比对，而不是按 id——id 不同但盘面相同的局面照样不能当起点。
    const openingBoards = OPENINGS.map((o) => Array.from(openingState(o).board))
    for (const position of POSITIONS) {
      if (position.synthetic !== true) continue
      const board = Array.from(boardOf(position))
      const clash = openingBoards.some((openingBoard) => openingBoard.every((cell, i) => cell === board[i]))
      expect(clash, `${position.id} 是 synthetic，其盘面却出现在开局集里`).toBe(false)
    }
  })
})
