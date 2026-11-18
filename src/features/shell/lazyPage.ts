import { createElement, lazy, useState, type ComponentType, type ReactNode } from 'react'

/** 一个页面的分块没能载入（断网、发布后旧页面请求的旧块已不存在）。 */
export class PageLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'PageLoadError'
  }
}

export interface LazyPage<P extends object> {
  (props: P): ReactNode
  /** 提前下载这一页的分块。失败以 `PageLoadError` 拒绝；同一页只下一次。 */
  preload(): Promise<unknown>
}

/**
 * 按需加载的页面。载入失败一律换成 `PageLoadError`，好让 `PageBoundary` 分清
 * 「分块没下来」（它管）与「页面自己渲染出错」（交给外层的 `AppErrorBoundary`）。
 *
 * **先下好再挂载**：分块没到时 lazy 会挂起、亮 `Suspense` 的占位，而 React 揭开占位有约
 * 300 ms 的节流——实测冷启动直达复盘页从改造前的 17–20 ms 变成 307 ms（`yarn bench:navigation`，
 * 生产构建）。所以启动时先下好地址要去的那一页、其余几页随后在后台下（`pages.ts`），
 * 实测回到 8–22 ms。分块已经到了就直接渲染、不经 lazy，连那一次挂起的可能都免掉。
 * 是否已到在**挂载时**定一次：同一次挂载里从 lazy 换成直接渲染会让页面重挂、丢状态。
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): LazyPage<P> {
  let loaded: ComponentType<P> | null = null
  let loading: Promise<ComponentType<P>> | null = null

  const preload = (): Promise<ComponentType<P>> => {
    loading ??= load().then(
      (component) => {
        loaded = component
        return component
      },
      (error: unknown) => {
        throw new PageLoadError(error)
      },
    )
    return loading
  }

  const Lazy = lazy(async () => ({ default: await preload() }))

  function Page(props: P): ReactNode {
    const [direct] = useState(() => loaded)
    return createElement((direct ?? Lazy) as ComponentType<P>, props)
  }
  Page.preload = preload
  return Page
}
