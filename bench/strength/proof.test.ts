import { describe, expect, it } from 'vitest'
import { boardFromLines } from '../../src/test/board-fixtures'
import { isForcedWinMove, proveForcedWin } from './proof'
import { POSITIONS } from './positions'

/**
 * 独立证明器的自测。
 *
 * 战术探针的「正确答案」完全依赖它；证明器放宽或收紧一格，
 * 五档的战术通过率就会跟着漂。这里把两个边界钉住：
 * 三手胜、五手胜。
 */

function boardOf(id: string) {
  const position = POSITIONS.find((item) => item.id === id)
  if (position === undefined) throw new Error(`未知局面：${id}`)
  return { position, board: boardFromLines(position.lines) }
}

describe('isForcedWinMove', () => {
  it('直接做活四的那一手是 3 手强制胜', () => {
    const { position, board } = boardOf('double-threat')

    // (7,4) 让竖线 y=4..7 连成四、两端全空：对手堵一头，另一头成五
    expect(isForcedWinMove(board, position.player, { x: 7, y: 4 })).toBe(true)
  })

  it('(7,3) 是 5 手强制胜，3 手预算下证明不出来', () => {
    const { position, board } = boardOf('double-threat')

    // (7,3) 冲四 → 对手只能堵 (7,4) → (5,7) 做活四 → 成五。
    // 这条用例保护的是「证明边界不是棋力」：默认三手不该把它判对，
    // 放宽到五手必须能证明出来。
    expect(isForcedWinMove(board, position.player, { x: 7, y: 3 })).toBe(false)
    expect(isForcedWinMove(board, position.player, { x: 7, y: 3 }, 2)).toBe(true)
  })

  it('安静局面上没有五手强制胜', () => {
    // 双三局面里**任何**一手都保留双三，所以「随便下都是强制胜」；
    // 要测「非胜着法」，必须换一个双方都没有强制胜的安静局面。
    const { position, board } = boardOf('quiet-midgame')

    expect(isForcedWinMove(board, position.player, { x: 7, y: 7 }, 2)).toBe(false)
  })

  it('既有局面里的 3 手胜与 proveForcedWin 一致', () => {
    const { position, board } = boardOf('open-three')

    const proof = proveForcedWin(board, position.player)
    expect(proof).not.toBeNull()
    expect(isForcedWinMove(board, position.player, proof!.move)).toBe(true)
  })
})
