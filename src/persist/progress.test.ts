import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __setIndexedDbFactory,
  clearProgress,
  EMPTY_PROGRESS,
  indexedDbProgress,
  loadProgress,
  PROGRESS_SCHEMA_VERSION,
  saveProgress,
  type LearningProgress,
} from './progress'

const SAMPLE: LearningProgress = {
  schemaVersion: PROGRESS_SCHEMA_VERSION,
  completedLessons: ['rules', 'two'],
  solvedPuzzles: ['win-h'],
  lastVisited: { kind: 'lesson', id: 'three' },
  lastView: 'learn',
}

beforeEach(async () => {
  __setIndexedDbFactory(null)
  await clearProgress()
})

afterEach(() => {
  __setIndexedDbFactory(null)
})

describe('学习进度存储', () => {
  it('没存过时返回空进度', async () => {
    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })

  it('存进去能原样读回来', async () => {
    await saveProgress(SAMPLE)

    expect(await loadProgress()).toEqual(SAMPLE)
  })

  it('覆盖写而不是追加', async () => {
    await saveProgress(SAMPLE)
    await saveProgress({ ...SAMPLE, completedLessons: ['defense'] })

    expect((await loadProgress()).completedLessons).toEqual(['defense'])
  })

  it('数据真的落在 IndexedDB 里：清掉内存态之后还能读回来', async () => {
    // 这条是**唯一**能证明数据穿过 IndexedDB 的用例。少了它，上面那些
    // 「存进去能读回来」全都可能只是内存兜底在自说自话——
    // saveProgress 会先写内存再写库，读的时候内存优先。
    await saveProgress(SAMPLE)

    // 把内存态清掉，模拟「应用重启」：这一次只能从库里读
    __setIndexedDbFactory(null)

    expect(await loadProgress()).toEqual(SAMPLE)
  })

  it('清空也落到了库里：重启之后仍然是空的', async () => {
    await saveProgress(SAMPLE)
    await clearProgress()

    __setIndexedDbFactory(null)

    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })

  it('清空后回到空进度', async () => {
    await saveProgress(SAMPLE)
    await clearProgress()

    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })

  it('空进度也是合法输入，读回来还是空进度', async () => {
    await saveProgress(EMPTY_PROGRESS)

    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })
})

describe('学习进度存储 —— 降级', () => {
  it('IndexedDB 整个不存在时降级为内存态，读写仍然能用', async () => {
    // 隐私模式、无痕窗口里 `indexedDB` 可能压根是 undefined。
    // 进度丢了可以接受，**白屏不行**。
    //
    // 注意 `__setIndexedDbFactory(null)` 的语义是「回落到全局那一个」——
    // 本文件顶部装了 fake-indexeddb，全局是可用的，所以光调它测不到降级。
    // 必须真的把全局摘掉，才是在测「没有 IndexedDB 也能用」。
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      // 前提自检：全局真的没了。否则这条用例会悄悄退回用真 IDB，
      // 名字写着「降级」却什么都没验。
      expect(typeof indexedDB, '全局 indexedDB 应当已被摘掉').toBe('undefined')

      await saveProgress(SAMPLE)

      expect(await loadProgress()).toEqual(SAMPLE)
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, 'indexedDB', saved)
    }
  })

  it('open 直接抛错时同样降级为内存态', async () => {
    __setIndexedDbFactory({
      open() {
        throw new Error('隐私模式')
      },
    } as unknown as IDBFactory)

    await saveProgress(SAMPLE)

    expect(await loadProgress()).toEqual(SAMPLE)
  })

  it('open 触发 onerror 时降级，且不留下悬挂的 Promise', async () => {
    __setIndexedDbFactory({
      open() {
        const request = { onerror: null, onsuccess: null, onupgradeneeded: null } as unknown as IDBOpenDBRequest
        queueMicrotask(() => request.onerror?.(new Event('error') as never))
        return request
      },
    } as unknown as IDBFactory)

    await expect(saveProgress(SAMPLE)).resolves.toBeUndefined()
    expect(await loadProgress()).toEqual(SAMPLE)
  })

  it('readonly 存取器也能注入（模拟 indexedDB 被禁用）', async () => {
    __setIndexedDbFactory(null)

    expect(indexedDbProgress).toBeDefined()
    await expect(indexedDbProgress.load()).resolves.toEqual(EMPTY_PROGRESS)
  })
})

describe('学习进度存储 —— 损坏数据', () => {
  it('读到形状不对的对象时退回空进度，不抛错', async () => {
    // 与 persist/storage.ts 同一条口径：宁可当作没有进度，
    // 也不把半截数据灌进状态机。
    const raw = {
      completedLessons: 'not-an-array',
      solvedPuzzles: [1, 2, 3],
      lastVisited: { kind: 'nope', id: 5 },
      lastView: 'somewhere',
    }

    await writeRaw(raw)

    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })

  it('数组里混进非字符串时整条退回空进度', async () => {
    await writeRaw({ completedLessons: ['rules', 7] })

    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })

  it('lastVisited 为 null 是合法的', async () => {
    await writeRaw({
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      completedLessons: [],
      solvedPuzzles: [],
      lastVisited: null,
      lastView: 'battle',
    })

    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })

  it('版本号对不上的存档被丢弃，而不是悄悄读进来', async () => {
    // 与对局存档同一条口径：形状变了就丢，宁可重来也不把半成品灌进状态机。
    await writeRaw({
      schemaVersion: PROGRESS_SCHEMA_VERSION + 1,
      completedLessons: ['rules'],
      solvedPuzzles: [],
      lastVisited: null,
      lastView: 'learn',
    })

    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })
})

/** 绕过类型直接往库里写一份原始数据，用来构造「存进去的东西坏了」的情形。 */
async function writeRaw(value: unknown): Promise<void> {
  const request = globalThis.indexedDB.open('gomoku-lab', 1)

  await new Promise<void>((resolve, reject) => {
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress')
    }
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('打不开数据库'))
  })

  const db = request.result
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('progress', 'readwrite')
    tx.objectStore('progress').put(value, 'learning')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error('写不进去'))
  })
  db.close()
}

describe("lastView 的 'review' 取值", () => {
  it("lastView 为 'review' 的进度能完整读回，不丢课程与刷题记录", async () => {
    const review: LearningProgress = {
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      completedLessons: ['rules'],
      solvedPuzzles: ['win-h'],
      lastVisited: null,
      lastView: 'review',
    }
    await saveProgress(review)

    // 模拟「重启」：清掉内存态，逼 loadProgress 走 IndexedDB → parseProgress。
    // 不清的话 save 写进内存的未过滤数据会掩盖白名单的拒收——那正是要测的。
    __setIndexedDbFactory(null) // 副作用：memoryFallback = null
    // 恢复全局 IDB 工厂（上面那步把它指回全局了；fake-indexeddb 仍是全局）
    __setIndexedDbFactory(null)

    expect(await loadProgress()).toEqual(review)
  })
})
