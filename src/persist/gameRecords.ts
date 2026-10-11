import { replay } from '../core/game'
import { inBounds } from '../core/board'
import { BLACK, WHITE, type Player, type Point } from '../core/types'
import { isDifficulty } from '../ai/difficulty'
import { DB_NAME, DB_VERSION, ensureSchema, RECORDS_STORE } from './schema'
import type { Difficulty } from '../ai/types'

/**
 * 棋谱格式版本。与 `progress.ts` / `storage.ts` 同一条口径：字段形状一变
 * 就递增，旧数据被安全丢弃。
 */
export const GAME_RECORDS_SCHEMA_VERSION = 1

/**
 * 一局已结束的棋。
 *
 * **不存时间戳**：项目约定 `Date.now()` 只允许出现在 `ai/search.ts`，棋谱的
 * 先后次序由 IndexedDB 的自增主键 `seq` 表达——列表按它降序，最近的在前。
 */
export interface GameRecord {
  /** IndexedDB 自增主键。列表按它降序 = 最近的在前。 */
  readonly seq: number
  readonly schemaVersion: number
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  /** 与 `gameStore` 的 `GameMode` 同义：'pve' | 'pvp'。定义在 persist 层，避免反向依赖 store。 */
  readonly mode: 'pve' | 'pvp'
  readonly humanColor: Player
  readonly difficulty: Difficulty
  /** 认输的一方，null 表示这局没有认输（五连 / 和棋结束）。 */
  readonly resignedBy: Player | null
  /**
   * 赢家。**由 `put` 内部用 `replay` 推导，不信任调用方**——手顺能还原出
   * 五连与和棋，认输则叠加 `resignedBy`：认输方的对手获胜。
   */
  readonly winner: Player | null
}

export type GameRecordInput = Omit<GameRecord, 'seq' | 'schemaVersion' | 'winner'>

/**
 * 入库结果。
 *
 * `persisted` 是**如实告知**：IndexedDB 不可用时记录只落在内存兜底里，
 * 本次会话能读能列，但刷新就没了。界面必须能区分「真的存下了」与
 * 「只是这次还看得到」——否则就是骗用户。
 */
export interface PutResult {
  readonly record: GameRecord
  readonly persisted: boolean
}

/** 存取接口。`review` 页面依赖这个形状而不是具体实现，测试可以注入假存储。 */
export interface GameRecordsStorage {
  list(): Promise<readonly GameRecord[]>
  get(seq: number): Promise<GameRecord | null>
  put(record: GameRecordInput): Promise<PutResult>
  delete(seq: number): Promise<void>
}

function isPlayer(value: unknown): value is Player {
  return value === 1 || value === 2
}

/** 胜负推导：replay 还原盘面，认输时改判认输方的对手获胜。 */
function deriveWinner(
  moves: readonly Point[],
  firstPlayer: Player,
  resignedBy: Player | null,
): Player | null {
  const state = replay(moves, firstPlayer)
  if (resignedBy !== null) return resignedBy === BLACK ? WHITE : BLACK
  return state.winner
}

export function createGameRecord(input: GameRecordInput): Omit<GameRecord, 'seq' | 'schemaVersion'> {
  return {
    ...input,
    winner: deriveWinner(input.moves, input.firstPlayer, input.resignedBy),
  }
}

/** 校验一条从库里读出来的记录。任何一处不符合预期都返回 null（整条丢弃）。 */
function parseRecord(value: unknown): GameRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  if (raw.schemaVersion !== GAME_RECORDS_SCHEMA_VERSION) return null
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq)) return null
  if (!isPlayer(raw.firstPlayer) || !isPlayer(raw.humanColor)) return null
  if (raw.mode !== 'pve' && raw.mode !== 'pvp') return null
  if (!isDifficulty(raw.difficulty)) return null
  if (!Array.isArray(raw.moves)) return null

  const resignedBy = raw.resignedBy
  if (resignedBy !== null && !isPlayer(resignedBy)) return null

  const moves: Point[] = []
  for (const entry of raw.moves) {
    if (typeof entry !== 'object' || entry === null) return null
    const point = entry as Record<string, unknown>
    if (typeof point.x !== 'number' || typeof point.y !== 'number') return null
    if (!inBounds(point.x, point.y)) return null
    moves.push({ x: point.x, y: point.y })
  }

  return {
    seq: raw.seq,
    schemaVersion: GAME_RECORDS_SCHEMA_VERSION,
    moves,
    firstPlayer: raw.firstPlayer,
    mode: raw.mode,
    humanColor: raw.humanColor,
    difficulty: raw.difficulty,
    resignedBy,
    winner: deriveWinner(moves, raw.firstPlayer, resignedBy),
  }
}

// ── 内存实现（降级兜底 + 测试注入） ─────────────────────────────

/**
 * 每次调用返回一个全新的内存实例。降级路径用它兜底，测试用它做隔离——
 * 真正的降级语义（全局摘掉 indexedDB 后 `indexedDbGameRecords` 自己落进来）
 * 由下面的单例负责。
 */
