import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_PROGRESS, type LearningProgress, type ProgressStorage } from '../persist/progress'
import { createLearnStore } from './learnStore'

/** 可以精确控制成功与失败的假存储，用来构造「存储坏了」的时序。 */
class FakeStorage implements ProgressStorage {
  saved: LearningProgress = EMPTY_PROGRESS
  loadCount = 0

  private readonly failLoad: boolean
  private readonly failSave: boolean

  constructor(failLoad = false, failSave = false) {
    this.failLoad = failLoad
    this.failSave = failSave
  }

  load(): Promise<LearningProgress> {
    this.loadCount++
    return this.failLoad
      ? Promise.reject(new Error('存储坏了'))
      : Promise.resolve(this.saved)
  }

  save(progress: LearningProgress): Promise<void> {
    if (this.failSave) return Promise.reject(new Error('写不进去'))
    this.saved = progress
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.saved = EMPTY_PROGRESS
    return Promise.resolve()
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let storage: FakeStorage
let store: ReturnType<typeof createLearnStore>

const state = () => store.getState()

beforeEach(() => {
  storage = new FakeStorage()
  store = createLearnStore(storage)
})

describe('载入', () => {
  it('载入前 loaded 为 false，载入后为 true', async () => {
    expect(state().loaded).toBe(false)

    state().bootstrap()
    await flush()

    expect(state().loaded).toBe(true)
  })

  it('载入时把已有进度读进来', async () => {
    storage.saved = {
      completedLessons: ['rules'],
      solvedPuzzles: ['win-h'],
      lastVisited: { kind: 'lesson', id: 'two' },
      lastView: 'learn',
    }

    state().bootstrap()
    await flush()

    expect(state().progress.completedLessons).toEqual(['rules'])
    expect(state().progress.lastView).toBe('learn')
  })

  it('存储读失败时仍然可用，只是进度为空', async () => {
    // 这条钉住「存储坏了不能把界面卡死」：loaded 必须照样翻成 true，
    // 否则界面会永远停在加载态。
    store = createLearnStore(new FakeStorage(true))

    state().bootstrap()
    await flush()

    expect(state().loaded).toBe(true)
    expect(state().progress).toEqual(EMPTY_PROGRESS)
  })
})

describe('完成与通关', () => {
  it('完成一节课会写进进度并落盘', async () => {
    state().bootstrap()
    await flush()

    state().completeLesson('rules')
    await flush()

    expect(state().progress.completedLessons).toEqual(['rules'])
    expect(storage.saved.completedLessons).toEqual(['rules'])
  })

  it('同一节课完成两次不会重复记录', async () => {
    state().completeLesson('rules')
    state().completeLesson('rules')

    expect(state().progress.completedLessons).toEqual(['rules'])
  })

  it('通关一道题会写进进度', async () => {
    state().solvePuzzle('win-h')

    expect(state().progress.solvedPuzzles).toEqual(['win-h'])
    expect(state().isPuzzleDone('win-h')).toBe(true)
    expect(state().isPuzzleDone('win-diag')).toBe(false)
  })

  it('落盘失败不影响内存里的进度', async () => {
    store = createLearnStore(new FakeStorage(false, true))

    state().completeLesson('rules')
    await flush()

    expect(state().progress.completedLessons).toEqual(['rules'])
  })

  it('载入完成之前完成的操作不会被后到的载入覆盖', async () => {
    // 极端时序：bootstrap 还在飞，用户已经做完一节课。
    storage.saved = { ...EMPTY_PROGRESS, completedLessons: ['rules'] }

    state().bootstrap()
    state().completeLesson('defense')
    await flush()

    expect(state().progress.completedLessons).toContain('defense')
  })
})

describe('位置与视图', () => {
  it('visit 记录位置但不影响完成状态', async () => {
    state().visit('lesson', 'three')

    expect(state().progress.lastVisited).toEqual({ kind: 'lesson', id: 'three' })
    expect(state().progress.completedLessons).toEqual([])
  })

  it('visit 可以把位置清成 null', async () => {
    state().visit('puzzle', 'win-h')
    state().visit(null)

    expect(state().progress.lastVisited).toBeNull()
  })
})

describe('reset', () => {
  it('清空内存与存储', async () => {
    state().completeLesson('rules')
    state().solvePuzzle('win-h')

    state().reset()
    await flush()

    expect(state().progress).toEqual(EMPTY_PROGRESS)
    expect(storage.saved).toEqual(EMPTY_PROGRESS)
  })
})
