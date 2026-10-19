import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFlushOnHide } from './useFlushOnHide'

const hidden = (value: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  })
}

afterEach(() => {
  // 还原成 jsdom 的默认值，避免污染同一文件里的其他用例
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
})

describe('useFlushOnHide', () => {
  it('页面进入后台时冲一次写', () => {
    const flush = vi.fn(async () => {})
    renderHook(() => useFlushOnHide(flush))

    hidden('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('页面仍然可见时不动', () => {
    const flush = vi.fn(async () => {})
    renderHook(() => useFlushOnHide(flush))

    hidden('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(flush).not.toHaveBeenCalled()
  })

  it('pagehide 也冲一次（b fcache / 关闭标签页都会经过它）', () => {
    const flush = vi.fn(async () => {})
    renderHook(() => useFlushOnHide(flush))

    window.dispatchEvent(new Event('pagehide'))

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('卸载之后不再响应', () => {
    const flush = vi.fn(async () => {})
    const { unmount } = renderHook(() => useFlushOnHide(flush))

    unmount()
    window.dispatchEvent(new Event('pagehide'))
    hidden('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(flush).not.toHaveBeenCalled()
  })
})
