import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyTheme, isThemePreference, resolveTheme, type ThemePreference } from '../lib/theme'

export interface SettingsStore {
  theme: ThemePreference
  showCoords: boolean
  soundEnabled: boolean
  setTheme(theme: ThemePreference): void
  setShowCoords(showCoords: boolean): void
  setSoundEnabled(soundEnabled: boolean): void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'system',
      showCoords: true,
      soundEnabled: true,
      setTheme: (theme) => set({ theme }),
      setShowCoords: (showCoords) => set({ showCoords }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
    }),
    {
      name: 'gomoku-lab:settings',
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
