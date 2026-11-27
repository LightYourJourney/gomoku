import { replay, replayStrict } from '../core/game'
import { opponentOf } from '../core/board'
import type { GameMode, Player, Point } from '../core/types'
import { isDifficulty } from '../ai/difficulty'
import { openDatabaseWithSchema, resolveIdbFactory, storeRunner } from './idb'
import { RECORDS_STORE } from './schema'
import { recordContentKey } from './recordIdentity'
import { millisOrNull } from '../lib/time-format'
import { isPlayer, parsePoint } from './parse'
import type { Difficulty } from '../ai/types'

/**
 * 棋谱格式版本。**改变已有字段的含义**才递增，并且必须同时提供迁移（`SCHEMA_MIGRATION.md` §4：
 * 迁移前不破坏旧数据、不因单条无效清空全部）；**纯新增的可选字段不递增**（如 `createdAt`，
 * 评估报告裁定 2）——旧代码只取认识的字段，读新数据不受影响，回滚安全。
 */
export const GAME_RECORDS_SCHEMA_VERSION = 1

/**
 * 一局已结束的棋。
 *
 * 先后次序由 IndexedDB 的自增主键 `seq` 表达——列表按它降序，最近入库的在前
 * （不按 `createdAt` 排：导入的旧棋谱 `seq` 新、时间可能早）。
 */
export interface GameRecord {
  /** IndexedDB 自增主键。列表按它降序 = 最近的在前。 */
  readonly seq: number
  readonly schemaVersion: number
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  readonly mode: GameMode
  readonly humanColor: Player
  readonly difficulty: Difficulty
  /** 认输的一方，null 表示这局没有认输（五连 / 和棋结束）。 */
  readonly resignedBy: Player | null
  /**
   * 赢家。**由 `put` 内部用 `replay` 推导，不信任调用方**——手顺能还原出
   * 五连与和棋，认输则叠加 `resignedBy`：认输方的对手获胜。
   */
  readonly winner: Player | null
  /**
   * 这局下完的时间（毫秒时间戳）。**可选字段，不递增 `schemaVersion`**（见上）：
   * 旧版本写下的、或时间不合法的，一律为 null——界面写「时间未知」，不编造。
   * 时钟由调用方注入（入库路径在 `useGameStore` 传 `Date.now`），存储层不读时钟。
   * **不参与内容身份**：同一局不因时间不同变成两局。
   */
  readonly createdAt: number | null
}

export type GameRecordInput = Omit<GameRecord, 'seq' | 'schemaVersion' | 'winner' | 'createdAt'> & {
  readonly createdAt?: number | null
}

/** `putReplacing` 的替换目标：按号；号失效或没给时（允许的话）按内容身份找同一局。 */
export interface ReplaceTarget {
  readonly replacesSeq: number | null
  readonly allowContentMatch?: boolean
}

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

/**
 * 批量导入结果。
 *
 * `imported` / `duplicates` 只统计**真正提交后**的结果；`persisted` 是
 * 「这批新记录是否进了 IndexedDB」——退到内存兜底时必须为 false，界面要
 * 如实提示「本次会话可用，刷新可能丢失」。
 */
export interface ImportRecordsResult {
  readonly imported: number
  readonly duplicates: number
  readonly persisted: boolean
  /** 实际落点：IndexedDB / 仅本次会话的内存态 / 事务失败且没有写入。 */
  readonly storage: 'indexeddb' | 'memory' | 'failed'
}

/** 存取接口。`review` 页面依赖这个形状而不是具体实现，测试可以注入假存储。 */
export interface GameRecordsStorage {
  list(): Promise<GameRecordList>
  get(seq: number): Promise<GameRecord | null>
  put(record: GameRecordInput): Promise<PutResult>
  /**
   * 写一局，并在**同一个事务里**删掉它要替换的旧条（同一局只留一条）。
   * 事务失败整笔回滚、新旧都不动，与 `put` 失败一样退内存兜底并如实报 `persisted: false`。
   */
  putReplacing(record: GameRecordInput, target: ReplaceTarget): Promise<PutResult>
  /**
   * 删一条。`persisted` 如实告知删的是不是库里那条：库打不开时只删了内存兜底里的，
   * 刷新后库里那条还在——界面不能说「已删除」。事务失败照旧抛错。
   */
  delete(seq: number): Promise<{ readonly persisted: boolean }>
  importMany(records: readonly GameRecordInput[]): Promise<ImportRecordsResult>
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
    createdAt: millisOrNull(input.createdAt),
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
    const point = parsePoint(entry)
    if (point === null) return null
    moves.push(point)
  }

  const replayed = replayStrict(moves, raw.firstPlayer)
  // 读到库里就必须是完整合法手顺：非法/重复/终局后落子都整条拒绝，
  // 不能把截断后的前 35 手当成一局棋展示或再导出。
  if (!replayed.ok) return null
  if (resignedBy !== null && replayed.state.status !== 'playing') return null

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
    createdAt: millisOrNull(raw.createdAt),
  }
}

