import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_PROGRESS, type LearningProgress, type ProgressStorage } from '../persist/progress'
import { createLearnStore } from './learnStore'

/** 可以精确控制成功与失败的假存储，用来构造「存储坏了」的时序。 */
class FakeStorage implements ProgressStorage {
  saved: LearningProgress = EMPTY_PROGRESS
  loadCount = 0

  private readonly failLoad: boolean
  private failSave: boolean

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

  saveStrict(progress: LearningProgress): Promise<boolean> {
    if (this.failSave) return Promise.resolve(false)
    this.saved = progress
    return Promise.resolve(true)
  }

  setFailSave(fail: boolean): void {
    this.failSave = fail
  }

  clear(): Promise<void> {
    this.saved = EMPTY_PROGRESS
    return Promise.resolve()
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

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
    await tick()

    expect(state().loaded).toBe(true)
  })

  it('载入时把已有进度读进来', async () => {
    storage.saved = {
      ...EMPTY_PROGRESS,
      completedLessons: ['rules'],
      solvedPuzzles: ['win-h'],
      lastVisited: { kind: 'lesson', id: 'two' },
      lastView: 'learn',
    }

    state().bootstrap()
    await tick()

    expect(state().progress.completedLessons).toEqual(['rules'])
    expect(state().progress.lastView).toBe('learn')
  })

  it('存储读失败时仍然可用，只是进度为空', async () => {
    // 这条钉住「存储坏了不能把界面卡死」：loaded 必须照样翻成 true，
    // 否则界面会永远停在加载态。
    store = createLearnStore(new FakeStorage(true))

    state().bootstrap()
    await tick()

    expect(state().loaded).toBe(true)
    expect(state().progress).toEqual(EMPTY_PROGRESS)
  })
})

