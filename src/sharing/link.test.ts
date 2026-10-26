import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, type Point } from '../core/types'
import { applyEdit, createPosition } from '../core/position'
import type { GameRecord } from '../persist/gameRecords'
import {
  createGameShare,
  createPositionShare,
  createReplayPositionShare,
  createShareUrl,
  decodeShareToken,
  MAX_SHARE_TOKEN,
  shareTokenFromHash,
} from './link'

const NINE_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 },
  { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 },
  { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function game(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    seq: 4,
    schemaVersion: 1,
    moves: NINE_MOVES,
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
    ...overrides,
  }
}

function fullBoardMoves(): Point[] {
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
  return moves
}

describe('分享链接 —— 编码与解码', () => {
  it('整盘棋谱往返', () => {
    const encoded = createGameShare(game())
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = decodeShareToken(encoded.token)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok || decoded.kind !== 'game') return
    expect(decoded.game.moves).toEqual(NINE_MOVES)
    expect(decoded.game.ending).toEqual({ type: 'five', winner: BLACK })
  })

  it('认输记录往返', () => {
    const encoded = createGameShare(game({ moves: [], resignedBy: BLACK, winner: WHITE }))
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = decodeShareToken(encoded.token)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok || decoded.kind !== 'game') return
    expect(decoded.game.ending).toEqual({ type: 'resign', winner: WHITE, resignedBy: BLACK })
  })

  it('中途回合分享为带 provenance 的局面', () => {
    const encoded = createReplayPositionShare(game(), 5)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = decodeShareToken(encoded.token)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok || decoded.kind !== 'position') return
    expect(decoded.position.board[7 * 15 + 3]).toBe(BLACK)
    expect(decoded.provenance?.ply).toBe(5)
    expect(decoded.title).toBe('棋谱第 5 手')
  })

  it('空盘自由局面往返', () => {
    const encoded = createPositionShare(createPosition(), '空盘', null)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = decodeShareToken(encoded.token)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok || decoded.kind !== 'position') return
    expect(decoded.position.board.every((cell) => cell === 0)).toBe(true)
    expect(decoded.provenance).toBeNull()
  })

  it('225 手棋谱与满盘局面都在长度上限内', () => {
    const moves = fullBoardMoves()
    const encodedGame = createGameShare(game({ moves }))
    expect(encodedGame.ok).toBe(true)
    if (encodedGame.ok) expect(encodedGame.token.length).toBeLessThanOrEqual(MAX_SHARE_TOKEN)

    let board = createPosition()
    for (const move of moves) {
      board = applyEdit(board, move, board.board[0] === 0 ? 'black' : 'white')
    }
    const encodedPosition = createPositionShare(board, '满盘', null)
    expect(encodedPosition.ok).toBe(true)
    if (encodedPosition.ok) {
      expect(encodedPosition.token.length).toBeLessThanOrEqual(MAX_SHARE_TOKEN)
    }
  })
})

describe('分享链接 —— 错误与边界', () => {
  it('未知版本拒绝', () => {
    const result = decodeShareToken('2.00000000.abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unsupported_version')
  })

  it('非法字符拒绝', () => {
    const result = decodeShareToken('1.00000000.***')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('malformed')
  })

  it('校验码不匹配拒绝', () => {
    const encoded = createGameShare(game())
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const parts = encoded.token.split('.')
    const tampered = `${parts[0]}.00000000.${parts[2]}`
    const result = decodeShareToken(tampered)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('checksum')
  })

  it('超长链接拒绝', () => {
    const result = decodeShareToken('1.00000000.' + 'a'.repeat(MAX_SHARE_TOKEN))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('too_long')
  })

  it('从 hash 读取 token，普通 hash 不误判', () => {
    expect(shareTokenFromHash('#share=abc')).toBe('abc')
    expect(shareTokenFromHash('#other')).toBeNull()
  })

  it('链接使用 origin + pathname + fragment', () => {
    const url = createShareUrl('abc', { origin: 'https://example.test', pathname: '/' })
    expect(url).toBe('https://example.test/#share=abc')
  })
})
