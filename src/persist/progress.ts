import { DB_NAME, DB_VERSION, ensureSchema, PROGRESS_STORE as STORE } from './schema'

/**
 * 进度格式版本。
 *
 * 与 `storage.ts` 的 `SCHEMA_VERSION` 同一条口径：字段形状一变就递增，
 * 旧数据被安全丢弃。没有这个字段的话，形状一变 `parseProgress` 会静默
 * 返回 null、进度整个消失，而**没有任何地方能看出那是刻意的**——
 * 也就没有地方能挂一个迁移函数。
 */
export const PROGRESS_SCHEMA_VERSION = 1

export interface LearningProgress {
  readonly schemaVersion: number
  readonly completedLessons: readonly string[]
  readonly solvedPuzzles: readonly string[]
  /** 上次停留的位置，用于刷新后回到原处。null 表示从列表开始。 */
  readonly lastVisited: { readonly kind: 'lesson' | 'puzzle'; readonly id: string } | null
  /**
   * 上次所在的顶层视图。
   *
   * 不存它的话，在残局页刷新会被踢回对战页——「刷新后回到原处」就只覆盖了课程。
   */
  readonly lastView: 'battle' | 'learn' | 'puzzles' | 'review'
}

/** 可合并的进度段：外部备份只带这四个字段，不带内部 schemaVersion。 */
export type MergeableProgress = Pick<
  LearningProgress,
  'completedLessons' | 'solvedPuzzles' | 'lastVisited' | 'lastView'
>

/**
 * 保守合并：完成项取并集，**不删除**任何本地记录。
 *
 * 位置（`lastVisited` / `lastView`）只在本地完全没有进度时才采用导入值。
 * 否则恢复一份旧备份会把用户当前的页面/课程顶掉——「恢复数据」不该顺带
 * 改变他现在的位置。
 */
export function mergeProgress(
  current: LearningProgress,
  incoming: MergeableProgress,
): LearningProgress {
  const hasLocalProgress =
    current.completedLessons.length > 0 ||
    current.solvedPuzzles.length > 0 ||
    current.lastVisited !== null ||
    current.lastView !== 'battle'

  return {
    schemaVersion: current.schemaVersion,
    completedLessons: [...new Set([...current.completedLessons, ...incoming.completedLessons])],
    solvedPuzzles: [...new Set([...current.solvedPuzzles, ...incoming.solvedPuzzles])],
    lastVisited: hasLocalProgress ? current.lastVisited : incoming.lastVisited,
    lastView: hasLocalProgress ? current.lastView : incoming.lastView,
  }
}

export const EMPTY_PROGRESS: LearningProgress = {
  schemaVersion: PROGRESS_SCHEMA_VERSION,
  completedLessons: [],
  solvedPuzzles: [],
  lastVisited: null,
  lastView: 'battle',
}

/** 存取接口。`learnStore` 依赖这个形状而不是具体实现，测试可以注入假存储。 */
export interface ProgressStorage {
  load(): Promise<LearningProgress>
  save(progress: LearningProgress): Promise<void>
  clear(): Promise<void>
}

const KEY = 'learning'

/** 注入点。生产路径不调用；测试用它模拟「隐私模式」或者干脆关掉 IndexedDB。 */
let factory: IDBFactory | null = null

export function __setIndexedDbFactory(next: IDBFactory | null): void {
  factory = next
  memoryFallback = null
}

/**
 * 内存兜底。
 *
 * IndexedDB 在隐私模式、无痕窗口、部分企业策略下会不可用（`indexedDB` 是
 * undefined，或者 `open` 直接抛错、触发 `onerror`）。**进度丢了可以接受，
 * 白屏不行**——所以任何一步失败都退到这里，读写照常。
 */
let memoryFallback: LearningProgress | null = null

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

    request.onupgradeneeded = () => {
      const db = request.result
      ensureSchema(db)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('打不开进度库'))
    request.onblocked = () => reject(new Error('进度库被其他标签页占用'))
  })
}

/** 校验读回来的东西。任何一处不符合预期都当作没有进度。 */
function parseProgress(value: unknown): LearningProgress | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  if (raw.schemaVersion !== PROGRESS_SCHEMA_VERSION) return null

  const strings = (input: unknown): string[] | null => {
    if (!Array.isArray(input)) return null
    for (const entry of input) {
      if (typeof entry !== 'string') return null
    }
    return input as string[]
  }

  const completedLessons = strings(raw.completedLessons)
  const solvedPuzzles = strings(raw.solvedPuzzles)
  if (completedLessons === null || solvedPuzzles === null) return null

  const view = raw.lastView
  // 白名单与 lastView 的联合类型同步——新视图上线时这里漏改，用户一刷新
  // 整条进度就会被当成损坏数据丢弃（'review' 上线时真发生过，见 TEST_REPORT）。
  if (view !== 'battle' && view !== 'learn' && view !== 'puzzles' && view !== 'review') return null

  let lastVisited: LearningProgress['lastVisited'] = null
  if (raw.lastVisited !== null && raw.lastVisited !== undefined) {
    if (typeof raw.lastVisited !== 'object') return null
    const visited = raw.lastVisited as Record<string, unknown>
    const kind = visited.kind
    if (kind !== 'lesson' && kind !== 'puzzle') return null
    if (typeof visited.id !== 'string') return null
    lastVisited = { kind, id: visited.id }
  }

  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    completedLessons,
    solvedPuzzles,
    lastVisited,
    lastView: view,
  }
}

async function readFromIndexedDb(): Promise<LearningProgress | null> {
  const db = await openDatabase()

  try {
    return await new Promise<LearningProgress | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(KEY)
      request.onsuccess = () => resolve(parseProgress(request.result))
      request.onerror = () => reject(new Error('读进度失败'))
    })
  } finally {
    db.close()
  }
}

async function writeToIndexedDb(progress: LearningProgress | null): Promise<void> {
  const db = await openDatabase()

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      if (progress === null) store.delete(KEY)
      else store.put(JSON.parse(JSON.stringify(progress)), KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(new Error('写进度失败'))
      tx.onabort = () => reject(new Error('写进度被中止'))
    })
  } finally {
    db.close()
  }
}

export async function loadProgress(): Promise<LearningProgress> {
  try {
    const stored = await readFromIndexedDb()
    if (stored !== null) return stored
  } catch {
    // 落到内存态
  }

  return memoryFallback ?? EMPTY_PROGRESS
}

export async function saveProgress(progress: LearningProgress): Promise<void> {
  memoryFallback = progress

  try {
    await writeToIndexedDb(progress)
  } catch {
    // 已经写进内存态了，本次会话照常可用
  }
}

export async function clearProgress(): Promise<void> {
  memoryFallback = EMPTY_PROGRESS

  try {
    await writeToIndexedDb(null)
  } catch {
    // 同上
  }
}

/** 真实存储的单例，供 `useLearnStore` 装配。 */
export const indexedDbProgress: ProgressStorage = {
  load: loadProgress,
  save: saveProgress,
  clear: clearProgress,
}
