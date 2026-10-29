import { ENGINE_VERSION } from '../../ai/version'
import { opponentOf } from '../../core/board'
import { replay } from '../../core/game'
import { BOARD_SIZE, type Player, type Point } from '../../core/types'
import type { Difficulty } from '../../ai/types'
import type { ThemePreference } from '../../lib/theme'
import type { GameRecord, GameRecordInput } from '../gameRecords'
import type { LearningProgress } from '../progress'
import type { PersistedSession } from '../storage'
import { recordContentKey, type RecordIdentity } from '../recordIdentity'

/**
 * 对外交换格式。
 *
 * **与 IndexedDB 的内部对象是两件事**：内部记录带自增 `seq` 与 `schemaVersion`，
 * 它们只在当前浏览器/当前库里成立；文件格式只描述这局棋本身，换设备、清库、
 * 再导入都成立。两者分开版本号，内部结构升级不必让文件版本跟着动。
 */
export const GAME_FORMAT = 'gomoku-lab.game'
export const BACKUP_FORMAT = 'gomoku-lab.backup'
export const GAME_FORMAT_VERSION = 1
export const BACKUP_FORMAT_VERSION = 2
export const RULES_FREESTYLE = 'freestyle'

export type GameEnding =
  | { readonly type: 'five'; readonly winner: Player }
  | { readonly type: 'draw'; readonly winner: null }
  | { readonly type: 'resign'; readonly winner: Player; readonly resignedBy: Player }

/** 来源元数据，可选；只记应用/引擎名，不记账号、IP、浏览器指纹或时间。 */
export interface SourceMeta {
  readonly app: 'gomoku-lab'
  readonly engineVersion: string
}

export interface GamePayload {
  readonly firstPlayer: Player
  readonly moves: readonly Point[]
  readonly mode: 'pve' | 'pvp'
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly ending: GameEnding
  readonly source?: SourceMeta
}

export interface GameFile extends GamePayload {
  readonly format: typeof GAME_FORMAT
  readonly formatVersion: number
  readonly board: { readonly size: number }
  readonly rules: typeof RULES_FREESTYLE
}

export interface BackupProgress {
  readonly completedLessons: readonly string[]
  readonly solvedPuzzles: readonly string[]
  readonly lastVisited: LearningProgress['lastVisited']
  readonly lastView: LearningProgress['lastView']
}

export interface BackupPreferences {
  readonly theme: ThemePreference
  readonly showCoords: boolean
  readonly soundEnabled: boolean
}

export interface BackupSession {
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  readonly mode: 'pve' | 'pvp'
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly resignedBy: Player | null
  readonly branch?: {
    readonly sourceSeq: number
    readonly sourceContentKey: string
    readonly cursor: number
    readonly sourceMoves: number
  } | null
}

export interface BackupPosition {
  readonly title: string | null
  readonly cells: readonly number[]
  readonly nextPlayer: Player
  readonly provenance: {
    readonly kind: 'replay'
    readonly moves: readonly Point[]
    readonly firstPlayer: Player
    readonly ply: number
  } | null
}

export interface BackupFile {
  readonly format: typeof BACKUP_FORMAT
  readonly formatVersion: number
  readonly board: { readonly size: number }
  readonly rules: typeof RULES_FREESTYLE
  /** 只放棋谱内容，不再嵌套一份 format/board/rules。 */
  readonly games: readonly GamePayload[]
  /**
   * 可选：导出全部棋谱时省略，完整备份时存在。字段缺失表示「这份文件不包含
   * 该部分」，导入时不得把它当成「空进度」去覆盖本地。
   */
  readonly progress?: BackupProgress
  readonly preferences?: BackupPreferences
  readonly session?: BackupSession | null
  /** 完整备份 v2 起包含；导出全部棋谱时省略。 */
  readonly positions?: readonly BackupPosition[]
  readonly source?: SourceMeta
}

const SOURCE_META: SourceMeta = { app: 'gomoku-lab', engineVersion: ENGINE_VERSION }

