import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNavigationStore } from '../../store/navigationStore'
import { useSettingsStore } from '../../store/settingsStore'
import { AppHeader } from './AppHeader'

/** store 是单例，改完要还回去，否则会污染后面的用例。 */
afterEach(() => {
  useNavigationStore.getState().navigate({ page: 'battle' }, { replace: true })
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
    useNavigationStore.getState().navigate({ page: 'puzzles', puzzle: null }, { replace: true })
    render(<AppHeader />)

    const current = navItems().find((item) => item.getAttribute('aria-current') === 'page')
    expect(current).toHaveTextContent('残局')
  })

  it('点一下就切页', async () => {
    const user = userEvent.setup()
    render(<AppHeader />)

    await user.click(screen.getByRole('button', { name: '教学' }))
    expect(useNavigationStore.getState().route.page).toBe('learn')
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

describe('AppHeader —— 偏好写入失败', () => {
  afterEach(() => {
    useSettingsStore.setState({ persistFailed: false })
  })

  it('主题按钮在每一页都能点，写不进存储时它的名字里如实说出来', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    try {
      render(<AppHeader />)
      fireEvent.click(screen.getByRole('button', { name: /^主题：/ }))

      expect(screen.getByRole('button', { name: /^主题：/ })).toHaveAccessibleName(/刷新后会恢复原样/)
    } finally {
      setItem.mockRestore()
    }
  })

  it('没失败时不提', () => {
    render(<AppHeader />)

    expect(screen.getByRole('button', { name: /^主题：/ })).not.toHaveAccessibleName(/刷新后会恢复原样/)
  })

  /*
   * 用户裁定：失败要在**每一页**都看得见。原先只有两处——主题按钮的名字（看不见）
   * 与对战页设置面板「显示与声音」里的一行（默认折叠，也看不见）。
   * 提示条长在顶栏下方：`AppHeader` 是四个页面与分享预览共用的那一份。
   * （SettingsPanel 里那行与它重复，已删；原先那两条断言改到这里。）
   */
  it('写不进存储时顶栏下方出现一行可见提示，用 danger 色', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    try {
      render(<AppHeader />)
      expect(screen.queryByTestId('prefs-save-failed')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /^主题：/ }))

      const bar = screen.getByTestId('prefs-save-failed')
      expect(bar).toHaveTextContent('设置没能保存到浏览器')
      expect(bar).toHaveTextContent('刷新后会恢复原样')
      expect(bar).toHaveClass('text-danger')
      expect(bar).toHaveAttribute('role', 'status')
      // 在顶栏下方，不挤进顶栏那一行
      expect(bar.closest('header')).toBeNull()
    } finally {
      setItem.mockRestore()
    }
  })

  it('写入恢复（persistFailed 变回 false）后提示条消失', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    render(<AppHeader />)
    fireEvent.click(screen.getByRole('button', { name: /^主题：/ }))
    expect(screen.getByTestId('prefs-save-failed')).toBeInTheDocument()

    // 存储恢复：再写一次就成功，store 自己把 persistFailed 清掉
    setItem.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: /^主题：/ }))

    expect(useSettingsStore.getState().persistFailed).toBe(false)
    expect(screen.queryByTestId('prefs-save-failed')).toBeNull()
    expect(screen.queryByText(/设置没能保存到浏览器/)).toBeNull()
  })

  it('分享预览这类不带导航的页面也有提示条', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    try {
      render(<AppHeader showNav={false} />)
      fireEvent.click(screen.getByRole('button', { name: /^主题：/ }))

      expect(screen.getByTestId('prefs-save-failed')).toBeVisible()
    } finally {
      setItem.mockRestore()
    }
  })
})
