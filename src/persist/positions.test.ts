import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
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
