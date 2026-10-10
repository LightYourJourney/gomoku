import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore, useThemeEffect } from './settingsStore'

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
  }

  window.matchMedia = (() => query) as unknown as typeof window.matchMedia

  return {
    setMatches(value: boolean) {
      query.matches = value
      for (const listener of listeners) listener({ matches: value } as MediaQueryListEvent)
    },
    get listenerCount(): number {
      return listeners.size
    },
  }
}

beforeEach(() => {
  document.documentElement.className = ''
  useSettingsStore.setState({ theme: 'system', showCoords: true, soundEnabled: true })
})

describe('useThemeEffect', () => {
  it('显式选深色时给根元素加上 dark 类', () => {
    stubMatchMedia(false)
    useSettingsStore.setState({ theme: 'dark' })

    renderHook(() => useThemeEffect())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('显式选浅色时不加 dark 类', () => {
    stubMatchMedia(true)
    useSettingsStore.setState({ theme: 'light' })

    renderHook(() => useThemeEffect())

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('跟随系统时按系统偏好决定', () => {
    stubMatchMedia(true)

    renderHook(() => useThemeEffect())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('跟随系统时能实时响应系统主题变化', () => {
    const media = stubMatchMedia(false)
    renderHook(() => useThemeEffect())
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => media.setMatches(true))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('显式指定主题时不去订阅系统变化', () => {
    const media = stubMatchMedia(false)
    useSettingsStore.setState({ theme: 'dark' })

    renderHook(() => useThemeEffect())

    expect(media.listenerCount).toBe(0)
  })
})
