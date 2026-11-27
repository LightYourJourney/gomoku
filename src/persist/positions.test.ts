import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BLACK, WHITE } from '../core/types'
import { DB_NAME, DB_VERSION, RECORDS_STORE, PROGRESS_STORE, POSITIONS_STORE, ensureSchema } from './schema'
import {
  __setPositionsIndexedDbFactory,
  indexedDbPositions,
  inputFromPosition,
  memoryPositions,
  parseSavedPosition,
  positionContentKey,
} from './positions'
import { applyEdit, createPosition } from '../core/position'

const at = (value: number) => () => value

beforeEach(async () => {
  const { records } = await indexedDbPositions.list()
  for (const record of records) await indexedDbPositions.delete(record.id)
})

describe('局面库 —— IndexedDB', () => {
  it('保存、列出、按 id 更新', async () => {
    const position = applyEdit(createPosition(), { x: 7, y: 7 }, 'black')
    const first = await indexedDbPositions.save(
      inputFromPosition(position, '天元研究', null),
      null,
      at(1_000),
    )
    expect(first.persisted).toBe(true)
    expect(first.record.id).toBeGreaterThan(0)
    expect(first.record.createdAt).toBe(1_000)
    expect(first.record.updatedAt).toBe(1_000)

    const list = await indexedDbPositions.list()
    expect(list.records).toHaveLength(1)
    expect(list.records[0]!.title).toBe('天元研究')

    const changed = applyEdit(position, { x: 7, y: 8 }, 'white')
    const updated = await indexedDbPositions.save(
      inputFromPosition(changed, '天元研究（改）', null),
      first.record.id,
      at(2_000),
    )
    expect(updated.record.id).toBe(first.record.id)
    expect(updated.record.title).toBe('天元研究（改）')
    expect(updated.record.createdAt).toBe(1_000)
    expect(updated.record.updatedAt).toBe(2_000)
    expect((await indexedDbPositions.list()).records).toHaveLength(1)
    expect(await indexedDbPositions.get(first.record.id)).toMatchObject({
      title: '天元研究（改）',
      nextPlayer: BLACK,
    })
  })

  it('更新到另一条已存在的内容键时明确失败，不静默改 savedId', async () => {
    const first = await indexedDbPositions.save(inputFromPosition(createPosition(), 'a', null), null, at(1_000))
    const second = await indexedDbPositions.save(inputFromPosition(createPosition(WHITE), 'b', null), null, at(1_000))
    await expect(
      indexedDbPositions.save(inputFromPosition(createPosition(WHITE), 'c', null), first.record.id, at(2_000)),
    ).rejects.toThrow('同一盘面已存在')
    expect((await indexedDbPositions.get(first.record.id))?.title).toBe('a')
    expect((await indexedDbPositions.get(second.record.id))?.title).toBe('b')
  })

  it('同一内容键重复/并发保存只留一条（DB v4 唯一索引）', async () => {
    const input = inputFromPosition(createPosition(), '同一盘面', null)
    const [a, b] = await Promise.all([
      indexedDbPositions.save(input, null, at(1_000)),
      indexedDbPositions.save(input, null, at(2_000)),
    ])
    expect(a.record.id).toBe(b.record.id)
    expect((await indexedDbPositions.list()).records).toHaveLength(1)
  })

  it('按最近保存排序；旧记录没有时间时排在后面', async () => {
    const first = await indexedDbPositions.save(
      inputFromPosition(createPosition(), '旧', null),
      null,
      at(1_000),
    )
    await indexedDbPositions.save(
      inputFromPosition(createPosition(WHITE), '新', null),
      null,
      at(2_000),
    )
    expect((await indexedDbPositions.list()).records.map((record) => record.title)).toEqual([
      '新',
      '旧',
    ])

    await indexedDbPositions.save(
      inputFromPosition(createPosition(), '旧（更新）', null),
      first.record.id,
      at(3_000),
    )
    expect((await indexedDbPositions.list()).records.map((record) => record.title)).toEqual([
      '旧（更新）',
      '新',
    ])
  })

  it('删除返回是否真正从 IndexedDB 删除', async () => {
    const saved = await indexedDbPositions.save(
      inputFromPosition(createPosition(WHITE), '空盘', null),
      null,
      at(1_000),
    )
    expect(await indexedDbPositions.delete(saved.record.id)).toEqual({
      deleted: true,
      persisted: true,
    })
    expect((await indexedDbPositions.list()).records).toHaveLength(0)
  })

  it('删除不存在的 id 时 deleted 为 false，与内存实现同一语义', async () => {
    // IDB 的 delete 对不存在的键同样「成功」；直接报 true 会让界面说「已删除」，
    // 而内存实现（Map.delete）报 false。两套存储必须回答同一个问题。
    expect(await indexedDbPositions.delete(999_999)).toEqual({ deleted: false, persisted: true })
    expect(await memoryPositions().delete(999_999)).toEqual({ deleted: false, persisted: false })
  })

  it('IDB 不可用时退回内存并如实报 persisted=false', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    __setPositionsIndexedDbFactory(null)
    try {
      const result = await indexedDbPositions.save(
        inputFromPosition(createPosition(), '内存', null),
        null,
        at(1_000),
      )
      expect(result.persisted).toBe(false)
      expect(result.record.updatedAt).toBe(1_000)
      expect((await indexedDbPositions.list()).degraded).toBe(true)
      expect(await indexedDbPositions.delete(result.record.id)).toEqual({
        deleted: true,
        persisted: false,
      })
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, 'indexedDB', saved)
      __setPositionsIndexedDbFactory(null)
    }
  })
})

