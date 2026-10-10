import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { indexedDbProgress, EMPTY_PROGRESS, type LearningProgress, type ProgressStorage } from '../persist/progress'

export interface LearnStore {
  readonly progress: LearningProgress
  /** 进度是否已从存储载入。false 时界面不该断言「没做过」。 */
  readonly loaded: boolean

  bootstrap(): void
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
     * 落盘。失败就算了——内存里的进度仍然有效，本次会话照常可用。
     * `loaded` 之前不落盘：那时的进度还没跟存储里的合并，写下去会覆盖掉已有记录。
     */
    const persist = (progress: LearningProgress): void => {
      if (!get().loaded) return
      void storage.save(progress).catch(() => {})
    }

    const update = (patch: Partial<LearningProgress>): void => {
      const progress = { ...get().progress, ...patch }
      set({ progress })
      persist(progress)
    }

    return {
      progress: EMPTY_PROGRESS,
      loaded: false,

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
            })
          },
          () => {
            // 存储坏了也要翻成已载入，否则界面会永远停在加载态。
            set({ loaded: true })
          },
        )
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
