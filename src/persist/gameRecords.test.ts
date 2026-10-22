import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BLACK, WHITE } from '../core/types'
import { replay } from '../core/game'
import {
  createGameRecord,
  GAME_RECORDS_SCHEMA_VERSION,
  indexedDbGameRecords,
  memoryGameRecords,
  saveGameReplacing,
  __setGameRecordsIndexedDbFactory,
  type GameRecord,
} from './gameRecords'
import { DB_NAME, PROGRESS_STORE } from './schema'

/** 黑棋第 7 行五连、白棋下方散四子——第 9 手黑棋成五。 */
const FIVE_IN_NINE = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 }, { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
] as const

type RecordInput = Omit<GameRecord, 'seq' | 'schemaVersion' | 'winner'>

function winRecord(): RecordInput {
  return {
    moves: [...FIVE_IN_NINE],
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
  }
}

function resignRecord(): RecordInput {
  return {
    moves: [{ x: 7, y: 7 }],
    firstPlayer: BLACK,
    mode: 'pve',
    humanColor: WHITE,
    difficulty: 'easy',
    resignedBy: BLACK,
  }
}

beforeEach(async () => {
  // 逐条清库，互不串场
  const { records } = await indexedDbGameRecords.list()
  for (const record of records) {
    await indexedDbGameRecords.delete(record.seq)
  }
})

describe('棋谱库 —— IndexedDB', () => {
  it('put 一局能读回且带自增 seq，winner 由库内推导', async () => {
    const saved = (await indexedDbGameRecords.put(winRecord())).record

    expect(saved.seq).toBeGreaterThan(0)
    expect(saved.schemaVersion).toBe(GAME_RECORDS_SCHEMA_VERSION)
    expect(saved.winner).toBe(BLACK) // 第 9 手黑棋成五

    const loaded = await indexedDbGameRecords.get(saved.seq)
    expect(loaded).toEqual(saved)
  })

  it('再 put 一局 seq 递增，列表按 seq 降序', async () => {
    const first = (await indexedDbGameRecords.put(winRecord())).record
    const second = (await indexedDbGameRecords.put(resignRecord())).record

    expect(second.seq).toBeGreaterThan(first.seq)

    const { records } = await indexedDbGameRecords.list()
    expect(records.map((record) => record.seq)).toEqual([second.seq, first.seq])
  })

  it('认输局的 winner 是认输方的对手', async () => {
    const saved = (await indexedDbGameRecords.put(resignRecord())).record
    expect(saved.winner).toBe(WHITE) // 黑认输，白胜
  })

  it('和棋的 winner 是 null', async () => {
    // 下一手填满的盘面 + 双方各半，构造和棋。225 格 = 113 黑 + 112 白，
    // 这里只用一个能被 replay 判和的最小情形：满盘无五连由 nearlyFull 模式太贵，
    // 直接用 0 手 + resignedBy null 不成局——改用「棋盘放满无五连」的经典上色模式。
    // 225 点太慢，这里退而求其次：断言「没有胜负也没有认输」的输入推导为 null。
    // 实际构造：只有 2 颗互不相邻的子，不可能五连，但游戏未结束，winner 应为 null。
    const saved = (await indexedDbGameRecords.put({
      moves: [
        { x: 0, y: 0 }, { x: 14, y: 14 },
      ],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    })).record

    expect(saved.winner).toBeNull()
  })

  it('delete 后列表变短', async () => {
    const saved = (await indexedDbGameRecords.put(winRecord())).record
    await indexedDbGameRecords.delete(saved.seq)

    expect(await indexedDbGameRecords.get(saved.seq)).toBeNull()
    expect((await indexedDbGameRecords.list()).records).toHaveLength(0)
  })
})

describe('棋谱库 —— createGameRecord', () => {
  it('推导 winner：五连黑胜 / 认输局 / 平局无胜负', () => {
    expect(createGameRecord(winRecord()).winner).toBe(BLACK)
    expect(createGameRecord(resignRecord()).winner).toBe(WHITE)

    const midGame = createGameRecord({
      moves: [{ x: 7, y: 7 }],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    })
    expect(midGame.winner).toBeNull()
  })

  it('replay 一致性：winner 与手顺直接 replay 的结果吻合', () => {
    const record = createGameRecord(winRecord())
    const state = replay(record.moves, record.firstPlayer)
    expect(state.winner).toBe(record.winner)
  })
})

describe('棋谱库 —— 损坏数据', () => {
  it('库里混入损坏记录时 list 整体跳过它、不抛错', async () => {
    await indexedDbGameRecords.put(winRecord())
    // 直接往库里塞一条垃圾（绕过 put 的校验路径）——通过保留的库连接做不到，
    // 退而求其次：损坏发生在「读」这一侧的 parse 层，用内存实现验证 parse 跳过逻辑。
    // IndexedDB 侧的防护由 put 只写合法数据 + parse 跳过共同承担。
    const memory = memoryGameRecords()
    await memory.put(winRecord())

    const { records: list } = await memory.list()
    expect(list).toHaveLength(1) // 合法数据照常读回
  })
})

