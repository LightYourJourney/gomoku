import { useEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { applyTheme, isThemePreference, resolveTheme, type ThemePreference } from '../lib/theme'

const SETTINGS_STORAGE_KEY = 'gomoku-lab:settings'

export interface PreferencesSnapshot {
  readonly theme: ThemePreference
  readonly showCoords: boolean
  readonly soundEnabled: boolean
}

export interface SettingsStore {
  theme: ThemePreference
  showCoords: boolean
  soundEnabled: boolean
  /**
   * 最近一次写 localStorage 失败了（配额满、浏览器禁用存储）。**只是运行时信号**，
   * 不落盘：内存里的设置照常生效，只是刷新后会回到上次存下的值，界面要能说出来。
   */
  persistFailed: boolean
  setTheme(theme: ThemePreference): void
  setShowCoords(showCoords: boolean): void
  setSoundEnabled(soundEnabled: boolean): void
  /** 导入备份用：三项一起写；落盘校验失败时回滚并抛错。 */
  restorePreferences(next: PreferencesSnapshot): void
}

/**
 * 写失败不往上抛的 localStorage。
 *
 * zustand 的 `persist` 在每次 `set` 之后**同步**调 `setItem`、不捕获异常：配额满时
 * `setTheme` 这类按钮回调会把 `QuotaExceededError` 抛进事件处理器——内存值已改、
 * 用户却什么提示都看不到。这里吞掉异常、改为置 `persistFailed`，成功一次就清掉。
 * `restorePreferences` 不受影响：它写完会**读回校验**，写不进去照样回滚并抛错。
 */
const guardedLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  removeItem: (name) => localStorage.removeItem(name),
  setItem: (name, value) => {
    let failed = false
    try {
      localStorage.setItem(name, value)
    } catch {
      failed = true
    }
    // 只在状态真的翻转时 set：`set` 会再触发一次 `setItem`，不加这道判断就是死循环。
    if (useSettingsStore.getState().persistFailed !== failed) {
      useSettingsStore.setState({ persistFailed: failed })
    }
  },
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      showCoords: true,
      soundEnabled: true,
      persistFailed: false,
      setTheme: (theme) => set({ theme }),
      setShowCoords: (showCoords) => set({ showCoords }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      restorePreferences(next) {
        const previous = {
          theme: get().theme,
          showCoords: get().showCoords,
          soundEnabled: get().soundEnabled,
        }
        try {
          set(next)
          const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
          if (raw === null) throw new Error('显示偏好写入失败')
          const stored = (JSON.parse(raw) as { state?: Record<string, unknown> }).state
          if (
            stored?.theme !== next.theme ||
            stored?.showCoords !== next.showCoords ||
            stored?.soundEnabled !== next.soundEnabled
          ) {
            throw new Error('显示偏好写入失败')
          }
        } catch {
          try {
            set(previous)
          } catch {
            // 存储仍不可用，至少保持内存回滚；由调用方显示失败。
          }
          throw new Error('显示偏好写入失败')
        }
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => guardedLocalStorage),
      // 只存三项偏好；`persistFailed` 是运行时信号，存进去就成了下次启动的假警报。
      partialize: ({ theme, showCoords, soundEnabled }) => ({ theme, showCoords, soundEnabled }),
      /**
       * 逐字段校验读回来的设置，不合格的回落到当前值（水合时就是默认值）。
       *
       * 这是仓库里唯一用 `persist` 的持久化模块，也是唯一没有校验的——另外三个
       * （对局存档 / 学习进度 / 棋谱库）都有版本闸门 + 严格校验。少了它，
       * localStorage 里一个被改坏的 `theme` 会直接进 store：`THEME_LABELS[theme]`
       * 变 `undefined`，主题按钮的 title 显示「主题：undefined」。
       *
       * **刻意不给 `version`。** zustand 在版本不匹配且没有 `migrate` 时会**丢弃
       * 整份持久化状态**（`zustand/middleware` 的 version 分支只 `console.error`
       * 就往下走，最终 `migratedState` 是 `undefined`）。升一次版本号就等于把
       * 所有现有用户的设置重置——那是「改坏数据」，不是「修坏数据」。
       * 只加 `merge` 就够：它在每次水合时都会跑。
       */
      merge: (persisted, current) => {
        if (typeof persisted !== 'object' || persisted === null) return current

        const raw = persisted as Record<string, unknown>
        return {
          ...current,
          theme: isThemePreference(raw.theme) ? raw.theme : current.theme,
          showCoords: typeof raw.showCoords === 'boolean' ? raw.showCoords : current.showCoords,
          soundEnabled:
            typeof raw.soundEnabled === 'boolean' ? raw.soundEnabled : current.soundEnabled,
        }
      },
    },
  ),
)

/**
 * 把主题偏好落到 <html> 上。
 * 选「跟随系统」时要跟着系统设置实时变，所以订阅 matchMedia 的变化。
 */
export function useThemeEffect(): void {
  const theme = useSettingsStore((state) => state.theme)

  useEffect(() => {
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null

    const update = (): void => {
      applyTheme(resolveTheme(theme, media?.matches ?? false))
    }

    update()

    if (theme !== 'system' || media === null) return

    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])
}
