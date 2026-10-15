import { replay } from '../core/game'
import { inBounds, opponentOf } from '../core/board'
import type { Player, Point } from '../core/types'
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

/**
 * 一次列取的结果。
 *
 * 后两个字段是**给界面「如实说明」用的**：`list()` 从不 reject（任何一步失败都落
 * 内存兜底），所以"用户没下过棋"与"棋谱读不出来"在返回值上**长得一样**——
 * 不额外带信号的话，界面只能二选一地撒谎。它们对应两种**不同**的失败：
 *
 * - `degraded`：**底层不可用**（隐私模式、被占用、配额），这批数据来自内存兜底。
 * - `skipped`：**库读到了，但有记录没通过校验**被丢掉（`parseRecord` 返回 `null`）。
 *
 * 两者不会同时非零——走兜底时压根没读库。
 */
export interface GameRecordList {
  readonly records: readonly GameRecord[]
  /** 底层不可用，数据来自内存兜底：本次会话能看能列，刷新就没了。 */
  readonly degraded: boolean
  /** 读出来了、但没通过校验而被丢掉的条数。 */
  readonly skipped: number
}

/** 存取接口。`review` 页面依赖这个形状而不是具体实现，测试可以注入假存储。 */
export interface GameRecordsStorage {
  list(): Promise<GameRecordList>
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
  if (resignedBy !== null) return opponentOf(resignedBy)
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
export function memoryGameRecords(degraded = false): GameRecordsStorage {
  const bySeq = new Map<number, GameRecord>()
  let nextSeq = 1

  return {
    async list() {
      return {
        records: [...bySeq.values()].sort((a, b) => b.seq - a.seq),
        // 降级与否**是调用者的处境，不是这个类的固有属性**：单独用它的时候
        // （测试里到处都是），它代表的是「一个能用的存储」；只有
        // `fallbackToMemory()` 拿它当兜底时，才算降级。
        degraded,
        // 进出的校验是同一套，这里不会有读得出来却过不了校验的记录。
        skipped: 0,
      }
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
    // 这里只关心记录本身，降级与跳过两个信号在这条路径上没有意义
    const { records: existing } = await indexedDbGameRecords.list()
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
  // 传 true：从这里拿到的一定是**降级**的那份，界面要能说出来。
  if (memoryFallback === null) memoryFallback = memoryGameRecords(true)
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

        /*
         * 成功以**事务提交**为准，不是单条请求成功。
         *
         * 请求的 success 事件派发之后，事务才去尝试提交；提交失败走的是
         * `tx.onabort`——那时 `request.onsuccess` 早就派发过了。只看 request
         * 会把「没写进去」报成「写进去了」，而 `persisted` 正是界面
         * 「这局已存入棋谱库 / 没能保存这局」的判据，等于骗用户。
         *
         * 口径与 `progress.ts` 的 `writeToIndexedDb` 一致：三个 tx 事件都算数。
         * 多个回调重复调用 resolve/reject 是无害的（promise 只认第一次）。
         */
        tx.oncomplete = () => {
          db.close()
          resolve(request.result)
        }
        tx.onerror = () => {
          db.close()
          reject(new Error('棋谱库读写失败'))
        }
        tx.onabort = () => {
          db.close()
          reject(new Error('棋谱库读写被中止'))
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
      const parsed = raw.map((entry) => parseRecord(entry))
      const records = parsed.filter((record): record is GameRecord => record !== null)
      return {
        records: records.sort((a, b) => b.seq - a.seq),
        degraded: false,
        // 数一下有多少条**读出来了但没通过校验**——那是「下过棋却看不到」
        // 的另一半原因，不能让它悄悄消失。
        skipped: parsed.length - records.length,
      }
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
