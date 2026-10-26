import { isReplayConsistent, type Position, type PositionProvenance } from '../core/position'
import type { Player } from '../core/types'
import {
  DB_NAME,
  DB_VERSION,
  ensureSchema,
  POSITIONS_STORE,
} from './schema'

const POSITION_SCHEMA_VERSION = 2
const LEGACY_POSITION_SCHEMA_VERSION = 1
const MAX_POSITION_TITLE = 80
/** `Date` 能表示的最大毫秒数；超过它 `new Date(x).getTime()` 是 NaN。 */
const MAX_DATE_MS = 8_640_000_000_000_000

export interface SavedPosition {
  readonly id: number
  readonly schemaVersion: number
  readonly title: string
  /** 225 个 0/1/2，行主序；与 core 的 Board 同序。 */
  readonly cells: readonly number[]
  readonly nextPlayer: Player
  readonly provenance: PositionProvenance | null
  /** 旧 v1 记录没有时间，迁移后为 null；UI 必须如实显示「时间未知」。 */
  readonly createdAt: number | null
  readonly updatedAt: number | null
}

export interface PositionInput {
  readonly title: string
  readonly cells: readonly number[]
  readonly nextPlayer: Player
  readonly provenance: PositionProvenance | null
}

export interface PositionList {
  readonly records: readonly SavedPosition[]
  readonly degraded: boolean
}

export interface SavePositionResult {
  readonly record: SavedPosition
  readonly persisted: boolean
}

export interface DeletePositionResult {
  readonly deleted: boolean
  /** 是否真正从 IndexedDB 删除；false 表示只删了本次会话的内存兜底。 */
  readonly persisted: boolean
}

export interface PositionStorage {
  list(): Promise<PositionList>
  get(id: number): Promise<SavedPosition | null>
  /** `now` 由调用方注入；存储层不直接读时钟。 */
  save(
    input: PositionInput,
    id: number | null,
    now: () => number,
  ): Promise<SavePositionResult>
  delete(id: number): Promise<DeletePositionResult>
}

function sortPositions(a: SavedPosition, b: SavedPosition): number {
  const at = a.updatedAt ?? -Infinity
  const bt = b.updatedAt ?? -Infinity
  if (at !== bt) return bt > at ? 1 : -1
  return b.id - a.id
}

function positionPayload(
  input: PositionInput,
  createdAt: number,
  updatedAt: number,
): Omit<SavedPosition, 'id'> {
  return {
    schemaVersion: POSITION_SCHEMA_VERSION,
    title: input.title.slice(0, MAX_POSITION_TITLE),
    cells: [...input.cells],
    nextPlayer: input.nextPlayer,
    provenance: input.provenance,
    createdAt,
    updatedAt,
  }
}

function isPlayer(value: unknown): value is Player {
  return value === 1 || value === 2
}

function parseProvenance(value: unknown): PositionProvenance | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (raw.kind !== 'replay') return null
  if (!isPlayer(raw.firstPlayer)) return null
  if (!Array.isArray(raw.moves)) return null
  if (typeof raw.ply !== 'number' || !Number.isInteger(raw.ply)) return null
  if (raw.ply !== raw.moves.length || raw.ply < 0 || raw.ply > 225) return null
  const moves: { x: number; y: number }[] = []
  for (const entry of raw.moves) {
    if (typeof entry !== 'object' || entry === null) return null
    const point = entry as Record<string, unknown>
    if (
      typeof point.x !== 'number' ||
      typeof point.y !== 'number' ||
      !Number.isInteger(point.x) ||
      !Number.isInteger(point.y) ||
      point.x < 0 ||
      point.x >= 15 ||
      point.y < 0 ||
      point.y >= 15
    ) {
      return null
    }
    moves.push({ x: point.x, y: point.y })
  }
  return { kind: 'replay', moves, firstPlayer: raw.firstPlayer, ply: raw.ply }
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DATE_MS
  )
}

interface PositionTimestamps {
  readonly createdAt: number | null
  readonly updatedAt: number | null
}

/**
 * 局面记录的时间字段迁移。
 *
 * v1 没有时间，只读补 `null`（不写回；下次保存才落 v2）。v2 的时间必须合法；
 * 版本不认识或时间损坏都返回 null，由解析层整条拒绝。迁移逻辑放在解析之前，
 * 与 `docs/data/SCHEMA_MIGRATION.md` §4 一致。
 */
function migratePositionTimestamps(
  value: Record<string, unknown>,
  version: unknown,
): PositionTimestamps | null {
  if (version === LEGACY_POSITION_SCHEMA_VERSION) {
    return { createdAt: null, updatedAt: null }
  }
  if (version !== POSITION_SCHEMA_VERSION) return null
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return null
  return { createdAt: value.createdAt, updatedAt: value.updatedAt }
}