/** 内部记录（或导入的载荷）→ 对外单盘载荷。未结束的棋不能导出。 */
export function toGamePayload(record: RecordIdentity): GamePayload {
  const state = replay(record.moves, record.firstPlayer)

  if (record.resignedBy !== null) {
    if (state.status !== 'playing') {
      throw new Error('认输局的手顺本身已经结束，不能导出')
    }
    return {
      firstPlayer: record.firstPlayer,
      moves: [...record.moves],
      mode: record.mode,
      humanColor: record.humanColor,
      difficulty: record.difficulty,
      ending: { type: 'resign', winner: opponentOf(record.resignedBy), resignedBy: record.resignedBy },
      source: SOURCE_META,
    }
  }

  if (state.status === 'won' && state.winner !== null) {
    return {
      firstPlayer: record.firstPlayer,
      moves: [...record.moves],
      mode: record.mode,
      humanColor: record.humanColor,
      difficulty: record.difficulty,
      ending: { type: 'five', winner: state.winner },
      source: SOURCE_META,
    }
  }

  if (state.status === 'draw') {
    return {
      firstPlayer: record.firstPlayer,
      moves: [...record.moves],
      mode: record.mode,
      humanColor: record.humanColor,
      difficulty: record.difficulty,
      ending: { type: 'draw', winner: null },
      source: SOURCE_META,
    }
  }

  throw new Error('对局还没结束，不能导出为棋谱文件')
}

export function toGameFile(record: RecordIdentity): GameFile {
  return {
    format: GAME_FORMAT,
    formatVersion: GAME_FORMAT_VERSION,
    board: { size: BOARD_SIZE },
    rules: RULES_FREESTYLE,
    ...toGamePayload(record),
  }
}

/** 内容身份：只取这局棋本身，来源元数据与文件外壳不参与重复判断。 */
function resignedByOfEnding(ending: GameEnding): Player | null {
  return ending.type === 'resign' ? ending.resignedBy : null
}

/** 外部单盘载荷 → 棋谱库写入输入。分享导入与文件导入共用这一处转换。 */
export function gamePayloadToRecordInput(game: GamePayload): GameRecordInput {
  return {
    moves: game.moves,
    firstPlayer: game.firstPlayer,
    mode: game.mode,
    humanColor: game.humanColor,
    difficulty: game.difficulty,
    resignedBy: resignedByOfEnding(game.ending),
  }
}

export function gameContentKey(game: GamePayload): string {
  return recordContentKey({
    firstPlayer: game.firstPlayer,
    moves: game.moves,
    mode: game.mode,
    humanColor: game.humanColor,
    difficulty: game.difficulty,
    resignedBy: resignedByOfEnding(game.ending),
  })
}

function backupProgressOf(progress: LearningProgress): BackupProgress {
  return {
    completedLessons: [...progress.completedLessons],
    solvedPuzzles: [...progress.solvedPuzzles],
    lastVisited: progress.lastVisited,
    lastView: progress.lastView,
  }
}

export function backupSessionOf(session: PersistedSession | null): BackupSession | null {
  if (session === null) return null
  return {
    moves: [...session.moves],
    firstPlayer: session.firstPlayer,
    mode: session.mode,
    humanColor: session.humanColor,
    difficulty: session.difficulty,
    resignedBy: session.resignedBy,
    ...(session.branch === undefined ? {} : { branch: session.branch }),
  }
}

export type BackupGameInput = GameRecord | GameRecordInput | GamePayload

export interface BackupInput {
  readonly games: readonly BackupGameInput[]
  readonly progress?: LearningProgress | null
  readonly preferences?: BackupPreferences | null
  /** `undefined` 表示这份文件不含会话；`null` 表示明确「没有进行中的对局」。 */
  readonly session?: PersistedSession | null
  readonly positions?: readonly BackupPosition[] | null
}

/** 完整备份。`progress` / `preferences` / `session` 不传就省略该段。 */
export function toBackupFile(input: BackupInput): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    board: { size: BOARD_SIZE },
    rules: RULES_FREESTYLE,
    games: input.games.map((game) => ('ending' in game ? game : toGamePayload(game))),
    ...(input.progress === undefined || input.progress === null
      ? {}
      : { progress: backupProgressOf(input.progress) }),
    ...(input.preferences === undefined || input.preferences === null
      ? {}
      : { preferences: input.preferences }),
    ...(input.session === undefined ? {} : { session: backupSessionOf(input.session) }),
    ...(input.positions === undefined || input.positions === null
      ? {}
      : { positions: input.positions }),
    source: SOURCE_META,
  }
}

export function exportFilename(
  kind: 'game' | 'games' | 'backup' | 'position',
  now: () => number,
): string {
  // UTC + 固定宽度：同一时刻在任何时区得到同一个文件名，测试可注入。
  const stamp = new Date(now()).toISOString().replace(/\D/g, '').slice(0, 14)
  return `gomoku-lab-${kind}-${stamp}.json`
}
