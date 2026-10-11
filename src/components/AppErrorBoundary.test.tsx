import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

function Boom(): never {
  throw new Error('渲染炸了')
}

/** React 会把捕获到的错误打到 console.error；测试里不需要这行噪音。 */
function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('AppErrorBoundary', () => {
  it('子组件抛错时显示兜底 UI，而不是白屏', () => {
    const spy = silenceConsoleError()

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('出了点问题')
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
    spy.mockRestore()
  })

  it('兜底界面把错误摘要说出来——只写「出错了」等于没说', () => {
    const spy = silenceConsoleError()

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('渲染炸了')
    spy.mockRestore()
  })

  it('正常渲染时原样透传子树', () => {
    render(
      <AppErrorBoundary>
        <p>内容</p>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('内容')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('点「重新加载」会重新加载页面', () => {
    // jsdom 里 location.reload 是不可实现的，桩掉它只是为了盯住「点了会发生什么」。
    const spy = silenceConsoleError()
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    })

    try {
      render(
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>,
      )
      screen.getByRole('button', { name: '重新加载' }).click()

      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
      spy.mockRestore()
    }
  })
})