export function memoryGameRecords(): GameRecordsStorage {
  const bySeq = new Map<number, GameRecord>()
  let nextSeq = 1

  return {
    async list() {
      return [...bySeq.values()].sort((a, b) => b.seq - a.seq)
    },
    async get(seq) {
      return bySeq.get(seq) ?? null
    },
    async put(record) {
      const stored: GameRecord = {
        ...createGameRecord(record),
        seq: nextSeq++,
        schemaVersion: GAME_RECORDS_SCHEMA_VERSION,
      }
      bySeq.set(stored.seq, stored)
      return { record: stored, persisted: false } // 内存态：刷新不留
    },
    async delete(seq) {
      bySeq.delete(seq)
    },
  }
}

/**
 * 存一局，并保证**同一局在库里只有一条**。
 *
 * 顺序是刻意的：**先写新的，成功了再删旧的**。反过来（先删后写）时，
 * 若写入退到内存兜底（隐私模式、配额满），旧条已经删了、新条没落库——
 * 刷新之后整局从棋谱里消失，比多一条严重得多。
 *
 * `replacesSeq` 为 null 时按**内容**找旧条（同样的手顺 + 同样的先手方
 * 视为同一局）。这条路径覆盖「终局后刷新页面、再悔棋重下到终局」：
 * 那时内存里的 seq 链接已经随刷新丢了，只剩手顺可比。
 */
export async function saveGameReplacing(
  input: GameRecordInput,
  replacesSeq: number | null,
): Promise<PutResult> {
  const saved = await indexedDbGameRecords.put(input)
  if (!saved.persisted) return saved // 没落库就不动旧的

  let target = replacesSeq
  if (target === null) {
    const existing = await indexedDbGameRecords.list()
    const sameGame = existing.find(
      (record) =>
        record.seq !== saved.record.seq &&
        record.firstPlayer === input.firstPlayer &&
        record.moves.length === input.moves.length &&
        record.moves.every(
          (point, index) =>
            point.x === input.moves[index]?.x && point.y === input.moves[index]?.y,
        ),
    )
    target = sameGame?.seq ?? null
  }

  if (target !== null && target !== saved.record.seq) {
    await indexedDbGameRecords.delete(target)
  }
  return saved
}

// ── IndexedDB 实现 ───────────────────────────────────────────────

const STORE = RECORDS_STORE

/** 注入点。生产路径不调用；测试用它模拟「隐私模式」或者干脆关掉 IndexedDB。 */
let factory: IDBFactory | null = null

export function __setGameRecordsIndexedDbFactory(next: IDBFactory | null): void {
  factory = next
  memoryFallback = null
}

/**
 * 内存兜底——与 `progress.ts` 同一条理由：隐私模式、无痕窗口、企业策略下
 * IndexedDB 可能不可用。**棋谱丢了可以接受，白屏不行。**
 */
let memoryFallback: GameRecordsStorage | null = null

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
    request.onerror = () => reject(new Error('打不开棋谱库'))
    request.onblocked = () => reject(new Error('棋谱库被其他标签页占用'))
  })
}

/** 任何一步失败都退到内存态，并让本次调用照常完成——绝不向上抛。 */
function fallbackToMemory(): GameRecordsStorage {
  if (memoryFallback === null) memoryFallback = memoryGameRecords()
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
        request.onsuccess = () => {
          db.close()
          resolve(request.result)
        }
        request.onerror = () => {
          db.close()
          reject(new Error('棋谱库读写失败'))
        }
      }),
    (error) => {
      throw error
    },
  )
}

export const indexedDbGameRecords: GameRecordsStorage = {
  async list() {
    try {
      const raw = await withStore<unknown[]>('readonly', (store) => store.getAll())
      return raw
        .map((entry) => parseRecord(entry))
        .filter((record): record is GameRecord => record !== null)
        .sort((a, b) => b.seq - a.seq)
    } catch {
      return fallbackToMemory().list()
    }
  },

  async get(seq) {
    try {
      const raw = await withStore<unknown>('readonly', (store) => store.get(seq))
      return raw === undefined ? null : parseRecord(raw)
    } catch {
      return fallbackToMemory().get(seq)
    }
  },

  async put(record) {
    const payload = { ...createGameRecord(record), schemaVersion: GAME_RECORDS_SCHEMA_VERSION }
    try {
      const seq = await withStore<IDBValidKey>('readwrite', (store) => store.add(payload))
      return { record: { ...payload, seq: Number(seq) }, persisted: true }
    } catch {
      // 落到了内存兜底：本次会话照常可用，但**如实标成没落库**
      return fallbackToMemory().put(record)
    }
  },

  async delete(seq) {
    try {
      await withStore<undefined>('readwrite', (store) => store.delete(seq))
    } catch {
      await fallbackToMemory().delete(seq)
    }
  },
}
