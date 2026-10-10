import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { indexedDbProgress, EMPTY_PROGRESS, type LearningProgress, type ProgressStorage } from '../persist/progress'

export type View = LearningProgress['lastView']

export interface LearnStore {
  readonly progress: LearningProgress
  /** 进度是否已从存储载入。false 时界面不该断言「没做过」。 */
  readonly loaded: boolean
  /** 当前在哪一页。与 `progress.lastView` 是同一件事，所以放在同一个 store 里。 */
  readonly view: View

  bootstrap(): void
  setView(view: View): void
  completeLesson(id: string): void
  solvePuzzle(id: string): void
  visit(kind: 'lesson' | 'puzzle' | null, id?: string): void
  reset(): void

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

    /** 落盘。失败就算了——内存里的进度仍然有效，本次会话照常可用。 */
    const persist = (progress: LearningProgress): void => {
      if (!get().loaded) {
        pendingPersist = true
        return
      }
      void storage.save(progress).catch(() => {})
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
      view: 'battle',

      bootstrap() {
        void storage.load().then(
          (stored) => {
            // 载入期间用户可能已经做完一节课。后到的旧数据不能把它盖掉，
            // 所以合并而不是替换。
            const current = get().progress
            set({
              progress: {
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
              void storage.save(get().progress).catch(() => {})
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

      completeLesson(id) {
        update({ completedLessons: withAdded(get().progress.completedLessons, id) })
      },

      solvePuzzle(id) {
        update({ solvedPuzzles: withAdded(get().progress.solvedPuzzles, id) })
      },

      visit(kind, id) {
        update({ lastVisited: kind === null || id === undefined ? null : { kind, id } })
      },

      reset() {
        set({ progress: EMPTY_PROGRESS })
        void storage.clear().catch(() => {})
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
