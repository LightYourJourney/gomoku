import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, type Point } from './types'
import { buildBranchGame } from './branch'

const MOVES: readonly Point[] = [
  { x: 3, y: 7 },
  { x: 3, y: 9 },
  { x: 4, y: 7 },
  { x: 4, y: 9 },
  { x: 5, y: 7 },
]

describe('buildBranchGame —— 从棋谱前缀接管局面', () => {
  it('第 0 手是空盘，黑先', () => {
    const built = buildBranchGame({ moves: MOVES, firstPlayer: BLACK }, 0)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.game.moves).toEqual([])
    expect(built.game.current).toBe(BLACK)
    expect(built.game.status).toBe('playing')
  })

  it('第 1 手中盘前缀与下一手正确', () => {
    const built = buildBranchGame({ moves: MOVES, firstPlayer: BLACK }, 1)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.game.moves).toEqual([MOVES[0]])
    expect(built.game.current).toBe(WHITE)
  })

  it('中盘：只使用前缀，不带入后续手顺', () => {
    const built = buildBranchGame({ moves: MOVES, firstPlayer: BLACK }, 3)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.game.moves).toEqual(MOVES.slice(0, 3))
    expect(built.game.moves).not.toContainEqual(MOVES[3])
  })

  it('最后一手之前可以继续；最后一手若未终局也可以', () => {
    const beforeLast = buildBranchGame({ moves: MOVES, firstPlayer: BLACK }, 4)
    expect(beforeLast.ok).toBe(true)
    if (!beforeLast.ok) return
    expect(beforeLast.game.moves).toHaveLength(4)

    const last = buildBranchGame({ moves: MOVES, firstPlayer: BLACK }, 5)
    expect(last.ok).toBe(true)
    if (!last.ok) return
    expect(last.game.status).toBe('playing')
  })

  it('五连终局阻止继续', () => {
    const wins: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 4, y: 0 },
    ]
    const built = buildBranchGame({ moves: wins, firstPlayer: BLACK }, 9)
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error).toContain('五连终局')
  })

  it('满盘和棋阻止继续', () => {
    const blacks: Point[] = []
    const whites: Point[] = []
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        if ((x + 2 * y) % 4 < 2) blacks.push({ x, y })
        else whites.push({ x, y })
      }
    }
    const moves: Point[] = []
    for (let i = 0; i < blacks.length; i++) {
      moves.push(blacks[i]!)
      if (i < whites.length) moves.push(whites[i]!)
    }
    const built = buildBranchGame({ moves, firstPlayer: BLACK }, moves.length)
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error).toContain('和棋')
  })

  it('前缀之外的损坏手顺也不能被忽略', () => {
    const built = buildBranchGame(
      {
        moves: [
          { x: 7, y: 7 },
          { x: 7, y: 7 },
          { x: 8, y: 8 },
        ],
        firstPlayer: BLACK,
      },
      1,
    )
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error).toContain('无法完整重放')
  })

  it('非法/截断手顺拒绝', () => {
    const built = buildBranchGame(
      {
        moves: [
          { x: 7, y: 7 },
          { x: 7, y: 7 },
        ],
        firstPlayer: BLACK,
      },
      2,
    )
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.error).toContain('无法完整重放')
  })

  it('越界手数拒绝', () => {
    const built = buildBranchGame({ moves: MOVES, firstPlayer: BLACK }, 6)
    expect(built.ok).toBe(false)
  })
})
