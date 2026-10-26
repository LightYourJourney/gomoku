import type { Page } from '@playwright/test'
import {
  DB_NAME,
  DB_VERSION,
  POSITIONS_KEY_PATH,
  POSITIONS_STORE,
  PROGRESS_STORE,
  RECORDS_KEY_PATH,
  RECORDS_STORE,
} from '../../src/persist/schema'

/**
 * 在应用加载前造一个当前版本的棋谱库。
 *
 * 走 `robots.txt` 是为了先拿到同源文档又不启动 React；随后由应用自己打开数据库，
 * 避免测试和产品各写一份 schema 常量。
 */
export async function seedGameRecords(
  page: Page,
  records: readonly Record<string, unknown>[],
): Promise<void> {
  await page.goto('/robots.txt')
  await page.evaluate(
    async ({ dbName, version, progressStore, recordsStore, positionsStore, recordsKeyPath, positionsKeyPath, rows }) => {
      await new Promise<void>((resolve) => {
        const del = indexedDB.deleteDatabase(dbName)
        del.onsuccess = del.onerror = del.onblocked = () => resolve()
      })
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName, version)
        req.onupgradeneeded = () => {
          const db = req.result
          db.createObjectStore(progressStore)
          db.createObjectStore(recordsStore, { keyPath: recordsKeyPath, autoIncrement: true })
          db.createObjectStore(positionsStore, { keyPath: positionsKeyPath, autoIncrement: true })
        }
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(recordsStore, 'readwrite')
          for (const row of rows) tx.objectStore(recordsStore).add(row)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    {
      dbName: DB_NAME,
      version: DB_VERSION,
      progressStore: PROGRESS_STORE,
      recordsStore: RECORDS_STORE,
      positionsStore: POSITIONS_STORE,
      recordsKeyPath: RECORDS_KEY_PATH,
      positionsKeyPath: POSITIONS_KEY_PATH,
      rows: records,
    },
  )
}
