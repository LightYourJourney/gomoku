import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __setIndexedDbFactory,
  clearProgress,
  indexedDbProgress,
  loadProgress,
  PROGRESS_SCHEMA_VERSION,
  saveProgress,
} from '../persist/progress'
import { createLearnStore } from './learnStore'

/*
 * 「读失败」与「库里确实没有」原先被合成同一个返回值（空进度）：
 * 启动时打开库失败一次（被别的标签页占着、偶发报错），进度就当成空的、标为已载入；
 * 随后完成一节课，那次写入打开成功，把库里整条进度写成只有这一节——
 * 界面还显示「已保存」，刷新后之前的课和题全没了。
 * 这一组用真实的 IndexedDB 实现（fake-indexeddb）走一遍那条时序。
 */
const SEEDED = {
  schemaVersion: PROGRESS_SCHEMA_VERSION,
  completedLessons: ['rules', 'two', 'three'],
  solvedPuzzles: ['win-h', 'block-h'],
  lastVisited: null,
  lastView: 'learn',
} as const

const real = globalThis.indexedDB

/** 第一次 `open` 抛错（像被别的标签页占着），之后照常。 */
function failsFirstOpen(): IDBFactory {
  let failed = false
  return {
    open(name: string, version?: number) {
      if (!failed) {
        failed = true
        throw new Error('进度库被其他标签页占用')
      }
      return real.open(name, version)
    },
    deleteDatabase: (name: string) => real.deleteDatabase(name),
    databases: () => real.databases(),
    cmp: (a: unknown, b: unknown) => real.cmp(a, b),
  } as IDBFactory
}

async function bootedAfterFailedRead() {
  // 换工厂同时清掉内存兜底，相当于「应用重启」。
  __setIndexedDbFactory(failsFirstOpen())
  const store = createLearnStore(indexedDbProgress)
  store.getState().bootstrap()
  await expect.poll(() => store.getState().loaded).toBe(true)
  // 前提自检：启动那次确实没读出来，否则下面测的是正常路径。
  expect(store.getState().progress.completedLessons).toEqual([])
  return store
}

beforeEach(async () => {
  __setIndexedDbFactory(null)
  await clearProgress()
  await saveProgress(SEEDED)
})

afterEach(() => {
  __setIndexedDbFactory(null)
})

describe('learnStore × IndexedDB —— 启动时读进度失败', () => {
  it('之后的写入不抹掉库里已有的课程与残局', async () => {
    const store = await bootedAfterFailedRead()

    store.getState().completeLesson('defense')
    await store.getState().flush()

    __setIndexedDbFactory(null)
    const stored = await loadProgress()
    expect([...stored.completedLessons].sort()).toEqual(['defense', 'rules', 'three', 'two'])
    expect([...stored.solvedPuzzles].sort()).toEqual(['block-h', 'win-h'])
  })

  it('备份与导入合并拿到的当前进度包含库里的那一份', async () => {
    const store = await bootedAfterFailedRead()

    const current = await store.getState().currentProgress()
    expect([...current.completedLessons].sort()).toEqual(['rules', 'three', 'two'])
    expect([...current.solvedPuzzles].sort()).toEqual(['block-h', 'win-h'])
  })
})
