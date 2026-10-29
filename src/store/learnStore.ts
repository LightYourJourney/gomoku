import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { indexedDbProgress, EMPTY_PROGRESS, type LearningProgress, type ProgressStorage } from '../persist/progress'

export type View = LearningProgress['lastView']

export interface LearnStore {
  readonly progress: LearningProgress
  /** 进度是否已从存储载入。false 时界面不该断言「没做过」。 */
  readonly loaded: boolean
  /** 最近一次写入是否失败；成功后回到 idle。 */
  readonly persistState: 'idle' | 'saving' | 'failed'
  /** 当前在哪一页。与 `progress.lastView` 是同一件事，所以放在同一个 store 里。 */
  readonly view: View

  bootstrap(): void
  /** 导入备份后用合并结果替换内存态；写入走同一条串行队列。 */
  adoptProgress(progress: LearningProgress, persist?: boolean): void
  /**
   * 等所有已排队的写入结束。
   *
   * 生命周期钩子（`pagehide` / `visibilitychange`）与测试用它做同步点——
   * **它不是「落盘保证」**：页面在等待期间被销毁，异步写入仍可能来不及提交。
   */
  flush(): Promise<void>
  /** 重新尝试落盘当前内存进度。 */
  retryPersist(): void
  setView(view: View): void
  completeLesson(id: string): void
  solvePuzzle(id: string): void
  visit(kind: 'lesson' | 'puzzle' | null, id?: string): void

  isLessonDone(id: string): boolean
  isPuzzleDone(id: string): boolean
}

function withAdded(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) ? list : [...list, id]
}

/**
 * 学习进度状态机。
 *
 * 与 `createGameStore(engine)` 同一套做法：**存储从外面注入**，所以它可以脱离
 * 浏览器直接单测，不需要 fake-indexeddb 参与。
 */
export function createLearnStore(storage: ProgressStorage): UseBoundStore<StoreApi<LearnStore>> {
  return create<LearnStore>()((set, get) => {
    /**
     * 载入完成之前发生的写入。
     *
     * 不能直接落盘——那时的进度还没跟存储里的合并，写下去会把已有记录覆盖掉。
     * 但也**不能直接丢掉**：首屏载入很快，用户点得够快就会踩到，结果是这一次
     * 操作根本没被记住（刷新之后退回原样）。所以挂起，载入后补写。
     */
    let pendingPersist = false

    /**
     * 队列里最新的一份待写状态；`null` 表示没有待写。
     *
     * **只保留最新一份**：一次修改在写、下一次修改到来时，中间态没有再写的价值。
     * 这样既不会让旧写入覆盖新数据（同一时刻只有一条写链），也不会在连续点击时
     * 排出一长串重复写入。
     */
    let queued: LearningProgress | null = null

    /** 当前这条写链；`null` 表示没有在写。 */
    let writing: Promise<void> | null = null

    /**
     * 把队列里的状态依次写出去。
     *
     * 失败只吞掉这一笔、**不原地重试**：存储永久坏掉时（隐私模式、被其他标签页
     * 占用）重试会变成死循环。内存里的进度仍然正确，下一次变更会重新排队。
     */
    async function drain(): Promise<void> {
      try {
        while (queued !== null) {
          const next = queued
          queued = null
          set({ persistState: 'saving' })
          try {
            const ok = storage.saveStrict
              ? await storage.saveStrict(next)
              : (await storage.save(next), true)
            set({ persistState: ok ? 'idle' : 'failed' })
          } catch {
            // 失败不原地重试；下一次变更或用户点“重试”再排队。
            set({ persistState: 'failed' })
          }
        }
      } finally {
        writing = null
      }
    }

    /**
     * 发起一次写入。
     *
     * 载入完成之前只挂起（不能拿合并前的进度覆盖存储）；载入之后交给写链。
     * 写链是**串行**的，所以「旧写入后完成、覆盖新数据」在结构上不可能发生。
     */
    const persist = (progress: LearningProgress): void => {
      if (!get().loaded) {
        pendingPersist = true
        return
      }
      queued = progress
      if (writing === null) writing = drain()
    }

    const flush = (): Promise<void> => {
      // drain 的 while 会吃掉「在写期间排进来的最新一份」，等它本身即可。
      if (writing !== null) return writing
      if (queued !== null) {
        writing = drain()
        return writing
      }
      return Promise.resolve()
    }

    /**
     * 合并式更新。**内容没变就不 set**——`withAdded` 在 id 已存在时返回原数组，
     * 所以这里用引用比较就够。少了这道闸门，一个反复调用 `completeLesson`
     * 的 effect 会一路把 React 推进「Maximum update depth exceeded」。
     */
    const update = (patch: Partial<LearningProgress>): void => {
      const current = get().progress
      const changed = (Object.keys(patch) as Array<keyof LearningProgress>).some(
        (key) => !Object.is(current[key], patch[key]),
      )
      if (!changed) return

      const progress = { ...current, ...patch }
      set({ progress })
      persist(progress)
    }

    return {
      progress: EMPTY_PROGRESS,
      loaded: false,
      persistState: 'idle',
      view: 'battle',

      bootstrap() {
        void storage.load().then(
          (stored) => {
            // 载入期间用户可能已经做完一节课。后到的旧数据不能把它盖掉，
            // 所以合并而不是替换。
            const current = get().progress
            set({
              progress: {
                schemaVersion: stored.schemaVersion,
                completedLessons: [
                  ...new Set([...stored.completedLessons, ...current.completedLessons]),
                ],
                solvedPuzzles: [...new Set([...stored.solvedPuzzles, ...current.solvedPuzzles])],
                lastVisited: current.lastVisited ?? stored.lastVisited,
                lastView: current.lastView === 'battle' ? stored.lastView : current.lastView,
              },
              loaded: true,
              // 位置同样要合并：载入期间用户可能已经点了导航。直接把存储里的
              // lastView 赋给 view 会把他刚点的那一页顶掉——首屏载入很快，
              // 但点得够快就会踩到。
              view: current.lastView === 'battle' ? stored.lastView : current.lastView,
            })

            // 把载入期间挂起的那次写入补上
            if (pendingPersist) {
              pendingPersist = false
              persist(get().progress)
            }
          },
          () => {
            // 存储坏了也要翻成已载入，否则界面会永远停在加载态。
            set({ loaded: true })
          },
        )
      },

      setView(view) {
        set({ view })
        update({ lastView: view })
      },

      adoptProgress(progress, shouldPersist = true) {
        set({ progress, loaded: true })
        if (shouldPersist) persist(progress)
      },

      flush,

      retryPersist() {
        if (!get().loaded) return
        persist(get().progress)
      },

      completeLesson(id) {
        update({ completedLessons: withAdded(get().progress.completedLessons, id) })
      },

      solvePuzzle(id) {
        update({ solvedPuzzles: withAdded(get().progress.solvedPuzzles, id) })
      },

      visit(kind, id) {
        update({ lastVisited: kind === null || id === undefined ? null : { kind, id } })
      },

      isLessonDone(id) {
        return get().progress.completedLessons.includes(id)
      },

      isPuzzleDone(id) {
        return get().progress.solvedPuzzles.includes(id)
      },
    }
  })
}

/** 应用唯一的单例入口，与 `useGameStore` / `useSettingsStore` 并列。 */
export const useLearnStore = createLearnStore(indexedDbProgress)
