import { isReplayConsistent, type Position, type PositionProvenance } from '../core/position'
import type { Player } from '../core/types'
import { positionContentKey } from './positionKey'
export { positionContentKey } from './positionKey'
import { openDatabaseWithSchema, resolveIdbFactory, storeRunner } from './idb'
import { POSITIONS_CONTENT_INDEX, POSITIONS_STORE } from './schema'
import { isPlayer, parsePoint } from './parse'
import { millisOrNull } from '../lib/time-format'

const POSITION_SCHEMA_VERSION = 2
const LEGACY_POSITION_SCHEMA_VERSION = 1
const MAX_POSITION_TITLE = 80

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
    const point = parsePoint(entry)
    if (point === null) return null
    moves.push(point)
  }
  return { kind: 'replay', moves, firstPlayer: raw.firstPlayer, ply: raw.ply }
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
  // 非负安全整数、`Date` 表示得了——与棋谱的入库时间同一条规则（`lib/time-format.ts`）。
  const createdAt = millisOrNull(value.createdAt)
  const updatedAt = millisOrNull(value.updatedAt)
  if (createdAt === null || updatedAt === null) return null
  return { createdAt, updatedAt }
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

/**
 * 降级兜底的号段起点（与 `gameRecords.ts` 的 `FALLBACK_SEQ_BASE` 同一条理由）：
 * 库的自增 id 从 1 起，兜底若也从 1 起，库一恢复，界面手里兜底那条的 id 就指向库里
 * **另一条**真实局面——删它、覆盖它都落到那条上。
 */
const FALLBACK_ID_BASE = 1_000_000_000_000

function isFallbackId(id: number): boolean {
  return id >= FALLBACK_ID_BASE
}

export function memoryPositions(degraded = false): PositionStorage {
  const byId = new Map<number, SavedPosition>()
  // 当兜底用时从大偏移起数；单独使用（测试）时仍从 1 起。
  let nextId = degraded ? FALLBACK_ID_BASE : 1

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
/**
 * 兜底号 → 补写回库后拿到的库号。界面（编辑器的「当前打开的那条」）手里握着的还是兜底号，
 * 补写之后 get / save / delete 照这张表改道到库里那条。
 */
const drainedIds = new Map<number, number>()

function resolveId(id: number): number {
  return drainedIds.get(id) ?? id
}

export function __setPositionsIndexedDbFactory(next: IDBFactory | null): void {
  factory = next
  memoryFallback = null
  drainedIds.clear()
  // 测试隔离：换工厂等于换一个存储会话，回填也要重新允许。
  backfillDone = false
  backfillPending = null
}

function openDatabase(): Promise<IDBDatabase> {
  return openDatabaseWithSchema(resolveIdbFactory(factory), {
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

const withStore = storeRunner(openDatabase, STORE, {
  errorMessage: '局面库读写失败',
  abortMessage: '局面库读写被中止',
})

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
        // 还必须 stopPropagation：preventDefault 只防住中止，错误事件照样冒泡到
        // `tx.onerror`，那样这次已经正常收尾的回填会被记成失败、下次打开再整表重扫。
        update.onerror = (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error('局面内容键回填失败'))
    tx.onabort = () => reject(new Error('局面内容键回填被中止'))
  })
}

/**
 * 库恢复后把降级期间只在内存里的局面补写进库（同 `gameRecords.ts` 的 list）。
 *
 * 不做这一步：库短暂不可用时保存的局面，界面说「本次会话可用」，库一恢复、列表改读库，
 * 它就在同一个会话里消失了。按内容键去重：库里已有同一盘面就只记下对应关系。
 * 返回是否补写完；没补完时内存兜底原样保留，下一次列表再试。
 */
async function drainFallback(): Promise<boolean> {
  if (memoryFallback === null) return true
  const pending = (await memoryFallback.list()).records
  let db: IDBDatabase
  try {
    db = await openDatabase()
  } catch {
    return false
  }
  try {
    for (const record of pending) {
      const input = inputFromPosition(positionFromSaved(record), record.title, record.provenance)
      const key = positionContentKey(input)
      const duplicate = await readPosition(db, (store) => store.index(POSITIONS_CONTENT_INDEX).get(key))
      if (duplicate !== null) {
        drainedIds.set(record.id, duplicate.id)
        continue
      }
      const payload = {
        ...positionPayload(input, 0, 0),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
      const newId = await new Promise<IDBValidKey>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const request = tx.objectStore(STORE).add(payload)
        tx.oncomplete = () => resolve(request.result)
        tx.onerror = () => reject(request.error ?? new Error('局面补写失败'))
        tx.onabort = () => reject(request.error ?? new Error('局面补写被中止'))
      })
      drainedIds.set(record.id, Number(newId))
    }
    memoryFallback = null
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

export const indexedDbPositions: PositionStorage = {
  async list() {
    try {
      const drained = await drainFallback()
      const raw = await withStore<unknown[]>('readonly', (store) => store.getAll())
      const records = raw
        .map(parseSavedPosition)
        .filter((record): record is SavedPosition => record !== null)
        .sort(sortPositions)
      // 补写没完成时本次列表缺了兜底那几条；`degraded` 是界面能说出来的唯一信号。
      return { records, degraded: !drained }
    } catch {
      return fallbackToMemory().list()
    }
  },

  async get(requested) {
    const id = resolveId(requested)
    if (isFallbackId(id)) return (await memoryFallback?.get(id)) ?? null
    try {
      const raw = await withStore<unknown>('readonly', (store) => store.get(id))
      return raw === undefined ? null : parseSavedPosition(raw)
    } catch {
      return fallbackToMemory().get(id)
    }
  },

  async save(input, requested, now) {
    const id = requested === null ? null : resolveId(requested)
    // 兜底号只在内存兜底里有意义：覆盖它不能落到库里同号的另一条上。
    if (id !== null && isFallbackId(id)) return fallbackToMemory().save(input, id, now)
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

  async delete(requested) {
    const id = resolveId(requested)
    if (isFallbackId(id)) return fallbackToMemory().delete(id)
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
