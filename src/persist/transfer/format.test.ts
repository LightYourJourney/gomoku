import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, type Point } from '../../core/types'
import type { GameRecordInput } from '../gameRecords'
import type { LearningProgress } from '../progress'
import {
  BACKUP_FORMAT,
  backupSessionOf,
  exportFilename,
  GAME_FORMAT,
  gameContentKey,
  toBackupFile,
  toGameFile,
  toGamePayload,
} from './format'
import { parseImportText } from './validate'

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

const PROGRESS: LearningProgress = {
  schemaVersion: 1,
  completedLessons: ['rules', 'two'],
  solvedPuzzles: ['win-h'],
  lastVisited: { kind: 'lesson', id: 'three' },
  lastView: 'learn',
}

describe('对外格式 · 单盘', () => {
  it('导出再解析，内容逐项一致', () => {
    const file = toGameFile(winRecord())
    expect(file.format).toBe(GAME_FORMAT)
    expect(file.formatVersion).toBe(1)
    expect(file.ending).toEqual({ type: 'five', winner: BLACK })

    const parsed = parseImportText(JSON.stringify(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.kind !== 'game') return
    expect(parsed.game.firstPlayer).toBe(BLACK)
    expect(parsed.game.moves).toEqual(NINE_MOVES)
    expect(parsed.game.mode).toBe('pvp')
    expect(parsed.game.difficulty).toBe('easy')
    expect(parsed.game.ending).toEqual({ type: 'five', winner: BLACK })
  })

  it('认输局导出为 resign，零手认输也成立', () => {
    const payload = toGamePayload({
      ...winRecord(),
      moves: [],
      resignedBy: WHITE,
    })
    expect(payload.ending).toEqual({ type: 'resign', winner: BLACK, resignedBy: WHITE })
    expect(payload.moves).toEqual([])
  })

  it('未结束的对局不能导出成棋谱文件', () => {
    expect(() => toGameFile({ ...winRecord(), moves: NINE_MOVES.slice(0, 3) })).toThrow(/没结束/)
  })

  it('内容身份不看 seq / 来源元数据', () => {
    const a = toGamePayload(winRecord())
    const b = { ...a, source: { app: 'gomoku-lab' as const, engineVersion: 'other' } }
    expect(gameContentKey(a)).toBe(gameContentKey(b))
  })

  it('手顺不同就是不同的一局', () => {
    const a = toGamePayload(winRecord())
    expect(gameContentKey(a)).not.toBe(gameContentKey({ ...a, moves: [...a.moves].reverse() }))
  })

  it('文件名由注入时钟决定，UTC、固定宽度', () => {
    const at = Date.UTC(2026, 9, 22, 15, 30, 0)
    expect(exportFilename('backup', () => at)).toBe('gomoku-lab-backup-20261022153000.json')
  })
})

describe('对外格式 · 完整备份', () => {
  it('棋谱、进度、偏好、会话一起往返', () => {
    const session = {
      schemaVersion: 2,
      moves: [{ x: 7, y: 7 }],
      firstPlayer: BLACK,
      mode: 'pve' as const,
      humanColor: WHITE,
      difficulty: 'medium' as const,
      resignedBy: null,
    }
    const backup = toBackupFile({
      games: [winRecord()],
      progress: PROGRESS,
      preferences: { theme: 'dark', showCoords: false, soundEnabled: true },
      session,
    })
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.games).toHaveLength(1)
    expect(backup.progress).toEqual({
      completedLessons: ['rules', 'two'],
      solvedPuzzles: ['win-h'],
      lastVisited: { kind: 'lesson', id: 'three' },
      lastView: 'learn',
    })
    expect(backup.session).toEqual(backupSessionOf(session))

    const parsed = parseImportText(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.kind !== 'backup') return
    expect(parsed.games).toHaveLength(1)
    expect(parsed.progress).toEqual(backup.progress)
    expect(parsed.preferences).toEqual(backup.preferences)
    expect(parsed.session).toEqual(backup.session)
    expect(parsed.gameErrors).toEqual([])
  })

  it('只导出棋谱时不含进度/偏好/会话段', () => {
    const backup = toBackupFile({ games: [winRecord()] })
    expect('progress' in backup).toBe(false)
    expect('preferences' in backup).toBe(false)
    expect('session' in backup).toBe(false)
  })

  it('一条坏棋谱不会让整份备份失败，但会被点名', () => {
    const good = toGamePayload(winRecord())
    const bad = { ...good, moves: [...good.moves, good.moves[0]!] }
    const parsed = parseImportText(
      JSON.stringify({
        ...toBackupFile({ games: [winRecord()] }),
        games: [good, bad],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.kind !== 'backup') return
    expect(parsed.games).toHaveLength(1)
    expect(parsed.gameErrors).toHaveLength(1)
    expect(parsed.gameErrors[0]!.index).toBe(1)
  })
})
