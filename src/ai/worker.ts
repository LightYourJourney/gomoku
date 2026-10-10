import { chooseMove } from './search'
import type { SearchRequest, SearchResponse } from './types'

/**
 * Worker 全局作用域。
 *
 * 工程的 tsconfig 装的是 DOM lib，`self` 会被当成 Window；这里只把真正用到的
 * 两个成员显式声明出来，避免为了一个文件引入整套 WebWorker lib 与 DOM lib 打架。
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null
  postMessage: (message: SearchResponse) => void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  // chooseMove 是同步纯函数：不碰 DOM，也不改传进来的棋盘（内部先复制一份），
  // 在 Worker 里跑，绝不阻塞主线程。
  scope.postMessage(chooseMove(event.data))
}
