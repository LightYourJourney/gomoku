import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, type Point } from './types'
import {
  applyEdit,
  analyzePosition,
  clonePosition,
  createPosition,
  findWins,
  isReplayConsistent,
  positionFromReplay,
  setNextPlayer,
  EMPTY_POSITION,
} from './position'

const NINE_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 },
  { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 },
  { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

describe('Position —— 与 GameState 分离的盘面快照', () => {
  it('空盘、黑先，静态一致且可搜索', () => {
    expect(EMPTY_POSITION.nextPlayer).toBe(BLACK)
    const report = analyzePosition(EMPTY_POSITION)
    expect(report.black).toBe(0)
    expect(report.white).toBe(0)
    expect(report.parity).toBe('ok')
    expect(report.searchable).toBe(true)
    expect(report.wins).toEqual([])
  })

  it('放黑/白/擦除只改盘面，不伪造手顺', () => {
    let position = createPosition()
    position = applyEdit(position, { x: 7, y: 7 }, 'black')
    position = applyEdit(position, { x: 7, y: 8 }, 'white')
    expect(analyzePosition(position).black).toBe(1)
    expect(analyzePosition(position).white).toBe(1)

    position = applyEdit(position, { x: 7, y: 8 }, 'erase')
    expect(analyzePosition(position).white).toBe(0)
    expect(position.nextPlayer).toBe(BLACK)
  })

  it('覆盖已有棋子是明确的替换，不是落子', () => {
    let position = applyEdit(createPosition(), { x: 7, y: 7 }, 'black')
    position = applyEdit(position, { x: 7, y: 7 }, 'white')
    expect(position.board[7 * 15 + 7]).toBe(WHITE)
  })

  it('设置下一手颜色', () => {
    const position = setNextPlayer(EMPTY_POSITION, WHITE)
    expect(position.nextPlayer).toBe(WHITE)
    expect(analyzePosition(position).parity).toBe('mismatch')
  })

  it('切换下一手不改变盘面', () => {
    const before = applyEdit(createPosition(), { x: 0, y: 0 }, 'black')
    const after = setNextPlayer(before, WHITE)
    expect([...after.board]).toEqual([...before.board])
  })
})

describe('Position —— 静态规则检查', () => {
  it('黑五连：识别胜利，局面已结束，不可搜索', () => {
    let position = createPosition()
    for (const point of [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
    ]) {
      position = applyEdit(position, point, 'black')
    }
    const wins = findWins(position.board)
    expect(wins).toHaveLength(1)
    expect(wins[0]!.player).toBe(BLACK)
    expect(wins[0]!.points).toHaveLength(5)

    const report = analyzePosition(position)
    expect(report.blackWin).toBe(true)
    expect(report.ended).toBe(true)
    expect(report.searchable).toBe(false)
    expect(report.issues.join('')).toContain('已结束')
  })

  it('双方同时五连：明确报异常，不可搜索', () => {
    let position = createPosition()
    for (const point of [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
    ]) {
      position = applyEdit(position, point, 'black')
    }
    for (const point of [
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 },
    ]) {
      position = applyEdit(position, point, 'white')
    }
    const report = analyzePosition(position)
    expect(report.bothWin).toBe(true)
    expect(report.searchable).toBe(false)
    expect(report.issues.join('')).toContain('同时')
  })

  it('手数奇偶与下一手不符：提示但不崩', () => {
    let position = createPosition()
    position = applyEdit(position, { x: 7, y: 7 }, 'black')
    // 黑 1 / 白 0，下一手仍是黑 → 正常应轮到白
    const report = analyzePosition(position)
    expect(report.parity).toBe('mismatch')
    expect(report.searchable).toBe(false)
    expect(report.issues.join('')).toContain('下一手')
  })

  it('满盘无五连：和棋，不可搜索', () => {
    let position = createPosition()
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
    for (const point of moves) {
      const color = blacks.includes(point) ? 'black' : 'white'
      position = applyEdit(position, point, color)
    }
    const report = analyzePosition(position)
    expect(report.full).toBe(true)
    expect(report.blackWin || report.whiteWin).toBe(false)
    expect(report.ended).toBe(true)
    expect(report.searchable).toBe(false)
  })
})

describe('Position —— 已知手顺与合法性分级', () => {
  it('从棋谱第 0/5/9 手生成快照，并保留已知手顺', () => {
    const start = positionFromReplay(NINE_MOVES, BLACK, 0)
    expect(start.position.nextPlayer).toBe(BLACK)
    expect(start.provenance.moves).toEqual([])

    const mid = positionFromReplay(NINE_MOVES, BLACK, 5)
    expect(mid.provenance.moves).toHaveLength(5)
    expect(mid.position.nextPlayer).toBe(WHITE)

    const end = positionFromReplay(NINE_MOVES, BLACK, 9)
    expect(end.position.nextPlayer).toBe(WHITE)
    expect(analyzePosition(end.position).blackWin).toBe(true)
    expect(isReplayConsistent(end.position, end.provenance)).toBe(true)
  })

  it('前缀含非法落子时直接报错，不把截断盘面当第 N 手', () => {
    expect(() =>
      positionFromReplay([{ x: 7, y: 7 }, { x: 7, y: 7 }], BLACK, 2),
    ).toThrow(RangeError)
  })

  it('越界、负数或非整数回放位置直接报错，不静默 clamp', () => {
    expect(() => positionFromReplay(NINE_MOVES, BLACK, -1)).toThrow(RangeError)
    expect(() => positionFromReplay(NINE_MOVES, BLACK, 10)).toThrow(RangeError)
    expect(() => positionFromReplay(NINE_MOVES, BLACK, 1.5)).toThrow(RangeError)
  })

  it('编辑后或手顺含非法尾段，都不再能证明当前盘面', () => {
    const loaded = positionFromReplay(NINE_MOVES, BLACK, 5)
    const edited = applyEdit(loaded.position, { x: 0, y: 0 }, 'black')
    expect(isReplayConsistent(edited, loaded.provenance)).toBe(false)

    // replay 遇到重复落子会提前截断；盘面虽能对上，手顺本身并不完整。
    const truncated = {
      ...loaded.provenance,
      moves: [...loaded.provenance.moves, { x: 3, y: 7 }],
      ply: 6,
    }
    expect(isReplayConsistent(loaded.position, truncated)).toBe(false)
  })

  it('clonePosition 不会共享 Uint8Array', () => {
    const position = applyEdit(createPosition(), { x: 7, y: 7 }, 'black')
    const clone = clonePosition(position)
    clone.board[0] = WHITE
    expect(position.board[0]).toBe(0)
  })
})
