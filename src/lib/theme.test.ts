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

  it('同步 meta theme-color——否则深色主题下手机地址栏还是浅色（F-UI-17）', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', '#f6f4f0')
    document.head.append(meta)
    const root = document.createElement('div')

    try {
      applyTheme('dark', root)
      expect(meta.getAttribute('content')).toBe('#0f1115')

      applyTheme('light', root)
      expect(meta.getAttribute('content')).toBe('#f6f4f0')
    } finally {
      meta.remove()
    }
  })
})
