import { createLaneEngine, type LaneEngine, type Spawn } from './lanes'
import type { SearchResponse } from './types'

/**
 * 在浏览器里创建真正跑在 Worker 上的 AI 引擎：落子与只读请求各一个 Worker，
 * 首次请求时才创建（车道逻辑见 `lanes.ts`）。这里只负责新建 Worker 与接事件。
 *
 * Vite 会识别 `new Worker(new URL(...), { type: 'module' })` 这个写法，
 * 把 worker.ts 单独打包成一个 chunk。
 */
const spawn: Spawn = (events) => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<SearchResponse>) => {
    events.message(event.data)
  })
  worker.addEventListener('error', (event) => {
    events.error(event.message)
  })
  return worker
}

export function createBrowserAiEngine(): LaneEngine {
  return createLaneEngine(spawn)
}
