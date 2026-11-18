import type { SearchRequest, SearchResponse } from './types'

export interface AiEngine {
  /** 派发一次搜索。同一时刻可以有多个请求在飞，按 requestId 区分。 */
  search(request: SearchRequest): Promise<SearchResponse>
  /** 由 Worker 的 message 事件驱动。 */
  handleResponse(response: SearchResponse): void
  /**
   * 由 Worker 的 error 事件驱动。`requestIds` 给出时只让这些请求失败（出错的那个 Worker 上的），
   * 不给时让所有待决请求失败。
   */
  handleError(message: string, requestIds?: readonly number[]): void
  /**
   * 放弃一个请求：以 `reason`（缺省为 `SearchCancelledError`）拒绝它，并通知传输层
   * 中止那次搜索。对已结算、不认识的 id，或引擎已释放时，是空操作。
   */
  cancel(requestId: number, reason?: Error): void
  dispose(): void
}

/** 请求被调用方主动放弃。store 的闸门在它之前就已经不认这个请求了，不应当作错误展示。 */
export class SearchCancelledError extends Error {
  constructor() {
    super('搜索已取消')
    this.name = 'SearchCancelledError'
  }
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
 * `abort` 同样由调用方注入：取消一个请求时通知传输层中止那次搜索（例如终止 Worker）。
 */
export function createAiEngine(
  post: (request: SearchRequest) => void,
  abort: (requestId: number) => void = () => {},
): AiEngine {
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

    handleError(message, requestIds) {
      const error = new Error(message === '' ? 'AI 引擎异常' : message)
      if (requestIds === undefined) {
        failAll(error)
        return
      }
      for (const id of requestIds) {
        const entry = pending.get(id)
        if (entry === undefined) continue
        pending.delete(id)
        entry.reject(error)
      }
    },

    cancel(requestId, reason = new SearchCancelledError()) {
      const entry = pending.get(requestId)
      if (entry === undefined) return
      pending.delete(requestId)
      entry.reject(reason)
      abort(requestId)
    },

    dispose() {
      if (disposed) return
      disposed = true
      failAll(new Error('AI 引擎已释放'))
    },
  }
}
