import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Panel } from './Panel'

function bodyOf(container: HTMLElement): HTMLElement {
  const body = container.querySelector('section > div')
  if (body === null) throw new Error('面板没有内容区')
  return body as HTMLElement
}

describe('Panel 的结构', () => {
  it('有标题时渲染成二级标题——它是区块标题，不是页面标题', () => {
    render(
      <Panel title="对局">
        <p>内容</p>
      </Panel>,
    )
    expect(screen.getByRole('heading', { level: 2, name: '对局' })).toBeInTheDocument()
  })

  it('没有标题时不留空标题栏', () => {
    const { container } = render(
      <Panel>
        <p>内容</p>
      </Panel>,
    )
    expect(container.querySelector('header')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })
})

describe('Panel 的内边距档位', () => {
  /*
   * 这一组守的是一个**真实发生过的静默失效**：内边距原先只能靠 `bodyClassName`
   * 传，而 Tailwind 的同名工具类没有优先级——`p-2.5` 排在 `p-3.5` 前面，
   * 于是「棋谱」面板想要的 10px 被面板自带的 14px 盖掉，界面上一直按 14px 渲染。
   * 现在内边距有独立入口，档位之间必须真的不同。
   */
  it('三档渲染出三种不同的内边距', () => {
    const seen = new Set<string>()
    for (const padding of ['normal', 'tight', 'roomy'] as const) {
      const { container, unmount } = render(
        <Panel padding={padding}>
          <p>内容</p>
        </Panel>,
      )
      seen.add(bodyOf(container).className)
      unmount()
    }
    expect(seen.size).toBe(3)
  })

  it('默认档是 normal', () => {
    const { container: withDefault } = render(
      <Panel>
        <p>内容</p>
      </Panel>,
    )
    const { container: explicit } = render(
      <Panel padding="normal">
        <p>内容</p>
      </Panel>,
    )
    expect(bodyOf(withDefault).className).toBe(bodyOf(explicit).className)
  })

  it('排布类仍然生效，且不会被内边距吃掉', () => {
    const { container } = render(
      <Panel bodyClassName="space-y-2 text-center" padding="tight">
        <p>内容</p>
      </Panel>,
    )
    const classes = bodyOf(container).className.split(/\s+/)
    expect(classes).toContain('space-y-2')
    expect(classes).toContain('text-center')
    expect(classes).toContain('p-2')
  })
})
