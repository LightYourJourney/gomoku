import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { useLearnStore } from '../../store/learnStore'
import { AppHeader } from './AppHeader'

/** store 是单例，改完要还回去，否则会污染后面的用例。 */
afterEach(() => {
  useLearnStore.setState({ view: 'battle' })
})

function navItems(): HTMLElement[] {
  return screen.getAllByRole('button').filter((item) => item.closest('nav') !== null)
}

describe('AppHeader 的品牌', () => {
  it('名称与副标题都在', () => {
    render(<AppHeader />)
    expect(screen.getByText('Gomoku Lab')).toBeInTheDocument()
    expect(screen.getByText('五子棋实验室')).toBeInTheDocument()
  })

  it('品牌标记是内联 SVG，不依赖外部图片或网络资源', () => {
    const { container } = render(<AppHeader />)
    expect(container.querySelector('header svg')).not.toBeNull()
    expect(container.querySelector('header img')).toBeNull()
  })
})

describe('AppHeader 的导航', () => {
  it('四个页面各一项，且只有一个标着 aria-current', () => {
    render(<AppHeader />)

    const current = navItems().filter((item) => item.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('对战')
    expect(navItems().map((item) => item.textContent)).toEqual(['对战', '教学', '残局', '复盘'])
  })

  it('aria-current 跟着当前页面走', () => {
    useLearnStore.setState({ view: 'puzzles' })
    render(<AppHeader />)

    const current = navItems().find((item) => item.getAttribute('aria-current') === 'page')
    expect(current).toHaveTextContent('残局')
  })

  it('点一下就切页', async () => {
    const user = userEvent.setup()
    render(<AppHeader />)

    await user.click(screen.getByRole('button', { name: '教学' }))
    expect(useLearnStore.getState().view).toBe('learn')
  })

  it('导航项有足够的命中高度（不低于 32px）', () => {
    render(<AppHeader />)
    for (const item of navItems()) {
      expect(item.className, `${item.textContent} 太矮了`).toContain('min-h-8')
    }
  })

  it('窄屏下导航铺满整行 —— 只给 w-full 而不铺满时右边会空出一大片', () => {
    render(<AppHeader />)
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(nav.className).toContain('grid-cols-4')
  })
})

describe('AppHeader 不抢导航空间', () => {
  it('右侧附加内容（状态条）与主题按钮同组，且不会被压缩', () => {
    const { container } = render(
      <AppHeader>
        <span data-testid="status">轮到你落子</span>
      </AppHeader>,
    )

    expect(screen.getByTestId('status')).toBeInTheDocument()
    // 主题按钮始终在
    expect(screen.getByRole('button', { name: /^主题：/ })).toBeInTheDocument()
    // 右侧那一组不许被 flex 压扁
    expect(container.querySelector('header > div:last-child')!.className).toContain('shrink-0')
  })
})
