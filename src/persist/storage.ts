import { isDifficulty } from '../ai/difficulty'
import type { Difficulty } from '../ai/types'
import { inBounds } from '../core/board'
import type { Player, Point } from '../core/types'

/** 存档格式版本。字段含义发生变化时递增，旧存档会被安全丢弃。 */
export const SCHEMA_VERSION = 1

export const STORAGE_KEY = 'gomoku-lab:session'

export interface PersistedSession {
  readonly schemaVersion: number
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  readonly mode: 'pve' | 'pvp'
  readonly humanColor: Player
  readonly difficulty: Difficulty
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

  if (value.schemaVersion !== SCHEMA_VERSION) return null
  if (!isPlayer(value.firstPlayer)) return null
  if (!isPlayer(value.humanColor)) return null
  if (value.mode !== 'pve' && value.mode !== 'pvp') return null
  if (!isDifficulty(value.difficulty)) return null
  if (!Array.isArray(value.moves)) return null

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
  }
}

/** 存档失败（隐私模式、配额已满）不应打断对局，因此静默忽略。 */
export function saveSession(input: Omit<PersistedSession, 'schemaVersion'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeSession(input))
  } catch {
    // 忽略
  }
}

export function loadSession(): PersistedSession | null {
  try {
    return decodeSession(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
