import type { SearchRequest, SearchResponse } from './types'

export interface AiEngine {
  /** 派发一次搜索。同一时刻可以有多个请求在飞，按 requestId 区分。 */
  search(request: SearchRequest): Promise<SearchResponse>
  /** 由 Worker 的 message 事件驱动。 */
  handleResponse(response: SearchResponse): void
  /** 由 Worker 的 error 事件驱动。 */
  handleError(message: string): void
  dispose(): void
}

interface Pending {
  readonly resolve: (response: SearchResponse) => void
  readonly reject: (error: Error) => void
}

/**
 * AI 引擎的主线程侧：只负责请求登记与应答分发。
 *
 * Worker 的创建与事件绑定由调用方完成并通过 `post` 注入，因此这里是一个
 * 与浏览器无关的纯状态机，可以脱离 Worker 直接单测。请求与响应用 requestId 配对，
 * 认不出的响应一律丢弃——这正是「取消或过期的请求不能改变棋局」的第一道闸门。
 */
export function createAiEngine(post: (request: SearchRequest) => void): AiEngine {
  const pending = new Map<number, Pending>()
  let disposed = false

  function failAll(error: Error): void {
    const entries = [...pending.values()]
    pending.clear()
    for (const entry of entries) entry.reject(error)
  }

  return {
    search(request) {
      if (disposed) return Promise.reject(new Error('AI 引擎已释放'))

      return new Promise<SearchResponse>((resolve, reject) => {
        pending.set(request.requestId, { resolve, reject })
        try {
          post(request)
        } catch (error) {
          pending.delete(request.requestId)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },

    handleResponse(response) {
      const entry = pending.get(response.requestId)
      if (entry === undefined) return
      pending.delete(response.requestId)
      entry.resolve(response)
    },

    handleError(message) {
      failAll(new Error(message === '' ? 'AI 引擎异常' : message))
    },

    dispose() {
      if (disposed) return
      disposed = true
      failAll(new Error('AI 引擎已释放'))
    },
  }
}