describe('完成与通关', () => {
  it('完成一节课会写进进度并落盘', async () => {
    state().bootstrap()
    await tick()

    state().completeLesson('rules')
    await tick()

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

  it('落盘失败进入 failed，重试成功后回到 idle', async () => {
    state().bootstrap()
    await tick()
    storage.setFailSave(true)
    state().completeLesson('rules')
    await state().flush()
    expect(state().persistState).toBe('failed')

    storage.setFailSave(false)
    state().retryPersist()
    await state().flush()
    expect(state().persistState).toBe('idle')
    expect(storage.saved.completedLessons).toEqual(['rules'])
  })

  it('adoptProgress 可只更新内存、跳过重复落盘', async () => {
    state().adoptProgress({ ...EMPTY_PROGRESS, completedLessons: ['rules'] }, false)
    await tick()

    expect(state().progress.completedLessons).toEqual(['rules'])
    expect(storage.saved.completedLessons).toEqual([])
  })

  it('落盘失败不影响内存里的进度', async () => {
    store = createLearnStore(new FakeStorage(false, true))

    state().completeLesson('rules')
    await tick()

    expect(state().progress.completedLessons).toEqual(['rules'])
  })

  it('载入期间切换了视图的话，后到的载入不能把它顶回存储里的那一页', async () => {
    // 首屏载入很快，但点得够快就会踩到这个竞态：bootstrap 还在飞，
    // 用户已经点了「教学」。
    storage.saved = { ...EMPTY_PROGRESS, lastView: 'battle' }

    state().bootstrap()
    state().setView('learn')
    await tick()

    expect(state().view).toBe('learn')
    expect(state().progress.lastView).toBe('learn')
    // 而且这次操作必须真的落盘——否则刷新之后会退回原样
    expect(storage.saved.lastView).toBe('learn')
  })

  it('载入完成之前完成的操作不会被后到的载入覆盖', async () => {
    // 极端时序：bootstrap 还在飞，用户已经做完一节课。
    storage.saved = { ...EMPTY_PROGRESS, completedLessons: ['rules'] }

    state().bootstrap()
    state().completeLesson('defense')
    await tick()

    expect(state().progress.completedLessons).toContain('defense')
  })
})

describe('视图', () => {
  it('默认停在对战页', () => {
    expect(state().view).toBe('battle')
  })

  it('setView 同时更新当前视图与要落盘的位置', async () => {
    state().bootstrap()
    await tick()

    state().setView('puzzles')
    await tick()

    expect(state().view).toBe('puzzles')
    expect(state().progress.lastView).toBe('puzzles')
    expect(storage.saved.lastView).toBe('puzzles')
  })

  it('载入时恢复上次所在的视图', async () => {
    storage.saved = { ...EMPTY_PROGRESS, lastView: 'learn' }

    state().bootstrap()
    await tick()

    expect(state().view).toBe('learn')
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

describe("视图扩展 —— 'review'", () => {
  it("setView('review') 后 view 是 'review'", () => {
    state().setView('review')

    expect(state().view).toBe('review')
  })

  it("setView('review') 把 lastView 落盘", () => {
    state().setView('review')

    expect(state().progress.lastView).toBe('review')
  })
})


/**
 * 可以精确控制「哪一次写入何时完成」的存储。
 *
 * 用它构造真实的竞态：第一次写入还挂着，第二次修改已经发生。
 */
class GatedStorage implements ProgressStorage {
  saved: LearningProgress = EMPTY_PROGRESS
  calls: LearningProgress[] = []
  private gates: Array<{ resolve: () => void; reject: (error: Error) => void }> = []

  load(): Promise<LearningProgress> {
    return Promise.resolve(this.saved)
  }

  save(progress: LearningProgress): Promise<void> {
    this.calls.push(progress)
    return new Promise<void>((resolve, reject) => {
      this.gates.push({
        resolve: () => {
          this.saved = progress
          resolve()
        },
        reject,
      })
    })
  }

  clear(): Promise<void> {
    this.saved = EMPTY_PROGRESS
    return Promise.resolve()
  }

  /** 完成最早那一笔还没结束的写入。 */
  finishNext(): void {
    const gate = this.gates.shift()
    if (gate === undefined) throw new Error('没有在飞的写入')
    gate.resolve()
  }

  failNext(): void {
    const gate = this.gates.shift()
    if (gate === undefined) throw new Error('没有在飞的写入')
    gate.reject(new Error('写不进去'))
  }

  get inflight(): number {
    return this.gates.length
  }
}

describe('写入时序（Phase 09A）', () => {
  let gated: GatedStorage

  beforeEach(async () => {
    gated = new GatedStorage()
    store = createLearnStore(gated)
    state().bootstrap()
    await tick()
  })

  it('连续修改时按顺序写，最后落盘的一定是最新状态', async () => {
    state().visit('lesson', 'rules')
    state().visit('lesson', 'two')

    // 第二次还没轮到：第一笔在飞，最新的那份先排队
    expect(gated.calls.map((p) => p.lastVisited?.id)).toEqual(['rules'])

    gated.finishNext()
    await tick()

    expect(gated.calls.map((p) => p.lastVisited?.id)).toEqual(['rules', 'two'])

    gated.finishNext()
    await tick()
    expect(gated.saved.lastVisited).toEqual({ kind: 'lesson', id: 'two' })
  })

  it('旧写入不会覆盖新数据：第一笔完成之后才写第二笔', async () => {
    state().setView('learn')
    state().setView('puzzles')

    expect(gated.calls).toHaveLength(1)
    gated.finishNext()
    await tick()
    expect(gated.calls).toHaveLength(2)
    gated.finishNext()
    await tick()

    expect(gated.saved.lastView).toBe('puzzles')
  })

  it('flush 会等到队列排空，而不是只看当前这一笔', async () => {
    state().visit('lesson', 'rules')
    state().visit('lesson', 'two')

    let done = false
    void state().flush().then(() => { done = true })

    await Promise.resolve()
    expect(done).toBe(false) // 第一笔还挂着

    gated.finishNext()
    await tick()
    expect(gated.calls).toHaveLength(2) // flush 期间第二笔已经发出
    expect(done).toBe(false)

    gated.finishNext()
    await tick()
    expect(done).toBe(true)
    expect(gated.saved.lastVisited).toEqual({ kind: 'lesson', id: 'two' })
  })

  it('没有待写时 flush 立即完成', async () => {
    await expect(state().flush()).resolves.toBeUndefined()
  })

  it('一次写入失败不会卡住后续写入', async () => {
    state().visit('lesson', 'rules')
    gated.failNext()
    await tick()

    state().visit('lesson', 'two')
    gated.finishNext()
    await tick()

    expect(gated.saved.lastVisited).toEqual({ kind: 'lesson', id: 'two' })
  })

  it('把设置成同一个值不会重复写入', async () => {
    state().setView('learn')
    gated.finishNext()
    await tick()
    const before = gated.calls.length

    state().setView('learn')

    expect(gated.calls.length).toBe(before)
  })
})
