import { isReplayConsistent, type Position, type PositionProvenance } from '../core/position'
import type { Player } from '../core/types'
import { positionContentKey } from './positionKey'
export { positionContentKey } from './positionKey'
import { openDatabaseWithSchema, withObjectStore } from './idb'
import { POSITIONS_CONTENT_INDEX, POSITIONS_STORE } from './schema'

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
  /** 盘面/下一手/已知手顺的唯一键；DB v4 的唯一索引。 */
  readonly contentKey: string
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
    contentKey: positionContentKey(input),
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
    contentKey: positionContentKey({ cells, nextPlayer: raw.nextPlayer, provenance }),
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
      const key = positionContentKey(input)
      const duplicate = [...byId.values()].find((record) => record.contentKey === key)
      if (duplicate !== undefined) {
        if (id === null) return { record: duplicate, persisted: false }
        if (duplicate.id !== id) throw new Error('同一盘面已存在，未覆盖原记录')
      }
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
  // 测试隔离：换工厂等于换一个存储会话，回填也要重新允许。
  backfillDone = false
  backfillPending = null
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
  return openDatabaseWithSchema(resolveFactory(), {
    errorMessage: '打不开局面库',
    blockedMessage: '局面库被其他标签页占用',
    // 每个会话最多扫一次：`openDatabase` 会被 list/get/save 反复调用，
    // 每次都全表回填会把读操作变成写事务。
    onOpen: (db) => backfillOnce(db),
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
      withObjectStore(db, STORE, mode, run, {
        errorMessage: '局面库读写失败',
        abortMessage: '局面库读写被中止',
      }),
    (error) => {
      throw error
    },
  )
}

function readPosition(
  db: IDBDatabase,
  run: (store: IDBObjectStore) => IDBRequest<unknown>,
): Promise<SavedPosition | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = run(tx.objectStore(STORE))
    tx.oncomplete = () =>
      resolve(request.result === undefined ? null : parseSavedPosition(request.result))
    tx.onerror = () => reject(new Error('局面库读取失败'))
    tx.onabort = () => reject(new Error('局面库读取被中止'))
  })
}

let backfillDone = false
let backfillPending: Promise<void> | null = null

/** 回填只在首次成功前重试；失败不阻断读取，下次会话再试。 */
function backfillOnce(db: IDBDatabase): Promise<void> {
  if (backfillDone) return Promise.resolve()
  if (backfillPending !== null) return backfillPending
  backfillPending = backfillContentKeys(db)
    .then(() => {
      backfillDone = true
    })
    .catch(() => {
      // 失败保持未完成状态，下次打开重试。
    })
    .finally(() => {
      backfillPending = null
    })
  return backfillPending
}

/** 把旧记录的内容键规范成读取路径会算出的值；重复键只回填第一条。 */
async function backfillContentKeys(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const seen = new Set<string>()
    store.openCursor().onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
      if (cursor === null) return
      const record = parseSavedPosition(cursor.value)
      if (record === null) {
        cursor.continue()
        return
      }
      if (seen.has(record.contentKey)) {
        cursor.continue()
        return
      }
      seen.add(record.contentKey)
      const raw = cursor.value as { contentKey?: unknown }
      if (raw.contentKey !== record.contentKey) {
        const update = cursor.update({ ...cursor.value, contentKey: record.contentKey })
        // IDB 的约束错误是**异步**的：不 preventDefault 会中止整笔回填事务，
        // 把其余记录也一起回滚。单条冲突只跳过该条，读取侧仍按规范化键展示。
        update.onerror = (event) => event.preventDefault()
      }
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error('局面内容键回填失败'))
    tx.onabort = () => reject(new Error('局面内容键回填被中止'))
  })
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
    let db: IDBDatabase
    try {
      db = await openDatabase()
    } catch {
      // 打不开库才是“本次会话内存兜底”；list() 也会走同一份兜底。
      return fallbackToMemory().save(input, id, () => stamp)
    }

    const contentKey = positionContentKey(input)
    const findByContentKey = (): Promise<SavedPosition | null> =>
      readPosition(db, (store) => store.index(POSITIONS_CONTENT_INDEX).get(contentKey))

    try {
      const duplicate = await findByContentKey()
      if (duplicate !== null) {
        if (id === null) return { record: duplicate, persisted: true }
        if (duplicate.id !== id) throw new Error('同一盘面已存在，未覆盖原记录')
      }
      const existing = id === null ? null : await readPosition(db, (store) => store.get(id))
      const payload = positionPayload(input, existing?.createdAt ?? stamp, stamp)
      const newId = await new Promise<IDBValidKey>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const request = id === null ? tx.objectStore(STORE).add(payload) : tx.objectStore(STORE).put({ ...payload, id })
        tx.oncomplete = () => resolve(request.result)
        tx.onerror = () => reject(request.error ?? new Error('局面库写入失败'))
        tx.onabort = () => reject(request.error ?? new Error('局面库写入被中止'))
      })
      return { record: { ...payload, id: id ?? Number(newId) }, persisted: true }
    } catch (error) {
      if (error instanceof Error && error.message === '同一盘面已存在，未覆盖原记录') throw error
      // 唯一索引/并发下 ADD 失败时，查一次同内容记录：新增返回它，更新明确失败。
      const duplicate = await findByContentKey().catch(() => null)
      if (duplicate !== null) {
        if (id === null) return { record: duplicate, persisted: true }
        throw new Error('同一盘面已存在，未覆盖原记录')
      }
      // 打开成功但事务失败（典型是配额）：不要退回内存。list() 仍读 IndexedDB，
      // 内存里的那条记录会在列表里“消失”，界面却以为本次会话可用。
      throw new Error('局面库写入失败，本地数据未改变')
    } finally {
      db.close()
    }
  },

  async delete(id) {
    let db: IDBDatabase | null = null
    try {
      db = await openDatabase()
      /*
       * `deleted` 必须回答「本来有没有这一条」，不是「这条语句执行了没有」。
       * IDB 的 `delete` 对不存在的键同样成功，直接返回 true 会让内存实现
       * （`Map.delete` 返回 false）与它语义分叉，界面据此报「已删除」。
       */
      const deleted = await new Promise<boolean>((resolve, reject) => {
        const tx = db!.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const probe = store.get(id)
        let existed = false
        probe.onsuccess = () => {
          existed = probe.result !== undefined
          if (existed) store.delete(id)
        }
        tx.oncomplete = () => resolve(existed)
        tx.onerror = () => reject(new Error('局面库删除失败'))
        tx.onabort = () => reject(new Error('局面库删除被中止'))
      })
      return { deleted, persisted: true }
    } catch {
      // 打不开库 / 事务失败都退回内存态：删除是幂等的，界面会按 `deleted` 说明结果。
      return fallbackToMemory().delete(id)
    } finally {
      db?.close()
    }
  },
}
