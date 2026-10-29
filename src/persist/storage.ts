import { isDifficulty } from '../ai/difficulty'
import type { Difficulty } from '../ai/types'
import { inBounds } from '../core/board'
import type { Player, Point } from '../core/types'

/** 存档格式版本。字段含义发生变化时递增，旧存档会被安全丢弃。 */
export const SCHEMA_VERSION = 3

export const STORAGE_KEY = 'gomoku-lab:session'

export interface PersistedBranch {
  readonly sourceSeq: number
  readonly sourceContentKey: string
  readonly cursor: number
  readonly sourceMoves: number
}

export interface PersistedSession {
  readonly schemaVersion: number
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  readonly mode: 'pve' | 'pvp'
  readonly humanColor: Player
  readonly difficulty: Difficulty
  /**
   * 认输的一方，null 表示这局还没认输。
   *
   * 手顺能还原出胜负与和棋，唯独还原不出认输——所以它必须单独存。
   * 少了这个字段，认输后刷新页面会让对局复活成进行中。
   */
  readonly resignedBy: Player | null
  /** 探索分支来源；v1/v2 没有，迁移后为 null。 */
  /** 旧调用方可省略；解码 v1/v2 会补 null。 */
  readonly branch?: PersistedBranch | null
}

function isPlayer(value: unknown): value is Player {
  return value === 1 || value === 2
}

function parsePoint(value: unknown): Point | null {
  if (typeof value !== 'object' || value === null) return null

  const { x, y } = value as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!inBounds(x, y)) return null

  return { x, y }
}

/**
 * 把 v1 的 `resignedBy` 迁移到 v2 语义。v1 没有这个字段，认输局无法恢复；
 * 迁移只发生在读取时，不写回旧值——真正落 v2 要等下一次状态变化。
 * 返回 `undefined` 表示字段非法，整条存档拒绝。
 */
function migratedResignedBy(value: unknown, version: number): Player | null | undefined {
  if (version === 1) return null
  if (value === null) return null
  return isPlayer(value) ? value : undefined
}

function parseBranch(value: unknown, version: number): PersistedBranch | null | undefined {
  if (version < 3 || value === null || value === undefined) return null
  if (typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (
    typeof raw.sourceSeq !== 'number' ||
    !Number.isInteger(raw.sourceSeq) ||
    typeof raw.sourceContentKey !== 'string' ||
    typeof raw.cursor !== 'number' ||
    !Number.isInteger(raw.cursor) ||
    typeof raw.sourceMoves !== 'number' ||
    !Number.isInteger(raw.sourceMoves)
  ) {
    return undefined
  }
  return {
    sourceSeq: raw.sourceSeq,
    sourceContentKey: raw.sourceContentKey,
    cursor: raw.cursor,
    sourceMoves: raw.sourceMoves,
  }
}

export function encodeSession(input: Omit<PersistedSession, 'schemaVersion'>): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...input } satisfies PersistedSession)
}

/**
 * 解析存档。任何一处不符合预期都返回 null —— 宁可当作没有存档重开一局，
 * 也不能把半截损坏的数据灌进状态机。
 *
 * 这里只校验结构；「手顺里有没有重复落子」之类的语义问题交给 replay，
 * 它会自然地截断到最后一个合法手。
 */
export function decodeSession(raw: string | null): PersistedSession | null {
  if (raw === null || raw === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const value = parsed as Record<string, unknown>

  /*
   * v1 → v2 迁移：v1 没有 `resignedBy`，认输局无法恢复（当时就没存）。
   * 这是**只读迁移**——解析成功后在内存里补 `null`，下次写入自然升到 v2；
   * 解析失败仍然整条拒绝，不会把半截 v1 存档灌进状态机。
   */
  const version = value.schemaVersion
  if (version !== 1 && version !== 2 && version !== SCHEMA_VERSION) return null
  if (!isPlayer(value.firstPlayer)) return null
  if (!isPlayer(value.humanColor)) return null
  if (value.mode !== 'pve' && value.mode !== 'pvp') return null
  if (!isDifficulty(value.difficulty)) return null
  if (!Array.isArray(value.moves)) return null

  const resignedBy = migratedResignedBy(value.resignedBy, version)
  if (resignedBy === undefined) return null
  const branch = parseBranch(value.branch, version)
  if (branch === undefined) return null

  const moves: Point[] = []
  for (const entry of value.moves) {
    const point = parsePoint(entry)
    if (point === null) return null
    moves.push(point)
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    moves,
    firstPlayer: value.firstPlayer,
    mode: value.mode,
    humanColor: value.humanColor,
    difficulty: value.difficulty,
    resignedBy,
    ...(branch === null ? {} : { branch }),
  }
}

/** 存档失败（隐私模式、配额已满）不应打断对局；返回是否真的写进 localStorage。 */
export function saveSession(input: Omit<PersistedSession, 'schemaVersion'>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, encodeSession(input))
    return true
  } catch {
    return false
  }
}

export interface SessionLoadResult {
  readonly session: PersistedSession | null
  /** 有存档但读不回来时的具体原因；没有存档/读成功时为 null。 */
  readonly error: string | null
}

function describeSessionError(raw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return '不是合法 JSON'
  }
  if (typeof parsed !== 'object' || parsed === null) return '顶层不是对象'

  const version = (parsed as Record<string, unknown>).schemaVersion
  if (version !== 1 && version !== 2 && version !== SCHEMA_VERSION) {
    return `存档版本 ${String(version)} 不受支持（当前 ${SCHEMA_VERSION}）`
  }
  return `v${String(version)} 存档字段不完整或类型错误`
}

/** 带原因版本：供启动时把「旧存档没能迁移」如实告诉用户。 */
export function loadSessionResult(): SessionLoadResult {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { session: null, error: '读取 localStorage 失败' }
  }
  if (raw === null || raw === '') return { session: null, error: null }

  const session = decodeSession(raw)
  return session === null
    ? { session: null, error: describeSessionError(raw) }
    : { session, error: null }
}

export function loadSession(): PersistedSession | null {
  try {
    return decodeSession(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}