export function parseSavedPosition(value: unknown): SavedPosition | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const timestamps = migratePositionTimestamps(raw, raw.schemaVersion)
  if (timestamps === null) return null
  if (typeof raw.id !== 'number' || !Number.isInteger(raw.id)) return null
  if (typeof raw.title !== 'string' || raw.title.length > MAX_POSITION_TITLE) return null
  if (!isPlayer(raw.nextPlayer)) return null
  if (!Array.isArray(raw.cells) || raw.cells.length !== 225) return null
  for (const cell of raw.cells) {
    if (cell !== 0 && cell !== 1 && cell !== 2) return null
  }
  const cells = [...raw.cells] as number[]
  const position: Position = { board: Uint8Array.from(cells), nextPlayer: raw.nextPlayer }
  let provenance = parseProvenance(raw.provenance)
  // 内部记录也不采信无法重建当前盘面的“已知手顺”：降级成自由摆盘，不丢盘面。
  if (provenance !== null && !isReplayConsistent(position, provenance)) provenance = null

  return {
    id: raw.id,
    // v1 记录在内存里规范成 v2；下次保存才会真正写成 v2。
    schemaVersion: POSITION_SCHEMA_VERSION,
    title: raw.title,
    cells,
    nextPlayer: raw.nextPlayer,
    provenance,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  }
}

export function positionFromSaved(record: SavedPosition): Position {
  return {
    board: Uint8Array.from(record.cells),
    nextPlayer: record.nextPlayer,
  }
}

export function inputFromPosition(
  position: Position,
  title: string,
  provenance: PositionProvenance | null,
): PositionInput {
  return {
    title: title.slice(0, MAX_POSITION_TITLE),
    cells: [...position.board],
    nextPlayer: position.nextPlayer,
    provenance,
  }
}

/** 局面内容身份：标题不参与；同一盘面/下一手/已知手顺视为同一条。 */
export function positionContentKey(input: PositionInput): string {
  return JSON.stringify([input.cells, input.nextPlayer, input.provenance])
}

// ── 内存实现（测试 + 降级） ──────────────────────────────────────

export function memoryPositions(degraded = false): PositionStorage {
  const byId = new Map<number, SavedPosition>()
  let nextId = 1

  return {
    async list() {
      return {
        records: [...byId.values()].sort(sortPositions),
        degraded,
      }
    },
    async get(id) {
      return byId.get(id) ?? null
    },
    async save(input, id, now) {
      const stamp = now()
      const target = id === null ? nextId++ : id
      const existing = byId.get(target)
      const record: SavedPosition = {
        ...positionPayload(input, existing?.createdAt ?? stamp, stamp),
        id: target,
      }
      byId.set(target, record)
      return { record, persisted: false }
    },
    async delete(id) {
      return { deleted: byId.delete(id), persisted: false }
    },
  }
}

// ── IndexedDB ───────────────────────────────────────────────────

const STORE = POSITIONS_STORE
let factory: IDBFactory | null = null
let memoryFallback: PositionStorage | null = null

export function __setPositionsIndexedDbFactory(next: IDBFactory | null): void {
  factory = next
  memoryFallback = null
}

function resolveFactory(): IDBFactory | null {
  if (factory !== null) return factory
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB
  } catch {
    return null
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const active = resolveFactory()
    if (active === null) {
      reject(new Error('IndexedDB 不可用'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = active.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    request.onupgradeneeded = () => ensureSchema(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('打不开局面库'))
    request.onblocked = () => reject(new Error('局面库被其他标签页占用'))
  })
}

function fallbackToMemory(): PositionStorage {
  if (memoryFallback === null) memoryFallback = memoryPositions(true)
  return memoryFallback
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = run(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(request.result)
        }
        tx.onerror = () => {
          db.close()
          reject(new Error('局面库读写失败'))
        }
        tx.onabort = () => {
          db.close()
          reject(new Error('局面库读写被中止'))
        }
      }),
    (error) => {
      throw error
    },
  )
}

export const indexedDbPositions: PositionStorage = {
  async list() {
    try {
      const raw = await withStore<unknown[]>('readonly', (store) => store.getAll())
      const records = raw
        .map(parseSavedPosition)
        .filter((record): record is SavedPosition => record !== null)
        .sort(sortPositions)
      return { records, degraded: false }
    } catch {
      return fallbackToMemory().list()
    }
  },

  async get(id) {
    try {
      const raw = await withStore<unknown>('readonly', (store) => store.get(id))
      return raw === undefined ? null : parseSavedPosition(raw)
    } catch {
      return fallbackToMemory().get(id)
    }
  },

  async save(input, id, now) {
    const stamp = now()
    const existing = id === null ? null : await indexedDbPositions.get(id)
    const payload = positionPayload(input, existing?.createdAt ?? stamp, stamp)
    try {
      if (id === null) {
        const newId = await withStore<IDBValidKey>('readwrite', (store) => store.add(payload))
        return {
          record: { ...payload, id: Number(newId) },
          persisted: true,
        }
      }
      await withStore<IDBValidKey>('readwrite', (store) => store.put({ ...payload, id }))
      return { record: { ...payload, id }, persisted: true }
    } catch {
      return fallbackToMemory().save(input, id, () => stamp)
    }
  },

  async delete(id) {
    try {
      await withStore<undefined>('readwrite', (store) => store.delete(id))
      return { deleted: true, persisted: true }
    } catch {
      return fallbackToMemory().delete(id)
    }
  },
}
