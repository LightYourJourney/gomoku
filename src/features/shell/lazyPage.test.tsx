import { render, screen } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { lazyPage } from './lazyPage'
import { PageBoundary } from './PageBoundary'

class Outer extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  override render() {
    return this.state.error === null ? this.props.children : <p>外层接住了</p>
  }
}

describe('按页加载', () => {
  it('分块载入成功：渲染那一页', async () => {
    const Page = lazyPage(() => Promise.resolve(() => <h1>复盘</h1>))

    render(
      <PageBoundary>
        <Page />
      </PageBoundary>,
    )

    expect(await screen.findByRole('heading', { name: '复盘' })).toBeInTheDocument()
  })

  it('分块载入失败（断网、发布后旧块已不存在）：给出刷新提示，而不是整屏白掉', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Page = lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))

    render(
      <Outer>
        <PageBoundary>
          <Page />
        </PageBoundary>
      </Outer>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('页面没能载入')
    expect(screen.getByRole('button', { name: '刷新重试' })).toBeInTheDocument()
    expect(screen.queryByText('外层接住了')).not.toBeInTheDocument()
  })

  it('页面自己渲染出错不归它管：交给外层的错误边界', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = (): ReactNode => {
      throw new Error('渲染坏了')
    }
    const Page = lazyPage(() => Promise.resolve(Broken))

    render(
      <Outer>
        <PageBoundary>
          <Page />
        </PageBoundary>
      </Outer>,
    )

    expect(await screen.findByText('外层接住了')).toBeInTheDocument()
  })
})
