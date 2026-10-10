import { createAiEngine, type AiEngine } from './engine'

/**
 * 在浏览器里创建真正跑在 Worker 上的 AI 引擎。
 *
 * Vite 会识别 `new Worker(new URL(...), { type: 'module' })` 这个写法，
 * 把 worker.ts 单独打包成一个 chunk。
 */
export function createBrowserAiEngine(): AiEngine {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  const engine = createAiEngine((request) => {
    worker.postMessage(request)
  })

  worker.addEventListener('message', (event: MessageEvent<Parameters<AiEngine['handleResponse']>[0]>) => {
    engine.handleResponse(event.data)
  })

  worker.addEventListener('error', (event) => {
    engine.handleError(event.message)
  })

  return engine
}
