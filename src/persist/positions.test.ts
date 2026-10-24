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
      req.onupgradeneeded = () => ensureSchema(req.result)
    })
    expect([...db.objectStoreNames].sort()).toEqual(
      [POSITIONS_STORE, PROGRESS_STORE, RECORDS_STORE].sort(),
    )
    db.close()
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
        updatedAt: 1e20,
      }),
    ).toBeNull()
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
