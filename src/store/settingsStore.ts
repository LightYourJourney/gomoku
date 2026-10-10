import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyTheme, resolveTheme, type ThemePreference } from '../lib/theme'

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
    { name: 'gomoku-lab:settings' },
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
