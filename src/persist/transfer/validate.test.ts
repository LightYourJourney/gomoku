import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, type Point } from '../../core/types'
import type { GameRecordInput } from '../gameRecords'
import { toGameFile, toBackupFile } from './format'
import { jsonDepth, MAX_IMPORT_BYTES, MAX_JSON_DEPTH, parseImportText } from './validate'

const NINE_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 },
  { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 },
  { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function winRecord(): GameRecordInput {
  return {
    moves: [...NINE_MOVES],
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
  }
}

function validGame(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(toGameFile(winRecord()))) as Record<string, unknown>
}

function parse(value: unknown) {
  return parseImportText(JSON.stringify(value))
}

describe('严格导入 · 文件级', () => {
  it('坏 JSON 被拒绝', () => {
    const result = parseImportText('{ not json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('invalid_json')
  })

  it('嵌套过深在 JSON.parse 之前被拒绝', () => {
    let nested: unknown = 1
    for (let i = 0; i < MAX_JSON_DEPTH + 2; i++) nested = { nested }
    const text = JSON.stringify(nested)
    expect(jsonDepth(text)).toBeGreaterThan(MAX_JSON_DEPTH)

    const result = parseImportText(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('too_deep')
  })

  it('未来格式版本被明确拒绝，不猜字段', () => {
    const result = parse({ ...validGame(), formatVersion: 2 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('unsupported_version')
  })

  it('未知格式被拒绝', () => {
    const result = parse({ format: 'something-else', formatVersion: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('wrong_format')
  })

  it('合法单盘不会把 format/board/rules 误报成未知字段', () => {
    const result = parse(validGame())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const paths = result.warnings.map((warning) => warning.path)
    expect(paths.some((path) => /\.(format|formatVersion|board|rules)$/.test(path))).toBe(false)
  })

  it('未知字段只警告，不参与解释', () => {
    const result = parse({ ...validGame(), futureField: 'ignored' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.warnings.filter((warning) => warning.path.endsWith('futureField')),
    ).toHaveLength(1)
  })
})

describe('严格导入 · 棋谱内容', () => {
  it('合法棋谱通过', () => {
    const result = parse(validGame())
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'game') return
    expect(result.game.moves).toHaveLength(9)
  })

  it('非整数坐标被拒绝', () => {
    const game = validGame()
    game.moves = [{ x: 1.5, y: 2 }]
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('bad_coordinate')
  })

  it('越界坐标被拒绝', () => {
    const game = validGame()
    game.moves = [{ x: 15, y: 0 }]
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('bad_coordinate')
  })

  it('重复落子被拒绝——不是悄悄截断', () => {
    const game = validGame()
    // 前 3 手还没结束，第 4 手重复第 1 手；这样才会命中「重复」而不是「终局后落子」。
    game.moves = [NINE_MOVES[0]!, NINE_MOVES[1]!, NINE_MOVES[2]!, NINE_MOVES[0]!]
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('duplicate_move')
  })

  it('终局后继续落子被拒绝', () => {
    const game = validGame()
    game.moves = [...NINE_MOVES, { x: 0, y: 0 }]
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('move_after_end')
  })

  it('胜负声明与手顺不一致被拒绝', () => {
    const game = validGame()
    game.ending = { type: 'five', winner: WHITE }
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('ending_conflict')
  })

  it('和棋声明没有下满棋盘时被拒绝', () => {
    const game = validGame()
    game.ending = { type: 'draw', winner: null }
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('ending_conflict')
  })

  it('认输：赢家必须是认输方的对手', () => {
    const game = validGame()
    game.moves = [{ x: 7, y: 7 }]
    game.ending = { type: 'resign', winner: WHITE, resignedBy: WHITE }
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('ending_conflict')
  })

  it('零手认输是合法的', () => {
    const game = validGame()
    game.moves = []
    game.ending = { type: 'resign', winner: BLACK, resignedBy: WHITE }
    const result = parse(game)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'game') return
    expect(result.game.ending).toEqual({ type: 'resign', winner: BLACK, resignedBy: WHITE })
  })

  it('手顺已经成五时不能再声明认输', () => {
    const game = validGame()
    game.ending = { type: 'resign', winner: WHITE, resignedBy: BLACK }
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('ending_conflict')
  })

  it('满盘 225 手的合法和棋可以通过（最大合法棋谱）', () => {
    const blacks: Point[] = []
    const whites: Point[] = []
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        // 周期染色：四个方向的最大同色连续段都 <= 2，满盘无五连。
        if ((x + 2 * y) % 4 < 2) blacks.push({ x, y })
        else whites.push({ x, y })
      }
    }
    expect(blacks).toHaveLength(113)
    expect(whites).toHaveLength(112)

    const moves: Point[] = []
    for (let i = 0; i < blacks.length; i++) {
      moves.push(blacks[i]!)
      if (i < whites.length) moves.push(whites[i]!)
    }
    expect(moves).toHaveLength(225)

    const game = validGame()
    game.moves = moves
    game.ending = { type: 'draw', winner: null }
    const result = parse(game)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'game') return
    expect(result.game.moves).toHaveLength(225)
    expect(result.game.ending).toEqual({ type: 'draw', winner: null })
  })

  it('超过 225 手被拒绝', () => {
    const game = validGame()
    game.moves = Array.from({ length: 226 }, (_, i) => ({ x: i % 15, y: Math.floor(i / 15) }))
    const result = parse(game)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('too_many_moves')
  })
})

describe('严格导入 · 备份', () => {
  it('部分棋谱无效时保留有效棋谱并点名索引', () => {
    const good = JSON.parse(JSON.stringify(toGameFile(winRecord())))
    const bad = { ...good, moves: [...good.moves, good.moves[0]] }
    const backup = {
      ...JSON.parse(JSON.stringify(toBackupFile({ games: [] }))),
      games: [good, bad],
    }
    const result = parse(backup)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'backup') return
    expect(result.games).toHaveLength(1)
    expect(result.gameErrors).toEqual([{ index: 1, errors: expect.any(Array) }])
  })

  it('进度段损坏时只跳过该段，不影响棋谱', () => {
    const backup = JSON.parse(JSON.stringify(toBackupFile({ games: [winRecord()] })))
    backup.progress = { completedLessons: ['rules', 7], solvedPuzzles: [], lastView: 'learn' }
    const result = parse(backup)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'backup') return
    expect(result.games).toHaveLength(1)
    expect(result.progress).toBeNull()
    expect(result.warnings.some((warning) => warning.path.includes('progress'))).toBe(true)
  })

  it('会话段损坏时只跳过该段', () => {
    const backup = JSON.parse(JSON.stringify(toBackupFile({ games: [winRecord()] })))
    backup.session = { moves: [{ x: 99, y: 0 }], firstPlayer: 1, mode: 'pve', humanColor: 1, difficulty: 'easy', resignedBy: null }
    const result = parse(backup)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'backup') return
    expect(result.session).toBeNull()
    expect(result.warnings.some((warning) => warning.path.includes('session'))).toBe(true)
  })

  it('2000 局备份仍可解析，且 JSON 不超过导入上限', () => {
    const backup = toBackupFile({
      games: Array.from({ length: 2_000 }, () => winRecord()),
    })
    const text = JSON.stringify(backup)
    expect(new TextEncoder().encode(text).length).toBeLessThan(MAX_IMPORT_BYTES)

    const result = parseImportText(text)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'backup') return
    expect(result.games).toHaveLength(2_000)
  })

  it('超过 2000 局被拒绝', () => {
    const good = JSON.parse(JSON.stringify(toGameFile(winRecord())))
    const backup = {
      ...JSON.parse(JSON.stringify(toBackupFile({ games: [] }))),
      games: Array.from({ length: 2_001 }, () => good),
    }
    const result = parse(backup)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('too_many_games')
  })

  it('未来备份版本被拒绝', () => {
    const backup = { ...JSON.parse(JSON.stringify(toBackupFile({ games: [] }))), formatVersion: 9 }
    const result = parse(backup)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]!.code).toBe('unsupported_version')
  })
})
