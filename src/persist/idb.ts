import { DB_NAME, DB_VERSION, ensureSchema } from './schema'

/**
 * IndexedDB 的连接与事务样板——**唯一出处**。
 *
 * 三个存储层（进度 / 棋谱 / 局面）打开的是同一个库，生命周期规则完全一样：
 * 建表、关闭、以及两条容易被忽略的路径——
 *
 * 1. **`blocked` 之后 open 仍可能 `success`**：别的标签页关掉时，那个请求会迟到地
 *    成功。Promise 早已 reject，没人接这个连接，它会一直占着库、挡住下一次升级。
 * 2. **`db.transaction()` 是同步抛错的**（连接已关闭、库被删）。那种情况下
 *    `close()` 在事件回调里，等于漏关一个连接。
 *
 * 这两条原先在三处各写一遍，修一处忘两处只是时间问题。文案与「打开后做什么」
 * 由调用方给，其余不允许各写各的。
 */
export interface OpenDatabaseOptions {
  /** `open` 失败时的用户可读原因。 */
  readonly errorMessage: string
  /** 另一个标签页占着库时的用户可读原因。 */
  readonly blockedMessage: string
  /** 打开成功后、resolve 之前要做的事（局面库用它做内容键回填）。 */
  readonly onOpen?: (db: IDBDatabase) => Promise<void>
}

export function openDatabaseWithSchema(
  factory: IDBFactory | null,
  options: OpenDatabaseOptions,
): Promise<IDBDatabase> {
  if (factory === null) return Promise.reject(new Error('IndexedDB 不可用'))

  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    request.onupgradeneeded = () => ensureSchema(request.result, request.transaction)

    let settled = false
    request.onsuccess = () => {
      const db = request.result
      if (settled) {
        // 迟到的成功：调用方已经拿到 reject，这个连接必须有人负责关掉。
        db.close()
        return
      }
      settled = true
      const ready = options.onOpen === undefined ? Promise.resolve() : options.onOpen(db)
      ready.then(
        () => resolve(db),
        (error: unknown) => {
          db.close()
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    }
    request.onerror = () => {
      settled = true
      reject(new Error(options.errorMessage))
    }
    request.onblocked = () => {
      settled = true
      reject(new Error(options.blockedMessage))
    }
  })
}

export interface WithStoreOptions {
  /** 事务失败时的用户可读原因。 */
  readonly errorMessage: string
  /** 事务中止时的用户可读原因。 */
  readonly abortMessage: string
}

/**
 * 在一个事务里跑一次请求，**以事务提交为准**判定成功。
 *
 * 请求的 `success` 事件派发之后事务才尝试提交，提交失败走 `onabort`——那时
 * `request.onsuccess` 早就派发过了。只看 request 会把「没写进去」报成「写进去了」，
 * 而 `persisted` 正是界面「这局已存入」的判据，等于骗用户。
 *
 * 无论成功、失败还是同步抛错，连接都会被关闭。
 */
export function withObjectStore<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  options: WithStoreOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction
    let request: IDBRequest<T>
    try {
      tx = db.transaction(storeName, mode)
      request = run(tx.objectStore(storeName))
    } catch (error) {
      db.close()
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    tx.oncomplete = () => {
      db.close()
      resolve(request.result)
    }
    tx.onerror = () => {
      db.close()
      reject(new Error(options.errorMessage))
    }
    tx.onabort = () => {
      db.close()
      reject(new Error(options.abortMessage))
    }
  })
}
