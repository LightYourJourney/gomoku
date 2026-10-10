import { create } from 'zustand'
import type { LearningProgress } from '../persist/progress'

export type View = LearningProgress['lastView']

export interface NavStore {
  readonly view: View
  go(view: View): void
  /** 从存档恢复上次所在的视图。只认已知的取值，认不出的留在对战页。 */
  restore(view: unknown): void
}

const VIEWS: readonly View[] = ['battle', 'learn', 'puzzles']

export function isView(value: unknown): value is View {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value)
}

/**
 * 顶层视图：现在在哪一页。
 *
 * 单独一个小 store 而不是塞进 `settingsStore`：视图不是偏好设置，它是会话状态；
 * 混进设置里会让「恢复偏好」和「恢复位置」两件事纠缠。
 *
 * **不落盘**——落盘那份由 `learnStore` 的 `lastView` 负责，两层各管一件事：
 * 这里是此刻的视图，那里是记下来的位置，由界面在切换时同时更新。
 */
export const useNavStore = create<NavStore>()((set) => ({
  view: 'battle',
  go(view) {
    set({ view })
  },
  restore(view) {
    if (isView(view)) set({ view })
  },
}))
