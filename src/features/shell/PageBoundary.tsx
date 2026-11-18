import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { PageLoadError } from './lazyPage'
import { PageShell } from './PageShell'

/** 分块还在路上：与页面同一个外壳（顶栏、`main`），只放一行状态。 */
export function PageLoading({ showNav = true }: { readonly showNav?: boolean }) {
  return (
    <PageShell showNav={showNav}>
      <p role="status" className="text-sm text-muted">
        正在载入…
      </p>
    </PageShell>
  )
}

interface PageBoundaryState {
  readonly error: unknown
}

/**
 * 页面一级的错误边界，只接分块载入失败。放在页面这一层、并由调用方以页面为 `key`：
 * 顶栏还在，换一页就重置，不会像根部的边界那样整屏失效。
 * 刷新是唯一可靠的恢复——`React.lazy` 会缓存失败的那次载入。
 */
export class PageBoundary extends Component<
  { readonly children: ReactNode; readonly showNav?: boolean },
  PageBoundaryState
> {
  override state: PageBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): PageBoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (error instanceof PageLoadError) console.error('页面分块没能载入：', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    // 不是载入失败：原样抛给外层的错误边界。
    if (!(error instanceof PageLoadError)) throw error

    return (
      <PageShell showNav={this.props.showNav ?? true}>
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold text-fg">页面没能载入</h1>
          <p className="text-sm text-muted">
            可能是网络断了，或者应用刚刚更新过。对局与进度都还在本机，刷新一下就好。
          </p>
          <Button onClick={() => window.location.reload()}>刷新重试</Button>
        </div>
      </PageShell>
    )
  }
}
