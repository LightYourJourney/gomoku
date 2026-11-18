import type { AiEngine } from '../ai/engine'
import type { SearchRequest, SearchResponse } from '../ai/types'

/**
 * 等 AI 响应的硬上限。
 *
 * 不是搜索预算：搜索自己会在 2600ms 内收手。这一条只防「Worker 静默死亡后
 * 永不结算」——预算的 5 倍以上，正常机器不可能触发。
 */
export const AI_RESPONSE_TIMEOUT_MS = 15_000

export const TIMEOUT_MESSAGE = `AI 超过 ${AI_RESPONSE_TIMEOUT_MS / 1000} 秒没有响应，请重试`

/**
 * 带超时兜底的搜索：到时以超时错误取消那个请求（Worker 不再白算），
 * 调用方的拒绝分支收到的是超时文案，不是「已取消」——它此刻仍认这个请求。
 *
 * 返回的就是 `engine.search` 的那个 Promise，不再包一层：调用方的回调时序与
 * 直接调 `search` 完全一样。
 */
export function withDeadline(engine: AiEngine, request: SearchRequest): Promise<SearchResponse> {
  const searching = engine.search(request)
  const timer = setTimeout(() => {
    engine.cancel(request.requestId, new Error(TIMEOUT_MESSAGE))
  }, AI_RESPONSE_TIMEOUT_MS)
  const clear = () => clearTimeout(timer)
  searching.then(clear, clear)
  return searching
}
