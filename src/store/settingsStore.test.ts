import { act, renderHook } from '@testing-library/react'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore, useThemeEffect } from './settingsStore'

// jsdom 没有 matchMedia，本文件用一个桩顶上。**用完必须还回去**——
// 不还原的话，同文件里将来新增的用例会以为 matchMedia 一定存在。
const originalMatchMedia = window.matchMedia

afterAll(() => {
  if (originalMatchMedia === undefined) Reflect.deleteProperty(window, 'matchMedia')
  else window.matchMedia = originalMatchMedia
})

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

/**
 * 设置是**唯一**没有 schema 版本与校验的持久化模块（另外三个：对局存档 /
 * 学习进度 / 棋谱库，都有版本闸门 + 逐字段严格校验），而它是唯一用
 * zustand `persist` 的。localStorage 里被改坏的值过去会**直接进 store**：
 * `THEME_LABELS[theme]` 变 undefined，主题按钮的 title 显示「主题：undefined」。
 */
describe('useSettingsStore —— 持久化的坏数据', () => {
  const KEY = 'gomoku-lab:settings'

  beforeEach(() => {
    localStorage.clear()
  })

  it('版本相同但字段值非法时，逐字段回落到默认值', async () => {
    // version 必须与当前一致（0），否则走的是「版本不匹配」那条路——
    // 那样即使不加校验，断言也会因为 zustand 丢弃整份状态而变绿，
    // 等于什么都没测。
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { theme: 'foo', showCoords: 'yes', soundEnabled: 'nope' }, version: 0 }),
    )

    await useSettingsStore.persist.rehydrate()

    const state = useSettingsStore.getState()
    expect(state.theme).toBe('system')
    expect(state.showCoords).toBe(true)
    expect(state.soundEnabled).toBe(true)
  })

  it('合法字段照常读回，不做无差别重置', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { theme: 'dark', showCoords: false, soundEnabled: false }, version: 0 }),
    )

    await useSettingsStore.persist.rehydrate()

    const state = useSettingsStore.getState()
    expect(state.theme).toBe('dark')
    expect(state.showCoords).toBe(false)
    expect(state.soundEnabled).toBe(false)
  })

  it('整个 state 不是对象时也回落到默认值，不抛错', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: 'garbage', version: 0 }))

    await expect(useSettingsStore.persist.rehydrate()).resolves.not.toThrow()

    const state = useSettingsStore.getState()
    expect(state.theme).toBe('system')
    expect(state.showCoords).toBe(true)
    expect(state.soundEnabled).toBe(true)
  })
})
