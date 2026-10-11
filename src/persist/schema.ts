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
 */
export const DB_NAME = 'gomoku-lab'
export const DB_VERSION = 2

export const PROGRESS_STORE = 'progress'
export const RECORDS_STORE = 'records'

/**
 * 建表。每处 `onupgradeneeded` 都要调它——**不是只建自己那一个表**：
 * 谁先打开谁负责把两张表都建齐，后来者才拿得到自己那张。
 */
export function ensureSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(PROGRESS_STORE)) db.createObjectStore(PROGRESS_STORE)
  if (!db.objectStoreNames.contains(RECORDS_STORE)) {
    db.createObjectStore(RECORDS_STORE, { keyPath: 'seq', autoIncrement: true })
  }
}