// ── 内存实现（降级兜底 + 测试注入） ─────────────────────────────

/**
 * 降级兜底的号段起点。IndexedDB 的自增键从 1 起、每存一局加一，到这个数要存上万亿局；
 * 它仍是正整数，复盘页地址（`/review/<seq>`）照常认得。
 */
const FALLBACK_SEQ_BASE = 1_000_000_000_000
/** 每个兜底实例占一个这么宽的号段。 */
const FALLBACK_SEQ_STRIDE = 1_000_000_000

/**
 * 每一个新的兜底实例换一个号段。
 *
 * 库不可用可能在一段时间里反复发生。若每次新建的兜底实例都从同一个基数发号，
 * 第二次降级发出的号会和第一次已经补写进库的那条对上（`drainedSeqs` 还留着
 * 第一次的对应关系），于是下一次终局的替换会去找库里那条，改错对象或在列表里多一条。
 */
let fallbackGeneration = 0

/** 这个号是不是降级兜底发出去的（而不是库里的）。 */
function isFallbackSeq(seq: number): boolean {
  return seq >= FALLBACK_SEQ_BASE
}

/**
 * 每次调用返回一个全新的内存实例。降级路径用它兜底，测试用它做隔离——
 * 真正的降级语义（全局摘掉 indexedDB 后 `indexedDbGameRecords` 自己落进来）
 * 由下面的单例负责。
 */
export function memoryGameRecords(degraded = false): GameRecordsStorage {
  const bySeq = new Map<number, GameRecord>()
  // 当兜底用时从本代号段起数：库恢复后界面手里还握着这些号，若与库的自增号同一套，
  // 按号删除会删掉库里另一局真实棋谱（见 `isFallbackSeq`）。单独使用（测试）时仍从 1 起。
  if (degraded) fallbackGeneration += 1
  let nextSeq = degraded ? FALLBACK_SEQ_BASE + fallbackGeneration * FALLBACK_SEQ_STRIDE : 1

  function put(record: GameRecordInput): PutResult {
    const stored: GameRecord = {
      ...createGameRecord(record),
      seq: nextSeq++,
      schemaVersion: GAME_RECORDS_SCHEMA_VERSION,
    }
    bySeq.set(stored.seq, stored)
    return { record: stored, persisted: false } // 内存态：刷新不留
  }

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
      return put(record)
    },
    async putReplacing(record, target) {
      const old = replaceTargetIn([...bySeq.values()], record, target)
      const saved = put(record)
      if (old !== null) bySeq.delete(old)
      return saved
    },
    async importMany(records) {
      const keys = new Set([...bySeq.values()].map((record) => recordContentKey(record)))
      let imported = 0
      let duplicates = 0
      for (const input of records) {
        const key = recordContentKey(input)
        if (keys.has(key)) {
          duplicates += 1
          continue
        }
        keys.add(key)
        const stored: GameRecord = {
          ...createGameRecord(input),
          seq: nextSeq++,
          schemaVersion: GAME_RECORDS_SCHEMA_VERSION,
        }
        bySeq.set(stored.seq, stored)
        imported += 1
      }
      return { imported, duplicates, persisted: false, storage: 'memory' }
    },

    async delete(seq) {
      bySeq.delete(seq)
      return { persisted: false } // 内存态：与 put 同一口径
    },
  }
}

/**
 * 存一局，并保证**同一局在库里只有一条**。
 *
 * 写新与删旧在**同一个事务**里：写不进库（退到内存兜底）时旧条原样保留——
 * 宁可多一条，也不能整局从棋谱里消失。
 *
 * `replacesSeq` 可能已经失效（降级期间只写进内存的记录补写进库时拿的是新号，界面手里
 * 还握着旧的）：指向不存在的记录时退回内容身份匹配，否则库里会留两条同一局。
 * `replacesSeq` 为 null 时按**规范化内容身份**找旧条（先手、手顺、模式、
 * 执子、难度、认输方全部相同才视为同一局）。这条路径覆盖「终局后刷新页面、
 * 再悔棋重下到终局」：那时内存里的 seq 链接已经随刷新丢了，只能按内容比。
 */
