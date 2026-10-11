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


function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * 内联色的相对亮度。解析不出来就抛——静默跳过等于这条用例在装样子。
 * 两种写法都要认：源码里写的是 `#rrggbb`，jsdom 读回来是 `rgb(r, g, b)`。
 */
function luminance(color: string): number {
  const value = color.trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  const parts =
    hex !== null
      ? [0, 2, 4].map((i) => Number.parseInt(hex[1]!.slice(i, i + 2), 16))
      : rgb !== null
        ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
        : null
  if (parts === null) throw new Error(`读不懂的颜色：${color}`)
  const [r, g, b] = parts.map(channel)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** 兜底界面里所有「写死了底色」的元素。 */
function paintedElements(root: HTMLElement): HTMLElement[] {
  return [root, ...root.querySelectorAll<HTMLElement>('*')].filter(
    (el) => el.style.background !== '' || el.style.backgroundColor !== '',
  )
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

  it('兜底界面自带颜色，不继承主题——深色主题下它曾经是白底浅字', () => {
    // 实测过的翻车方式：`<pre>` 写死浅底、按钮写死白底，却都没写文字色，
    // 于是文字继承 `--c-fg`；深色主题下那是 #ece8e3，压在这两块浅底上
    // 只有 1.11:1 与 1.22:1——错误摘要和「重新加载」四个字都看不见。
    // 触发条件很常见：主题类在 effect 里挂上，挂载之后再崩就还是深色。
    const spy = silenceConsoleError()

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    const painted = paintedElements(alert)
    expect(painted.length).toBeGreaterThan(0)

    for (const element of painted) {
      // 写了底色就必须自己写文字色——不能指望继承
      expect(element.style.color, `${element.tagName} 写了底色却没写文字色`).not.toBe('')
      const ratio = contrast(element.style.color, element.style.background)
      expect(Number(ratio.toFixed(2)), `${element.tagName} 上的对比度`).toBeGreaterThanOrEqual(4.5)
    }

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