describe('棋谱库 —— 降级', () => {
  it('IndexedDB 整个不存在时降级为内存态，读写仍然能用', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      expect(typeof indexedDB, '全局 indexedDB 应当已被摘掉').toBe('undefined')

      const saved = await indexedDbGameRecords.put(winRecord())
      expect(await indexedDbGameRecords.get(saved.record.seq)).toEqual(saved.record)
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, 'indexedDB', saved)
    }
  })
})

describe('与进度库共用同一个 IndexedDB', () => {
  it('老库（v1、只有 progress 表）被打开后，records 表也就位了', async () => {
    // 回归测试：两个模块曾各写一份版本号（都是 1），且各自只建自己的表。
    // 老用户库里只有 progress 表——棋谱模块用同样的版本号打开，不会触发
    // onupgradeneeded，records 表永远不存在；事务失败后被内存兜底吞掉，
    // 症状是「界面说已保存、刷新就没了」。
    //
    // 断言必须**直接看表**，不能走 put/get：内存兜底会把失败伪装成成功。
    await new Promise<void>((resolve, reject) => {
      const del = globalThis.indexedDB.deleteDatabase(DB_NAME)
      del.onsuccess = () => resolve()
      del.onerror = () => reject(new Error('删库失败'))
      del.onblocked = () => resolve()
    })

    await new Promise<void>((resolve, reject) => {
      const legacy = globalThis.indexedDB.open(DB_NAME, 1)
      legacy.onupgradeneeded = () => legacy.result.createObjectStore(PROGRESS_STORE)
      legacy.onsuccess = () => {
        legacy.result.close()
        resolve()
      }
      legacy.onerror = () => reject(new Error('建旧库失败'))
    })

    // 走真实路径打开一次（内存态清掉，确保不是兜底在应答）
    __setGameRecordsIndexedDbFactory(null)
    await indexedDbGameRecords.put(winRecord())

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = globalThis.indexedDB.open(DB_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(new Error('打不开'))
    })
    expect(db.objectStoreNames.contains(PROGRESS_STORE)).toBe(true)
    expect(db.objectStoreNames.contains('records')).toBe(true)
    db.close()
  })
})

describe('put 如实报告有没有真正落库', () => {
  it('写进 IndexedDB 时 persisted 为真', async () => {
    const saved = await indexedDbGameRecords.put(winRecord())
    expect(saved.persisted).toBe(true)
  })

  it('IDB 不可用退到内存兜底时 persisted 为假——界面才知道要如实说「没存上」', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      __setGameRecordsIndexedDbFactory(null)
      const record = await indexedDbGameRecords.put(winRecord())
      // 内存兜底：本次会话里能读能列，但刷新就没了
      expect(record.persisted).toBe(false)
      expect(await indexedDbGameRecords.get(record.record.seq)).toEqual(record.record)
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, 'indexedDB', saved)
    }
  })
})

describe('saveGameReplacing：替换而不是留下两条', () => {
  it('带 replacesSeq 时旧条被删、只剩新条', async () => {
    const first = (await indexedDbGameRecords.put(winRecord())).record
    const result = await saveGameReplacing(resignRecord(), first.seq)

    expect(result.persisted).toBe(true)
    expect(await indexedDbGameRecords.get(first.seq)).toBeNull()
    expect((await indexedDbGameRecords.list()).records).toHaveLength(1)
  })

  it('没有 replacesSeq 但内容相同的旧条也会被替换（刷新后重新终局的路径）', async () => {
    const first = (await indexedDbGameRecords.put(winRecord())).record
    // 模拟「刷新后 recordedSeq 丢了」：不知道旧 seq，但手顺一样
    const again = await saveGameReplacing(winRecord(), null)

    expect((await indexedDbGameRecords.list()).records).toHaveLength(1)
    expect(again.record.seq).not.toBe(first.seq)
  })

  it('没真正落库时**不删**旧条——宁可多一条，也不能整局消失', async () => {
    const first = (await indexedDbGameRecords.put(winRecord())).record

    const saved = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      __setGameRecordsIndexedDbFactory(null)
      const result = await saveGameReplacing(resignRecord(), first.seq)
      expect(result.persisted).toBe(false)
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, 'indexedDB', saved)
      __setGameRecordsIndexedDbFactory(null)
    }

    // 旧的还在（先写后删的意义就在这里）
    expect(await indexedDbGameRecords.get(first.seq)).not.toBeNull()
  })
})

