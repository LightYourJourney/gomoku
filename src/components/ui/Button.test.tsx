import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, type ButtonVariant } from './Button'

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']

function classesOf(element: HTMLElement): string[] {
  return element.className.split(/\s+/)
}

describe('Button 的等级', () => {
  it('四个等级各自不同——相邻等级必须能分辨', () => {
    const seen = new Map<string, ButtonVariant>()
    for (const variant of VARIANTS) {
      const { unmount } = render(<Button variant={variant}>操作</Button>)
      const classes = classesOf(screen.getByRole('button'))
      unmount()

      const signature = classes.join(' ')
      for (const [previous, previousVariant] of seen) {
        expect(
          signature,
          `${variant} 与 ${previousVariant} 渲染出的类名完全一样，等于没有等级区分`,
        ).not.toBe(previous)
      }
      seen.set(signature, variant)
    }
  })

  it('`default` 是 `secondary` 的别名——老调用方零改动', () => {
    const { unmount } = render(<Button variant="default">操作</Button>)
    const legacy = classesOf(screen.getByRole('button')).join(' ')
    unmount()

    render(<Button variant="secondary">操作</Button>)
    expect(classesOf(screen.getByRole('button')).join(' ')).toBe(legacy)
  })
})

describe('Button 的触控面积', () => {
  /*
   * WCAG 2.5.8 的下限是 24×24；按钮够不够大不能靠眼睛看，
   * 靠类名把下限钉住——尺寸类一旦被改掉，这条会红。
   */
  it('默认尺寸至少 36px 高', () => {
    render(<Button>操作</Button>)
    expect(classesOf(screen.getByRole('button'))).toContain('min-h-9')
  })

  it('小尺寸也不低于 24px（WCAG 2.5.8 的下限）', () => {
    render(<Button size="sm">重试</Button>)
    expect(classesOf(screen.getByRole('button'))).toContain('min-h-6')
  })
})

describe('Button 的状态', () => {
  it('禁用时不触发回调', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        操作
      </Button>,
    )

    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('按下态由 active: 类承担——没有它，点下的一瞬间没有任何反馈', () => {
    render(<Button>操作</Button>)
    const classes = classesOf(screen.getByRole('button'))
    expect(classes.some((item) => item.startsWith('active:'))).toBe(true)
  })

  it('block 时铺满整行', () => {
    render(<Button block>操作</Button>)
    expect(classesOf(screen.getByRole('button'))).toContain('w-full')
  })
})

describe('Button 的 API 契约', () => {
  it('ref 落到真实的 button 上（React 19 里 ref 是普通 prop）', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>操作</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('默认 type="button"，不会在表单里意外提交', () => {
    render(<Button>操作</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('透传其他原生属性与事件', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button data-testid="probe" onClick={onClick}>
        操作
      </Button>,
    )

    await user.click(screen.getByTestId('probe'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
