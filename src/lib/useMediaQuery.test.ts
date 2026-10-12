import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

type Listener = (event: MediaQueryListEvent) => void

/**
 * 装一个**可控**的 `matchMedia`，用完还回去。
 *
 * jsdom 里根本没有这个 API（`typeof window.matchMedia === 'undefined'`），
 * 所以这个桩是从零装的，不是覆盖——卸载时直接删掉属性即可。
 * 仓库对全局桩有纪律：用完必须还，否则同一文件里后面新增的用例会在
 * 「matchMedia 一直存在」的假前提下写。
 */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  let matches = initial

  const list = {
    get matches() {
      return matches
    },
    media: '',
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }

  Object.assign(window, { matchMedia: () => list })

  return {
    /** 模拟视口跨过断点。 */
    change(next: boolean): void {
      matches = next
      act(() => {
        for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
      })
    },
    listening(): number {
      return listeners.size
    },
    restore(): void {
      Reflect.deleteProperty(window, 'matchMedia')
    },
  }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('useMediaQuery', () => {
  it('jsdom 里没有 matchMedia 时返回 false，且不抛错', () => {
    expect(typeof window.matchMedia).toBe('undefined')

    const { result } = renderHook(() => useMediaQuery('(min-width: 1440px)'))

    expect(result.current).toBe(false)
  })

  it('有 matchMedia 时按 matches 给出初值', () => {
    const media = installMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery('(min-width: 1440px)'))

    expect(result.current).toBe(true)

    media.restore()
  })

  /**
   * 这一条是**订阅**与「一次性读」的分界，也是这个 hook 能存在的理由：
   * `ARCHITECTURE.md` 反对用 JS 判媒体查询的第一条理由是「用户中途改系统设置时
   * 分支不会更新」——那说的是不订阅的写法。**拖窗口跨断点时布局必须跟着变**，
   * 所以这里必须验到「变」。
   */
  it('视口跨过断点时跟着更新，不需要重新挂载', () => {
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(min-width: 1440px)'))

    expect(result.current).toBe(false)

    media.change(true)
    expect(result.current).toBe(true)

    media.change(false)
    expect(result.current).toBe(false)

    media.restore()
  })

  it('卸载时退订，不留悬挂的监听', () => {
    const media = installMatchMedia(true)
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1440px)'))

    expect(media.listening()).toBe(1)

    unmount()

    expect(media.listening()).toBe(0)
    media.restore()
  })
})