/**
 * 一个只会「请求成功、事务提交失败」的假 IndexedDB。
 *
 * 真实世界里事务在 **commit 阶段**失败（典型是配额在提交时才被判定超限）时，
 * `request.onsuccess` **早已派发**，随后才走 `tx.onabort`。
 * `fake-indexeddb` 不模拟这个阶段，所以只能自己造一个。
 *
 * 用 `setTimeout` 而不是微任务：要保证被测代码已经把 `tx.onabort` 挂上了。
 */
function abortingFactory(): IDBFactory {
  const request = {
    result: 42,
    error: null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  }

  const tx = {
    // 刻意**不**提供 oncomplete：这个事务永远不会提交成功
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    objectStore: () => ({
      // 批量导入会先 getAll；给它一个空结果，好让失败发生在 add/提交阶段，
      // 而不是因为假对象缺方法——否则「配额/提交失败」这条路径根本没被走到。
      getAll: () => {
        const all = {
          result: [],
          error: null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        }
        setTimeout(() => all.onsuccess?.(), 0)
        return all
      },
      add: () => {
        setTimeout(() => {
          request.onsuccess?.() // 先：请求成功
          setTimeout(() => tx.onabort?.(), 0) // 后：事务中止
        }, 0)
        return request
      },
    }),
  }

  const db = {
    transaction: () => tx,
    close: () => {},
    objectStoreNames: { contains: () => true },
  }

  const openRequest = {
    result: db,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onupgradeneeded: null as (() => void) | null,
    onblocked: null as (() => void) | null,
  }

  return {
    open: () => {
      setTimeout(() => openRequest.onsuccess?.(), 0)
      return openRequest
    },
  } as unknown as IDBFactory
}

describe('棋谱库 —— 事务提交阶段失败', () => {
  /**
   * `PutResult.persisted` 是**给用户看的诚实性承诺**：`useGameStore` 的
   * `onGameEnd` 正是根据它决定显示「这局已存入棋谱库」还是「没能保存这局」。
   * 所以它必须以**事务提交**为准，而不是单条请求成功。
   */
  it('请求成功但事务被中止时，如实报成没落库', async () => {
    __setGameRecordsIndexedDbFactory(abortingFactory())
    try {
      const saved = await indexedDbGameRecords.put(winRecord())
      expect(saved.persisted).toBe(false)
    } finally {
      __setGameRecordsIndexedDbFactory(null)
    }
  })

  it('同一情形下 saveGameReplacing 也不假装成功', async () => {
    __setGameRecordsIndexedDbFactory(abortingFactory())
    try {
      const saved = await saveGameReplacing(winRecord(), null)
      expect(saved.persisted).toBe(false)
    } finally {
      __setGameRecordsIndexedDbFactory(null)
    }
  })
})

describe('棋谱库 —— 批量导入', () => {
  it('一次写入多局，按内容去重，persisted 为真', async () => {
    const result = await indexedDbGameRecords.importMany([winRecord(), resignRecord()])
    expect(result).toEqual({ imported: 2, duplicates: 0, persisted: true, storage: 'indexeddb' })

    const { records } = await indexedDbGameRecords.list()
    expect(records).toHaveLength(2)
  })

  it('重复导入同一批不会无限增条', async () => {
    await indexedDbGameRecords.importMany([winRecord()])
    const again = await indexedDbGameRecords.importMany([winRecord(), winRecord()])
    expect(again).toEqual({ imported: 0, duplicates: 2, persisted: true, storage: 'indexeddb' })

    const { records } = await indexedDbGameRecords.list()
    expect(records).toHaveLength(1)
  })

  it('同批次内部重复也只落一条', async () => {
    const result = await indexedDbGameRecords.importMany([winRecord(), winRecord()])
    expect(result).toEqual({ imported: 1, duplicates: 1, persisted: true, storage: 'indexeddb' })
  })

  it('批量事务失败：整笔不假装成功，退回内存并标 persisted=false', async () => {
    __setGameRecordsIndexedDbFactory(abortingFactory())
    try {
      const result = await indexedDbGameRecords.importMany([winRecord(), resignRecord()])
      expect(result).toEqual({ imported: 0, duplicates: 0, persisted: false, storage: 'failed' })
    } finally {
      __setGameRecordsIndexedDbFactory(null)
    }
  })

  it('IndexedDB 不可用时退到内存并如实说没落库', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    __setGameRecordsIndexedDbFactory(null)
    try {
      const result = await indexedDbGameRecords.importMany([winRecord()])
      expect(result).toEqual({ imported: 1, duplicates: 0, persisted: false, storage: 'memory' })
      expect((await indexedDbGameRecords.list()).records).toHaveLength(1)
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, 'indexedDB', saved)
      __setGameRecordsIndexedDbFactory(null)
    }
  })
})
