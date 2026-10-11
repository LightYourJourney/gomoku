import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface AppErrorBoundaryProps {
  readonly children: ReactNode
}

interface AppErrorBoundaryState {
  readonly error: Error | null
}

/**
 * 顶层错误边界。
 *
 * 用 class 写是**框架约束不是风格选择**：React 只提供
 * `componentDidCatch` / `getDerivedStateFromError` 这两个 class 生命周期，
 * 函数组件没有等价的钩子。
 *
 * 兜底界面刻意用最简 DOM 加内联样式：不碰 store、不碰主题变量、不碰
 * 自有组件——这一层是最后一道防线，它自己再依赖什么就可能跟着一起坏，
 * 那就真白屏了。
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 离线应用没有上报去处，控制台是唯一能留下现场的地方。
    // componentStack 比 error.stack 有用：它指向出错的那个组件。
    console.error('界面渲染出错：', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      /*
       * 颜色全部写死，一个都不继承。兜底界面可能在任何主题下出现（主题类挂在
       * `documentElement` 上，应用挂载之后再崩就还在），继承来的文字色配上写死的
       * 浅底会变成白底浅字——实测深色主题下是 1.11:1，等于看不见。
       */
      <div
        role="alert"
        style={{
          fontFamily: 'system-ui, sans-serif',
          background: '#ffffff',
          color: '#1c1917',
          minHeight: '100dvh',
          padding: '4rem 1.5rem',
          lineHeight: 1.7,
        }}
      >
        <div style={{ maxWidth: '34rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.75rem' }}>出了点问题</h1>
          <p style={{ margin: '0 0 1rem' }}>
            界面没能画出来。这一局的数据还在本机，重新加载后可以接着下。
          </p>
          <pre
            style={{
              margin: '0 0 1.25rem',
              padding: '0.75rem',
              background: '#f4f4f5',
              color: '#1c1917',
              borderRadius: '0.5rem',
              fontSize: '0.8125rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              border: '1px solid #a1a1aa',
              borderRadius: '0.5rem',
              background: '#f4f4f5',
              color: '#1c1917',
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    )
  }
}