describe('局面库 —— 校验与迁移', () => {
  it('损坏的 cells 不读回', () => {
    expect(parseSavedPosition({ schemaVersion: 1, id: 1, title: 'x', cells: [0], nextPlayer: 1, provenance: null })).toBeNull()
    const cells = Array.from({ length: 225 }, () => 0)
    cells[0] = 3
    expect(parseSavedPosition({ schemaVersion: 1, id: 1, title: 'x', cells, nextPlayer: 1, provenance: null })).toBeNull()
  })

  it('保存的已知手顺与盘面不一致时降级为自由摆盘，不丢盘面', () => {
    const cells = Array.from({ length: 225 }, () => 0)
    cells[7 * 15 + 7] = 1
    const parsed = parseSavedPosition({
      schemaVersion: 1,
      id: 1,
      title: '坏手顺',
      cells,
      nextPlayer: 2,
      provenance: { kind: 'replay', moves: [], firstPlayer: 1, ply: 0 },
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.provenance).toBeNull()
    expect(parsed?.cells[7 * 15 + 7]).toBe(1)
  })

  it('v2 库升级到 v3 时补建 positions 表，旧表不动', async () => {
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase(DB_NAME)
      del.onsuccess = del.onerror = del.onblocked = () => resolve()
      del.onerror = () => reject(new Error('删库失败'))
    })
    await new Promise<void>((resolve, reject) => {
      const old = indexedDB.open(DB_NAME, 2)
      old.onupgradeneeded = () => {
        old.result.createObjectStore(PROGRESS_STORE)
        old.result.createObjectStore(RECORDS_STORE, { keyPath: 'seq', autoIncrement: true })
      }
      old.onsuccess = () => { old.result.close(); resolve() }
      old.onerror = () => reject(old.error)
    })
    __setPositionsIndexedDbFactory(null)
    // 打开当前版本，触发 v2 → v3 升级
    await indexedDbPositions.list()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onupgradeneeded = () => ensureSchema(req.result, req.transaction)
    })
    expect([...db.objectStoreNames].sort()).toEqual(
      [POSITIONS_STORE, PROGRESS_STORE, RECORDS_STORE].sort(),
    )
    db.close()
  })

  it('回填遇到唯一键冲突只跳过该条，不中止后续回填', async () => {
    const cellsA = Array.from({ length: 225 }, () => 0)
    cellsA[7 * 15 + 7] = BLACK
    const cellsB = Array.from({ length: 225 }, () => 0)
    cellsB[8 * 15 + 8] = WHITE
    const keyA = positionContentKey({ cells: cellsA, nextPlayer: WHITE, provenance: null })
    const keyB = positionContentKey({ cells: cellsB, nextPlayer: WHITE, provenance: null })
    const base = { schemaVersion: 2, nextPlayer: WHITE, provenance: null, createdAt: 1, updatedAt: 1 }

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => ensureSchema(req.result, req.transaction)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(POSITIONS_STORE, 'readwrite')
        // 911 先被访问：写回 keyA 时与 912 已占用的 keyA 冲突，事务不能因此中止。
        tx.objectStore(POSITIONS_STORE).put({ ...base, id: 911, title: '冲突', cells: cellsA, contentKey: 'stale-911' })
        tx.objectStore(POSITIONS_STORE).put({ ...base, id: 912, title: '已正确', cells: cellsA, contentKey: keyA })
        // 913 排在冲突之后：它能否写回 keyB，就是「事务有没有被中止」的判据。
        tx.objectStore(POSITIONS_STORE).put({ ...base, id: 913, title: '后续', cells: cellsB, contentKey: 'stale-913' })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    __setPositionsIndexedDbFactory(null)
    await indexedDbPositions.list()

    const keys = await new Promise<Record<number, string>>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(POSITIONS_STORE, 'readonly')
        const get = tx.objectStore(POSITIONS_STORE).getAll()
        get.onsuccess = () => {
          db.close()
          resolve(
            Object.fromEntries(
              (get.result as Array<{ id: number; contentKey: string }>).map((record) => [record.id, record.contentKey]),
            ),
          )
        }
        get.onerror = () => reject(get.error)
      }
      req.onerror = () => reject(req.error)
    })
    expect(keys[913]).toBe(keyB)

    /*
     * 回填必须**收尾**：跳过的冲突不能让这次回填记成失败。曾经的写法里，
     * `preventDefault` 只防住了事务中止，错误事件照样冒泡到 `tx.onerror`，
     * Promise 被 reject，`backfillDone` 永远是 false——之后每次打开库都整表重扫一遍。
     * 判据：把 913 的键再弄脏、再读一次；回填若已收尾，它就不会被再写回。
     */
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(POSITIONS_STORE, 'readwrite')
        tx.objectStore(POSITIONS_STORE).put({ ...base, id: 913, title: '后续', cells: cellsB, contentKey: 'stale-again' })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    await indexedDbPositions.list()
    const after = await new Promise<string>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onsuccess = () => {
        const db = req.result
        const get = db.transaction(POSITIONS_STORE, 'readonly').objectStore(POSITIONS_STORE).get(913)
        get.onsuccess = () => { db.close(); resolve((get.result as { contentKey: string }).contentKey) }
        get.onerror = () => reject(get.error)
      }
      req.onerror = () => reject(req.error)
    })
    expect(after).toBe('stale-again')
  })

  it('旧记录缺内容键时按读取规范化回填一次，坏 provenance 不产生不一致键', async () => {
    const cells = Array.from({ length: 225 }, () => 0)
    cells[7 * 15 + 7] = BLACK
    const raw = {
      schemaVersion: 2,
      id: 901,
      title: '旧记录',
      cells,
      nextPlayer: WHITE,
      provenance: { kind: 'replay', moves: [], firstPlayer: BLACK, ply: 0 },
      createdAt: 1,
      updatedAt: 1,
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => ensureSchema(req.result, req.transaction)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(POSITIONS_STORE, 'readwrite')
        tx.objectStore(POSITIONS_STORE).put(raw)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    __setPositionsIndexedDbFactory(null)
    await indexedDbPositions.list()

    const stored = await new Promise<{ contentKey?: string; provenance?: unknown }>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(POSITIONS_STORE, 'readonly')
        const get = tx.objectStore(POSITIONS_STORE).get(901)
        get.onsuccess = () => { db.close(); resolve(get.result as { contentKey?: string; provenance?: unknown }) }
        get.onerror = () => reject(get.error)
      }
      req.onerror = () => reject(req.error)
    })

    // 读取路径会把与盘面不一致的 provenance 降级为 null；原始字段不改写，
    // 但键必须按降级后的值算，否则唯一索引与读取去重对不上。
    expect(stored.provenance).toEqual(raw.provenance)
    expect(stored.contentKey).toBe(positionContentKey({ cells, nextPlayer: WHITE, provenance: null }))
  })

  it('局面内容身份不看标题，只看盘面/下一手/provenance', () => {
    const first = inputFromPosition(applyEdit(createPosition(), { x: 7, y: 7 }, 'black'), '甲', null)
    const renamed = { ...first, title: '乙' }
    const changed = inputFromPosition(applyEdit(createPosition(), { x: 8, y: 8 }, 'black'), '甲', null)
    expect(positionContentKey(first)).toBe(positionContentKey(renamed))
    expect(positionContentKey(first)).not.toBe(positionContentKey(changed))
  })

  it('v1 记录只读迁移到 v2：保留盘面，时间标记为未知', () => {
    const cells = Array.from({ length: 225 }, () => 0)
    cells[7 * 15 + 7] = 1
    const parsed = parseSavedPosition({
      schemaVersion: 1,
      id: 1,
      title: '旧局面',
      cells,
      nextPlayer: 2,
      provenance: null,
    })
    expect(parsed).toMatchObject({
      schemaVersion: 2,
      title: '旧局面',
      createdAt: null,
      updatedAt: null,
    })
  })

  it('v1 库记录被更新时写回 v2 时间字段', async () => {
    const cells = Array.from({ length: 225 }, () => 0)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(POSITIONS_STORE, 'readwrite')
      tx.objectStore(POSITIONS_STORE).put({
        schemaVersion: 1,
        id: 77,
        title: '旧局面',
        cells,
        nextPlayer: 1,
        provenance: null,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()

    const before = await indexedDbPositions.get(77)
    expect(before).toMatchObject({ schemaVersion: 2, createdAt: null, updatedAt: null })

    const saved = await indexedDbPositions.save(
      { title: '旧局面（改）', cells, nextPlayer: 1, provenance: null },
      77,
      at(1_234),
    )
    expect(saved.persisted).toBe(true)
    expect(await indexedDbPositions.get(77)).toMatchObject({
      schemaVersion: 2,
      title: '旧局面（改）',
      createdAt: 1_234,
      updatedAt: 1_234,
    })
  })

  it('v2 记录缺少时间或时间非法时拒绝', () => {
    const cells = Array.from({ length: 225 }, () => 0)
    expect(
      parseSavedPosition({
        schemaVersion: 2,
        id: 1,
        title: '坏时间',
        cells,
        nextPlayer: 1,
        provenance: null,
      }),
    ).toBeNull()
    expect(
      parseSavedPosition({
        schemaVersion: 2,
        id: 1,
        title: '坏时间',
        cells,
        nextPlayer: 1,
        provenance: null,
        createdAt: 1_000,
        updatedAt: -1,
      }),
    ).toBeNull()
    expect(
      parseSavedPosition({
        schemaVersion: 2,
        id: 1,
        title: '坏时间',
        cells,
        nextPlayer: 1,
        provenance: null,
        createdAt: 1_000,
        updatedAt: 8_640_000_000_000_001,
      }),
    ).toBeNull()
  })

  it('数据库打开成功但事务失败时抛错，不退回内存', async () => {
    const db = {
      transaction() { throw new Error('quota') },
      close() {},
    }
    const request = {
      result: db,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    }
    __setPositionsIndexedDbFactory({
      open() {
        queueMicrotask(() => request.onsuccess?.())
        return request
      },
    } as unknown as IDBFactory)

    await expect(
      indexedDbPositions.save(
        inputFromPosition(createPosition(), '配额', null),
        null,
        at(1_000),
      ),
    ).rejects.toThrow('局面库写入失败')
    __setPositionsIndexedDbFactory(null)
  })

  it('内存实现也能保存、更新并保留创建时间', async () => {
    const storage = memoryPositions()
    const saved = await storage.save(
      inputFromPosition(createPosition(), 'a', null),
      null,
      at(1_000),
    )
    expect((await storage.list()).records).toHaveLength(1)
    const updated = await storage.save(
      inputFromPosition(createPosition(WHITE), 'b', null),
      saved.record.id,
      at(2_000),
    )
    expect((await storage.list()).records[0]!.title).toBe('b')
    expect(updated.record.createdAt).toBe(1_000)
    expect(updated.record.updatedAt).toBe(2_000)
  })
})

