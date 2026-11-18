import { createAiEngine, type AiEngine } from './engine'
import type { SearchRequest, SearchResponse } from './types'

/** 车道只需要 Worker 的这两个能力；真正的 `Worker` 天然满足。 */
export interface LaneWorker {
  postMessage(request: SearchRequest): void
  terminate(): void
}

export interface LaneEvents {
  readonly message: (response: SearchResponse) => void
  readonly error: (message: string) => void
}

/** 创建一个 Worker 并把它的两类事件接到 `events` 上。由 `browserEngine.ts` 注入。 */
export type Spawn = (events: LaneEvents) => LaneWorker

interface Lane {
  post(request: SearchRequest): void
  /** 中止那次搜索；不认识的 id 是空操作。 */
  abort(requestId: number): void
  /** 终止 Worker、忘掉在飞的请求（引擎释放时用）。 */
  close(): void
}

interface Sink {
  response(response: SearchResponse): void
  error(message: string, requestIds: readonly number[]): void
  cancel(requestId: number): void
}

/**
 * 落子车道：同一时刻至多一个请求。取消在飞的那个、或新落子到来时上一个还在飞
 * （它必然已经过期），就终止 Worker；下一个请求再新建。
 */
function playLane(spawn: Spawn, sink: Sink): Lane {
  let worker: LaneWorker | null = null
  let inflight: number | null = null

  function drop(): void {
    worker?.terminate()
    worker = null
    inflight = null
  }

  function create(): LaneWorker {
    const created: LaneWorker = spawn({
      message(response) {
        if (created !== worker) return
        if (response.requestId === inflight) inflight = null
        sink.response(response)
      },
      error(message) {
        if (created !== worker) return
        const failed = inflight === null ? [] : [inflight]
        drop()
        sink.error(message, failed)
      },
    })
    return created
  }

  return {
    post(request) {
      const superseded = inflight
      if (superseded !== null) {
        drop()
        sink.cancel(superseded)
      }
      worker ??= create()
      worker.postMessage(request)
      inflight = request.requestId
    },
    abort(requestId) {
      if (requestId === inflight) drop()
    },
    close: drop,
  }
}

/**
 * 只读车道（提示、复盘分析、编辑器分析）：串行，靠 Worker 自己的消息队列排队。
 * 记下已发出、未返回的请求：取消排头的（正在算）→ 终止重建并把其余的重发；
 * 取消排在后面的 → 只从记录里划掉，Worker 照算，它的响应回来时引擎已不认这个 id。
 */
function readLane(spawn: Spawn, sink: Sink): Lane {
  let worker: LaneWorker | null = null
  let sent: SearchRequest[] = []

  function create(): LaneWorker {
    const created: LaneWorker = spawn({
      message(response) {
        if (created !== worker) return
        sent = sent.filter((request) => request.requestId !== response.requestId)
        sink.response(response)
      },
      error(message) {
        if (created !== worker) return
        const failed = sent.map((request) => request.requestId)
        created.terminate()
        worker = null
        sent = []
        sink.error(message, failed)
      },
    })
    return created
  }

  return {
    post(request) {
      worker ??= create()
      worker.postMessage(request)
      sent.push(request)
    },
    abort(requestId) {
      const index = sent.findIndex((request) => request.requestId === requestId)
      if (index === -1) return
      if (index > 0) {
        sent.splice(index, 1)
        return
      }
      const rest = sent.slice(1)
      worker?.terminate()
      worker = null
      sent = []
      if (rest.length === 0) return
      try {
        worker = create()
      } catch (error) {
        sink.error(
          error instanceof Error ? error.message : String(error),
          rest.map((request) => request.requestId),
        )
        return
      }
      for (const request of rest) {
        worker.postMessage(request)
        sent.push(request)
      }
    },
    close() {
      worker?.terminate()
      worker = null
      sent = []
    },
  }
}

/**
 * 两条车道的 AI 引擎：落子一个 Worker，只读请求另一个，互不阻塞；
 * 两个 Worker 都在首次请求时才创建。不碰 `Worker` 全局——`spawn` 由调用方注入，
 * 所以能在 jsdom 里用假 Worker 单测。
 */
export function createLaneEngine(spawn: Spawn): AiEngine {
  const sink: Sink = {
    response: (response) => engine.handleResponse(response),
    error: (message, requestIds) => engine.handleError(message, requestIds),
    cancel: (requestId) => engine.cancel(requestId),
  }
  const play = playLane(spawn, sink)
  const read = readLane(spawn, sink)

  const engine = createAiEngine(
    (request) => (request.purpose === 'play' ? play : read).post(request),
    // 每条车道对不认识的 id 都是空操作，所以不必记请求在哪条车道上。
    (requestId) => {
      play.abort(requestId)
      read.abort(requestId)
    },
  )
  return {
    ...engine,
    dispose() {
      engine.dispose()
      play.close()
      read.close()
    },
  }
}
