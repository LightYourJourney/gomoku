import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __setIndexedDbFactory,
  clearProgress,
  EMPTY_PROGRESS,
  indexedDbProgress,
  loadProgress,
  saveProgress,
  type LearningProgress,
} from './progress'

const SAMPLE: LearningProgress = {
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
  it('IndexedDB 不可用时降级为内存态，读写仍然能用', async () => {
    // 隐私模式、无痕窗口里 indexedDB 可能是 undefined，或者 open 直接失败。
    // 进度丢了可以接受，**白屏不行**。
    __setIndexedDbFactory(null)

    await saveProgress(SAMPLE)

    expect(await loadProgress()).toEqual(SAMPLE)
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
    await writeRaw({ completedLessons: [], solvedPuzzles: [], lastVisited: null, lastView: 'battle' })

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