/*
 * 库暂时打不开时，保存进的是内存兜底。原先兜底的 id 从 1 起，与库的自增 id 是同一套，
 * 且 get / save / delete 不分号段：库一恢复，界面手里那条兜底局面的 id 指向的是库里
 * **另一条**真实局面——删它会删掉那条，覆盖保存会把那条盖掉；列表也只读库，
 * 兜底的那条在同一个会话里就消失了。棋谱库 2026-11-25 已按号段隔离并补写回库，这里补齐。
 */
describe('局面库 —— 库暂时不可用后又恢复', () => {
  const real = globalThis.indexedDB
  let down = false
  const switchable = {
    open(name: string, version?: number) {
      if (down) throw new Error('局面库被其他标签页占用')
      return real.open(name, version)
    },
    deleteDatabase: (name: string) => real.deleteDatabase(name),
    databases: () => real.databases(),
    cmp: (a: unknown, b: unknown) => real.cmp(a, b),
  } as IDBFactory

  async function savedWhileDown() {
    __setPositionsIndexedDbFactory(switchable)
    down = false
    const kept = await indexedDbPositions.save(
      inputFromPosition(applyEdit(createPosition(), { x: 7, y: 7 }, 'black'), '库里原有', null),
      // 钉在 1 号：库的自增从 1 起，真实用户的第一条局面就是 1 号——正是兜底原先发出的号。
      1,
      at(1_000),
    )
    down = true
    const fallback = await indexedDbPositions.save(
      inputFromPosition(applyEdit(createPosition(), { x: 3, y: 3 }, 'white'), '兜底那条', null),
      null,
      at(2_000),
    )
    // 前提自检：确实进了内存兜底。
    expect(fallback.persisted).toBe(false)
    down = false
    return { kept: kept.record, fallback: fallback.record }
  }

  it('删除兜底那条不会删掉库里的另一条', async () => {
    try {
      const { kept, fallback } = await savedWhileDown()
      await indexedDbPositions.delete(fallback.id)
      expect(await indexedDbPositions.get(kept.id)).not.toBeNull()
    } finally {
      __setPositionsIndexedDbFactory(null)
    }
  })

  it('覆盖保存兜底那条不会盖掉库里的另一条', async () => {
    try {
      const { kept, fallback } = await savedWhileDown()
      await indexedDbPositions.save(
        inputFromPosition(applyEdit(createPosition(), { x: 4, y: 4 }, 'white'), '兜底改过', null),
        fallback.id,
        at(3_000),
      )
      expect((await indexedDbPositions.get(kept.id))?.title).toBe('库里原有')
    } finally {
      __setPositionsIndexedDbFactory(null)
    }
  })

  it('恢复后列表里仍有兜底那条（补写回库），也仍有库里原有的', async () => {
    try {
      await savedWhileDown()
      const list = await indexedDbPositions.list()
      expect(list.degraded).toBe(false)
      expect(list.records.map((record) => record.title).sort()).toEqual(['兜底那条', '库里原有'])
    } finally {
      __setPositionsIndexedDbFactory(null)
    }
  })
})