export function saveGameReplacing(
  input: GameRecordInput,
  replacesSeq: number | null,
  options: { readonly allowContentMatch?: boolean; readonly now?: () => number } = {},
): Promise<PutResult> {
  // 「写新、删旧」在存储的一个事务里完成：要么都成、要么都不动。
  // 时钟由调用方注入（`useGameStore` 传 `Date.now`），这里不读时钟。
  const record = options.now === undefined ? input : { ...input, createdAt: options.now() }
  return indexedDbGameRecords.putReplacing(record, { replacesSeq, allowContentMatch: options.allowContentMatch })
}

/** 库里一条原样对象的内容身份；形状不对就是 null（它也过不了 `parseRecord`）。 */
function rawContentKey(entry: unknown): string | null {
  try {
    return recordContentKey(entry as GameRecord)
  } catch {
    return null
  }
}

/**
 * 在已有记录里找要替换的那一条：按号；号不在或没给时（允许的话）按内容身份。
 *
 * 收的是**库里的原样对象**，只对候选条做完整校验（`parseRecord` 要逐手回放）：
 * 存一局不该为了找一条旧记录把几千条棋谱全回放一遍。只替换**能通过校验**的记录——
 * 读不出来的那些在列表里本来就看不到，不能被一次保存悄悄删掉。
 */
function replaceTargetIn(
  existing: readonly unknown[],
  input: GameRecordInput,
  { replacesSeq, allowContentMatch = true }: ReplaceTarget,
): number | null {
  const valid = (entry: unknown): number | null => parseRecord(entry)?.seq ?? null
  if (replacesSeq !== null) {
    const hit = existing.find((entry) => (entry as { seq?: unknown } | null)?.seq === replacesSeq)
    if (hit !== undefined && valid(hit) !== null) return replacesSeq
  }
  if (!allowContentMatch) return null
  // 与导入去重使用**同一条内容身份**：手顺只是其中一项。只比手顺+先手方
  // 会把「同样的棋、不同的模式/执子/难度/认输方」当成同一局并删掉旧记录。
  const key = recordContentKey(input)
  for (const entry of existing) {
    if (rawContentKey(entry) !== key) continue
    const seq = valid(entry)
    if (seq !== null) return seq
  }
  return null
}

// ── IndexedDB 实现 ───────────────────────────────────────────────

const STORE = RECORDS_STORE

/** 注入点。生产路径不调用；测试用它模拟「隐私模式」或者干脆关掉 IndexedDB。 */
let factory: IDBFactory | null = null

export function __setGameRecordsIndexedDbFactory(next: IDBFactory | null): void {
  factory = next
  memoryFallback = null
  // 换工厂等于换一个存储会话：旧的「兜底号 → 库号」对应关系在这里不再有意义。
  drainedSeqs.clear()
}

/**
 * 内存兜底——与 `progress.ts` 同一条理由：隐私模式、无痕窗口、企业策略下
 * IndexedDB 可能不可用。**棋谱丢了可以接受，白屏不行。**
 */
let memoryFallback: GameRecordsStorage | null = null

function openDatabase(): Promise<IDBDatabase> {
  return openDatabaseWithSchema(resolveIdbFactory(factory), {
    errorMessage: '打不开棋谱库',
    blockedMessage: '棋谱库被其他标签页占用',
  })
}

/**
 * 兜底号 → 补写回库后拿到的库号。
 *
 * 入库链（`recordNotifier`）会把上一次终局拿到的号当下一次终局的 `replacesSeq`。
 * 那次保存只进了内存时，号是兜底号；补写之后记录在库里的号变了，不记下对应关系，
 * 下一次「悔棋重下再终局」就会按旧号找不到旧条，同一局在列表里两条。
 */
const drainedSeqs = new Map<number, number>()

/** 任何一步失败都退到内存态，并让本次调用照常完成——绝不向上抛。 */
function fallbackToMemory(): GameRecordsStorage {
  // 传 true：从这里拿到的一定是**降级**的那份，界面要能说出来。
  if (memoryFallback === null) memoryFallback = memoryGameRecords(true)
  return memoryFallback
}

