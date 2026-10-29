/**
 * IndexedDB 的库名、版本与对象表——**存储层的唯一 schema 出处**。
 *
 * 为什么必须共享：`progress.ts`（学习进度）与 `gameRecords.ts`（棋谱）用的是
 * 同一个库。两处各写一份版本号时，先打开的那个按自己的表建库，另一个用
 * **同样的版本号**打开就不会触发 `onupgradeneeded`，自己的表根本不存在——
 * 事务直接失败，然后被「任何一步失败都退到内存态」的兜底悄悄吞掉：
 * 界面照常显示「已存入」，刷新之后什么都没有。这个 bug 只有端到端测试
 * 抓得到（单元测试里两边各用各的假实现，永远碰不到面）。
 *
 * 以后新增对象表：在这里加名，并在 `ensureSchema` 里建上，然后把版本号 +1。
 * Phase 11B：新增 `positions`（自定义局面），DB_VERSION 2 → 3；旧表不动。
 * Phase 12：`positions.contentKey` 唯一索引，DB_VERSION 3 → 4。
 */
export const DB_NAME = 'gomoku-lab'
export const DB_VERSION = 4

export const PROGRESS_STORE = 'progress'
export const RECORDS_STORE = 'records'
export const POSITIONS_STORE = 'positions'
export const RECORDS_KEY_PATH = 'seq'
export const POSITIONS_KEY_PATH = 'id'
export const POSITIONS_CONTENT_INDEX = 'contentKey'
import { positionContentKey } from './positionKey'

/**
 * 建表。每处 `onupgradeneeded` 都要调它——**不是只建自己那一个表**：
 * 谁先打开谁负责把两张表都建齐，后来者才拿得到自己那张。
 */
export function ensureSchema(db: IDBDatabase, upgrade?: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains(PROGRESS_STORE)) db.createObjectStore(PROGRESS_STORE)
  if (!db.objectStoreNames.contains(RECORDS_STORE)) {
    db.createObjectStore(RECORDS_STORE, { keyPath: RECORDS_KEY_PATH, autoIncrement: true })
  }
  let positions: IDBObjectStore
  if (!db.objectStoreNames.contains(POSITIONS_STORE)) {
    positions = db.createObjectStore(POSITIONS_STORE, {
      keyPath: POSITIONS_KEY_PATH,
      autoIncrement: true,
    })
  } else {
    positions = (upgrade ?? db.transaction(POSITIONS_STORE)).objectStore(POSITIONS_STORE)
  }
  if (!positions.indexNames.contains(POSITIONS_CONTENT_INDEX)) {
    positions.createIndex(POSITIONS_CONTENT_INDEX, POSITIONS_CONTENT_INDEX, { unique: true })
  }
  // 旧记录没有 contentKey：升级时补写，唯一索引才覆盖历史局面。
  if (upgrade !== undefined && upgrade !== null) {
    const seen = new Set<string>()
    positions.openCursor().onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
      if (cursor === null) return
      const value = cursor.value as {
        cells?: unknown
        nextPlayer?: unknown
        provenance?: unknown
        contentKey?: unknown
      }
      if (typeof value.contentKey === 'string') {
        seen.add(value.contentKey)
      } else if (
        Array.isArray(value.cells) &&
        (value.nextPlayer === 1 || value.nextPlayer === 2)
      ) {
        try {
          const key = positionContentKey({
            cells: value.cells as number[],
            nextPlayer: value.nextPlayer,
            provenance: value.provenance as never,
          })
          // 旧库可能已有重复记录；唯一索引不能把两条都回填成同一个键，
          // 否则升级事务会被 ConstraintError 整笔中止。第一条回填，其余保持未索引。
          if (!seen.has(key)) {
            seen.add(key)
            cursor.update({ ...cursor.value, contentKey: key })
          }
        } catch {
          // 坏记录保持原样，由读取侧跳过。
        }
      }
      cursor.continue()
    }
  }
}
