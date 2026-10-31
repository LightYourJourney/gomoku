import { DB_NAME, DB_VERSION, ensureSchema, PROGRESS_STORE as STORE } from './schema'

/**
 * 进度格式版本。
 *
 * 与 `storage.ts` 的 `SCHEMA_VERSION` 同一条口径：字段形状一变就递增。
 * **递增之后必须同时补一条迁移**（见下面的 `PROGRESS_MIGRATIONS`），否则老用户的
 * 进度会在下一次打开时被当成「不认识的版本」丢掉——对用户来说就是白学一遍。
 */
export const PROGRESS_SCHEMA_VERSION = 1

/** 顶层视图。运行时清单与类型出自同一处，避免「加了视图忘了改白名单」。 */
export const VIEWS = ['battle', 'learn', 'puzzles', 'review'] as const
export type View = (typeof VIEWS)[number]

function isView(value: unknown): value is View {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value)
}

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
  readonly lastView: View
}

/**
 * 迁移表：键是**源**版本，值把它变成「源 + 1」的形状。
 *
 * 现在的空表是有意的：`PROGRESS_SCHEMA_VERSION` 还是 1，没有历史版本要迁。
 * 它存在的意义是把「升版本」从「丢数据」变成「写一个函数」——加版本时的动作是：
 *   1. `PROGRESS_SCHEMA_VERSION += 1`；
 *   2. 在这里补一条 `源版本: (raw) => ...`；
 *   3. 在 `progress.test.ts` 里补一条「旧版本能读成新版本」的用例。
 */
export type ProgressMigration = (raw: Record<string, unknown>) => Record<string, unknown>

const PROGRESS_MIGRATIONS: Readonly<Record<number, ProgressMigration>> = {}

/**
 * 把任意版本的原始进度升级到 `target`。
 *
 * 三条判定：
 * - 版本号缺失 / 不是正整数 → `null`（不是本应用的进度）；
 * - 比当前版本**还新** → `null`：旧代码读新数据时不猜，猜错就是把用户数据写坏；
 * - 中间缺一步迁移 → `null`：宁可当作没有进度，也不把半截数据灌进状态机。
 */
export function migrateProgress(
  raw: Record<string, unknown>,
  steps: Readonly<Record<number, ProgressMigration>> = PROGRESS_MIGRATIONS,
  target: number = PROGRESS_SCHEMA_VERSION,
): Record<string, unknown> | null {
  const from = raw.schemaVersion
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) return null
  if (from > target) return null

  let value = raw
  for (let version = from; version < target; version += 1) {
    const step = steps[version]
    if (step === undefined) return null
    value = step(value)
  }
  return value
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
    current.lastVisited !== null

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
  /** 可选：返回是否真正落盘；没有实现时按 `save` 成功处理。 */
  saveStrict?(progress: LearningProgress): Promise<boolean>
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
      ensureSchema(db, request.transaction)
    }
    // `blocked` 之后 open 仍可能 `success`：先 reject 了也要把那个连接关掉，
    // 否则它会一直占着库、挡住下一次版本升级。
    let settled = false
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      resolve(request.result)
    }
    request.onerror = () => {
      settled = true
      reject(new Error('打不开进度库'))
    }
    request.onblocked = () => {
      settled = true
      reject(new Error('进度库被其他标签页占用'))
    }
  })
}

/** 校验读回来的东西。任何一处不符合预期都当作没有进度。 */
function parseProgress(value: unknown): LearningProgress | null {
  if (typeof value !== 'object' || value === null) return null
  const migrated = migrateProgress(value as Record<string, unknown>)
  if (migrated === null) return null
  const raw = migrated

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

  /*
   * `lastView` 只影响「打开哪一页」，是纯位置信息。认不出的取值（未来版本写的、
   * 或被人改坏的）回落到对战页，而不是把整条进度判死——'review' 上线那次，
   * 白名单漏改导致用户一刷新全部进度被丢弃，代价远大于「这次停在首页」。
   * 课程与题目完成记录才是不可再生的那部分。
   */
  const lastView = isView(raw.lastView) ? raw.lastView : 'battle'

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
    lastView,
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
/**
 * 导入路径的严格写入：只有真正写进 IndexedDB 才返回 true。
 * 与 `saveProgress` 不同，失败**不**改内存兜底，让调用方如实标失败。
 */
export async function saveProgressStrict(progress: LearningProgress): Promise<boolean> {
  try {
    await writeToIndexedDb(progress)
    memoryFallback = progress
    return true
  } catch {
    return false
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
  saveStrict: saveProgressStrict,
  clear: clearProgress,
}