const withStore = storeRunner(openDatabase, STORE, {
  errorMessage: '棋谱库读写失败',
  abortMessage: '棋谱库读写被中止',
})

export const indexedDbGameRecords: GameRecordsStorage = {
  async list() {
    try {
      let raw = await withStore<unknown[]>('readonly', (store) => store.getAll())
      // 补写没成功时，本次列表并不完整；`degraded` 是唯一能让界面说出来的信号。
      let drainFailed = false

      /*
       * 存储恢复后把降级期间只在内存里的记录补写进库。
       *
       * 不做这一步的话：IDB 短暂不可用时保存的一局，界面说「本次会话可用」，
       * 而存储一恢复、列表改读 IDB，这一局就在**同一个会话里**消失了——
       * 提示与行为对不上。补写走 `importMany`（按内容身份去重），失败就保持原样、
       * 下一次列表再试，不影响本次读数。
       */
      let pendingRecords: readonly GameRecord[] = []
      if (memoryFallback !== null) {
        const pending = await memoryFallback.list()
        pendingRecords = pending.records
        if (pending.records.length > 0) {
          const imported = await indexedDbGameRecords.importMany(
            pending.records.map((record) => ({
              moves: record.moves,
              firstPlayer: record.firstPlayer,
              mode: record.mode,
              humanColor: record.humanColor,
              difficulty: record.difficulty,
              resignedBy: record.resignedBy,
              createdAt: record.createdAt,
            })),
          )
          if (imported.storage === 'indexeddb') {
            memoryFallback = null
            raw = await withStore<unknown[]>('readonly', (store) => store.getAll())
            // 记下「兜底号 → 库号」：入库链下一次终局会拿兜底号当 `replacesSeq`。
            const byKey = new Map(
              raw
                .map((entry) => parseRecord(entry))
                .filter((record): record is GameRecord => record !== null)
                .map((record) => [recordContentKey(record), record.seq] as const),
            )
            for (const record of pending.records) {
              const seq = byKey.get(recordContentKey(record))
              if (seq !== undefined) drainedSeqs.set(record.seq, seq)
            }
          } else {
            drainFailed = true
          }
        }
      }

      const parsed = raw.map((entry) => parseRecord(entry))
      const fromDb = parsed.filter((record): record is GameRecord => record !== null)
      /*
       * 补写没完成（典型是配额满）时把仍在内存里的那几条也列出来：它们就是
       * 「只在本次会话里的」。不列出来，界面要么说「本次会话可用」却看不见（说假话），
       * 要么用户想把它们导出去腾空间时无处可取。
       */
      const seen = new Set(fromDb.map((record) => recordContentKey(record)))
      const records = [
        ...fromDb,
        ...pendingRecords.filter((record) => !seen.has(recordContentKey(record))),
      ]
      return {
        records: records.sort((a, b) => b.seq - a.seq),
        degraded: drainFailed,
        // 数一下有多少条**读出来了但没通过校验**——那是「下过棋却看不到」
        // 的另一半原因，不能让它悄悄消失。
        skipped: parsed.length - records.length,
      }
    } catch {
      return fallbackToMemory().list()
    }
  },

  async get(requested) {
    // 兜底发出去的号只可能在内存里（补写完成后按对应关系改道到库号）；
    // 拿去问库，命中的也只会是别的局。
    const seq = drainedSeqs.get(requested) ?? requested
    if (isFallbackSeq(seq)) return (await memoryFallback?.get(seq)) ?? null
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

  async putReplacing(record, requested) {
    /*
     * 要替换的号可能已经改名：降级期间的那次保存只进了内存，补写之后它在库里的号变了。
     * 先按对应关系改道；仍然查不到的兜底号说明旧条还在内存兜底里，就在内存里替换，
     * 不再去库里找（库里没有它，找到的会是别的局）。
     */
    const mapped =
      requested.replacesSeq === null
        ? null
        : (drainedSeqs.get(requested.replacesSeq) ?? requested.replacesSeq)
    if (mapped !== null && isFallbackSeq(mapped) && memoryFallback !== null) {
      const replaced = await memoryFallback.putReplacing(record, {
        replacesSeq: mapped,
        allowContentMatch: false,
      })
      return { record: replaced.record, persisted: false }
    }
    const target = {
      ...requested,
      replacesSeq: mapped !== null && isFallbackSeq(mapped) ? null : mapped,
    }
    const payload = { ...createGameRecord(record), schemaVersion: GAME_RECORDS_SCHEMA_VERSION }
    let db: IDBDatabase | null = null
    try {
      db = await openDatabase()
      const seq = await new Promise<number>((resolve, reject) => {
        const tx = db!.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        let added = 0
        // 读全表找旧条（号或内容身份）→ 写新 → 删旧，都在这一个事务里；任何一步抛错都会让事务中止、整笔回滚。
        const all = store.getAll()
        all.onsuccess = () => {
          const old = replaceTargetIn(all.result, record, target)
          const add = store.add(payload)
          add.onsuccess = () => {
            added = Number(add.result)
            if (old !== null) store.delete(old)
          }
        }
        tx.oncomplete = () => resolve(added)
        tx.onerror = () => reject(new Error('棋谱库替换失败'))
        tx.onabort = () => reject(new Error('棋谱库替换被中止'))
      })
      // 旧条被换掉了：指向它的兜底号要改道到新条，否则界面手里的兜底号会取到空。
      if (target.replacesSeq !== null) {
        for (const [from, to] of drainedSeqs) {
          if (to === target.replacesSeq) drainedSeqs.set(from, seq)
        }
      }
      return { record: { ...payload, seq }, persisted: true }
    } catch {
      // 打不开库，或事务失败（整笔回滚，旧条还在）：内存兜底、如实报没落库。
      // 在内存里**替换**：兜底号与库号分属两个号段（`FALLBACK_SEQ_BASE`），库里的号在兜底里
      // 找不到、不会删错；指向兜底那条时（库整体不可用时的「终局 → 悔棋 → 再终局」）就替换它，
      // 否则同一局在列表里两条。
      return fallbackToMemory().putReplacing(record, target)
    } finally {
      db?.close()
    }
  },

  async importMany(records) {
    const payloads = records.map((record) => ({
      ...createGameRecord(record),
      schemaVersion: GAME_RECORDS_SCHEMA_VERSION,
    }))

    let db: IDBDatabase | null = null
    try {
      db = await openDatabase()
      const result = await new Promise<ImportRecordsResult>((resolve, reject) => {
        const tx = db!.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const all = store.getAll()
        let imported = 0
        let duplicates = 0

        all.onsuccess = () => {
          const keys = new Set(
            all.result
              .map((entry) => parseRecord(entry))
              .filter((record): record is GameRecord => record !== null)
              .map((record) => recordContentKey(record)),
          )

          for (const payload of payloads) {
            const key = recordContentKey(payload)
            if (keys.has(key)) {
              duplicates += 1
              continue
            }
            keys.add(key)
            store.add(payload)
            imported += 1
          }
        }

        tx.oncomplete = () => resolve({ imported, duplicates, persisted: true, storage: 'indexeddb' })
        tx.onerror = () => reject(new Error('棋谱库批量写入失败'))
        tx.onabort = () => reject(new Error('棋谱库批量写入被中止'))
      })
      return result
    } catch {
      /*
       * 打不开库 = IndexedDB 整体不可用：内存兜底与 list() 的读兜底一致。
       * 打开成功但事务失败（典型是配额）时**不要**写内存：此时 list() 仍会读
       * IndexedDB，写进内存只会让界面说「本次会话可用」却一条也看不到。
       * 整笔事务已回滚，旧数据仍在；如实报失败。
       */
      if (db === null) return fallbackToMemory().importMany(records)
      return { imported: 0, duplicates: 0, persisted: false, storage: 'failed' }
    } finally {
      db?.close()
    }
  },

  async delete(requested) {
    // 与 `importMany` 同一口径：**打不开库**才退内存（并报 `persisted: false`）；事务失败要如实抛——
    // 吞掉异常再退内存的话（内存里本来就没有这条），界面会说「已删除」，刷新后它又回来了。
    // 兜底的号不许拿去删库：库恢复后同号的是另一局真实棋谱。
    const seq = drainedSeqs.get(requested) ?? requested
    if (isFallbackSeq(seq)) return fallbackToMemory().delete(seq)
    let db: IDBDatabase | null = null
    try {
      db = await openDatabase()
      await new Promise<void>((resolve, reject) => {
        const tx = db!.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(seq)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(new Error('棋谱库删除失败'))
        tx.onabort = () => reject(new Error('棋谱库删除被中止'))
      })
      return { persisted: true }
    } catch (error) {
      if (db === null) return fallbackToMemory().delete(seq)
      throw error
    } finally {
      db?.close()
    }
  },
}
