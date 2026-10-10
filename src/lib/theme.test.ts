import { describe, expect, it } from 'vitest'
import { applyTheme, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('跟随系统时取决于系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('显式指定时忽略系统偏好', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('applyTheme', () => {
  it('深色主题给根元素加上 dark 类', () => {
    const root = document.createElement('div')

    applyTheme('dark', root)

    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
  })

  it('切回浅色会摘掉 dark 类', () => {
    const root = document.createElement('div')
    applyTheme('dark', root)

    applyTheme('light', root)

    expect(root.classList.contains('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })
})
