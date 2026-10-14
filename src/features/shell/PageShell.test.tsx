import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageShell } from './PageShell'

/**
 * `PageShell` 是六个页面位置共用的外壳，它的契约只有三条，
 * 但每一条坏了都会以「某个页面莫名其妙不对」的形式出现，所以逐条钉住。
 */
describe('PageShell 的结构契约', () => {
  it('每页恰好一个 main —— 多一个会让所有 getByRole("main") 的用例抛 strict violation', () => {
    render(
      <PageShell>
        <p>正文</p>
      </PageShell>,
    )
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('顶栏在滚动容器**外面** —— 这是「滚动时导航还在」的唯一保证', () => {
    const { container } = render(
      <PageShell>
        <p>正文</p>
      </PageShell>,
    )

    const header = container.querySelector('header')
    const main = screen.getByRole('main')
    expect(header).not.toBeNull()
    expect(header!.contains(main)).toBe(false)
    expect(main.contains(header)).toBe(false)
  })

  it('正文自己滚，不是外层滚动 —— 否则列表页一滚顶栏就没了', () => {
    render(
      <PageShell>
        <p>正文</p>
      </PageShell>,
    )
    expect(screen.getByRole('main').className).toContain('overflow-y-auto')
  })

  it('阅读型正文居中限宽', () => {
    const { container } = render(
      <PageShell>
        <p>正文</p>
      </PageShell>,
    )
    const column = container.querySelector('main > div')
    expect(column!.className).toContain('max-w-3xl')
    expect(column!.className).toContain('mx-auto')
  })
})

describe('PageShell 的棋盘型正文', () => {
  /*
   * 这里守的是 F-UI-01 那个 P0 的**反面**：详情页的正文在 lg 下要变成两栏，
   * 但**绝不能带 `grid-rows`**——带上的话棋盘会落进 `auto` 行，
   * 行高由侧栏内容决定，1440 下棋盘只有 169px。
   */
  /**
   * 两栏的条件是 `wide-layout:`，**不再是 `lg:`**（Phase 05 改的）。
   *
   * `wide-layout` 是 `index.css` 里的自定义变体：`≥1024`，**或者**
   * `≥768 且横屏且高度 ≥500`——平板横屏本来就该是两栏，而横屏手机
   * （915×412）被高度那条挡在外面（那时棋盘会被压到 320px 底线以下）。
   *
   * 这里只能断类名：jsdom 不做媒体查询，**真正的行为在
   * `e2e/layout.spec.ts`**（三条：横屏小平板两栏、横屏手机不两栏、竖屏不两栏）。
   * 这条用例守的是「别把变体名写错了」——写错的话那三条 e2e 也会红，
   * 但它们跑得慢，这条在单元层就先喊。
   */
  it('两栏栅格挂在 wide-layout 变体上', () => {
    render(
      <PageShell variant="flush">
        <section>棋盘</section>
      </PageShell>,
    )
    const classes = screen.getByRole('main').className
    expect(classes).toContain('wide-layout:grid')
    expect(classes).toContain('wide-layout:grid-cols-[minmax(0,1fr)_344px]')
    expect(classes).not.toContain('lg:grid')
  })

  it('绝不声明 grid-rows —— 那正是棋盘塌陷的成因', () => {
    render(
      <PageShell variant="flush">
        <section>棋盘</section>
      </PageShell>,
    )
    expect(screen.getByRole('main').className).not.toContain('grid-rows')
  })
})

describe('PageShell 的两个插槽', () => {
  it('工具栏排在顶栏之后、正文之前', () => {
    const { container } = render(
      <PageShell toolbar={<div data-testid="toolbar">工具栏</div>} variant="flush">
        <p>正文</p>
      </PageShell>,
    )

    const order = [...container.querySelectorAll('header, [data-testid="toolbar"], main')]
    expect(order.map((element) => element.tagName.toLowerCase())).toEqual([
      'header',
      'div',
      'main',
    ])
    expect(order[0]!.contains(order[1]!)).toBe(false)
  })

  it('footer 排在正文之后，且不在 main 里（否则会被卷进栅格）', () => {
    const { container } = render(
      <PageShell footer={<p data-testid="footer">页脚</p>} variant="flush">
        <p>正文</p>
      </PageShell>,
    )

    const root = container.firstElementChild!
    expect(screen.getByRole('main').contains(screen.getByTestId('footer'))).toBe(false)
    expect(root.lastElementChild).toBe(screen.getByTestId('footer'))
  })

  it('不传插槽时不留空节点', () => {
    const { container } = render(
      <PageShell>
        <p>正文</p>
      </PageShell>,
    )
    expect(container.firstElementChild!.children).toHaveLength(2) // header + main
  })
})