/*
 * 2026-11-27 全量审查：昨天加的兜底号段还有三个洞，各自的后果都是「改错/删错库里另一条」。
 * 这一组按真实时序走：库里先有一条 → 库不可用 → 在内存里改/存 → 库恢复、列表补写。
 */
describe('局面库 —— 降级期间编辑、多轮降级、只改标题', () => {
  const real = globalThis.indexedDB
  let down = false
  const switchable = {
    open(name: string, version?: number) {
      if (down) throw new Error('局面库被其他标签页占用')
      return real.open(name, version)
    },
    deleteDatabase: (name: string) => real.deleteDatabase(name),
    databases: () => real.databases(),
    cmp: (a: unknown, b: unknown) => real.cmp(a, b),
  } as IDBFactory

  function record(title: string, x: number) {
    return inputFromPosition(applyEdit(createPosition(), { x, y: 7 }, 'black'), title, null)
  }

  beforeEach(() => {
    __setPositionsIndexedDbFactory(switchable)
    down = false
  })

  afterEach(() => {
    down = false
    __setPositionsIndexedDbFactory(null)
  })

  it('库不可用时改一条已保存的局面：恢复后覆盖原记录，不多出一条，也不改到别的记录上', async () => {
    const original = await indexedDbPositions.save(record('原来', 7), null, at(1_000))
    const other = await indexedDbPositions.save(record('另一条', 3), null, at(1_000))

    down = true
    const edited = await indexedDbPositions.save(record('改过', 7), original.record.id, at(2_000))
    // 前提自检：确实进了内存兜底，而且没有沿用库号。
    expect(edited.persisted).toBe(false)
    expect(edited.record.id).not.toBe(original.record.id)

    down = false
    const list = await indexedDbPositions.list()
    expect(list.degraded).toBe(false)
    expect(list.records.map((entry) => entry.title).sort()).toEqual(['另一条', '改过'])
    // 原来那条被覆盖，不是新增；另一条原样。
    expect((await indexedDbPositions.get(original.record.id))?.title).toBe('改过')
    expect((await indexedDbPositions.get(other.record.id))?.title).toBe('另一条')
    // 界面手里那个兜底号仍能取到改过的那条。
    expect((await indexedDbPositions.get(edited.record.id))?.title).toBe('改过')
  })

  it('库不可用时删除一条：删的是它自己，库恢复后不会把别的记录顶替进来', async () => {
    const kept = await indexedDbPositions.save(record('留下的', 7), null, at(1_000))

    down = true
    const extra = await indexedDbPositions.save(record('临时', 3), null, at(2_000))
    await indexedDbPositions.delete(extra.record.id)
    down = false

    const list = await indexedDbPositions.list()
    expect(list.records.map((entry) => entry.title)).toEqual(['留下的'])
    expect((await indexedDbPositions.get(kept.record.id))?.title).toBe('留下的')
  })

  it('两轮降级发的兜底号不重叠：第二轮不会覆盖第一轮已经补写进库的记录', async () => {
    down = true
    const first = await indexedDbPositions.save(record('第一轮', 7), null, at(1_000))
    down = false
    await indexedDbPositions.list()
    const firstInDb = await indexedDbPositions.get(first.record.id)
    expect(firstInDb?.title).toBe('第一轮')

    down = true
    const second = await indexedDbPositions.save(record('第二轮', 3), null, at(2_000))
    expect(second.record.id).not.toBe(first.record.id)
    /*
     * 这一句是这条用例的牙：旧实现每个兜底实例都从同一个基数发号，第二轮的兜底号
     * 与第一轮相同，而映射表还留着「第一轮 → 库号」，于是按第二轮的号去取会先改道到
     * 库里第一轮那条（库还打不开时取不到，库刚恢复时取到的是错的）。
     */
    expect((await indexedDbPositions.get(second.record.id))?.title).toBe('第二轮')
    down = false

    const list = await indexedDbPositions.list()
    expect(list.records.map((entry) => entry.title).sort()).toEqual(['第一轮', '第二轮'])
    expect((await indexedDbPositions.get(firstInDb!.id))?.title).toBe('第一轮')
    expect((await indexedDbPositions.get(first.record.id))?.title).toBe('第一轮')
    expect((await indexedDbPositions.get(second.record.id))?.title).toBe('第二轮')
  })

  it('只改了标题：补写时把标题写上去，不按内容键判重丢掉', async () => {
    await indexedDbPositions.save(record('旧标题', 7), null, at(1_000))

    down = true
    await indexedDbPositions.save(record('新标题', 7), null, at(2_000))
    down = false

    const list = await indexedDbPositions.list()
    expect(list.records.map((entry) => entry.title)).toEqual(['新标题'])
    expect(list.records[0]!.updatedAt).toBe(2_000)
  })
})
