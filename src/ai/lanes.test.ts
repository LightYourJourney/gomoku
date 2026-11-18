import { describe, expect, it } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK } from '../core/types'
import { SearchCancelledError } from './engine'
import { createLaneEngine, type LaneEvents, type Spawn } from './lanes'
import type { RequestPurpose, SearchRequest, SearchResponse } from './types'

class FakeWorker {
  readonly received: SearchRequest[] = []
  terminated = false

  private readonly events: LaneEvents

  constructor(events: LaneEvents) {
    this.events = events
  }

  postMessage(request: SearchRequest): void {
    if (this.terminated) throw new Error('已终止的 Worker 不该再收到请求')
    this.received.push(request)
  }

  terminate(): void {
    this.terminated = true
  }

  /** 应答收到的第 `index` 个请求。 */
  reply(index = 0): void {
    const request = this.received[index]
    if (request === undefined) throw new Error(`这个 Worker 没有第 ${index} 个请求`)
    this.events.message(response(request.requestId))
  }

  fail(message: string): void {
    this.events.error(message)
  }
}

function harness(options: { failSpawnAt?: number } = {}) {
  const workers: FakeWorker[] = []
  const spawn: Spawn = (events) => {
    if (options.failSpawnAt === workers.length) {
      options.failSpawnAt = undefined
      workers.push(null as unknown as FakeWorker)
      throw new Error('Worker 脚本加载失败')
    }
    const worker = new FakeWorker(events)
    workers.push(worker)
    return worker
  }
  return { engine: createLaneEngine(spawn), workers }
}

let nextId = 1
function request(purpose: RequestPurpose): SearchRequest {
  return {
    requestId: nextId++,
    gameVersion: 0,
    board: createBoard(),
    player: BLACK,
    difficulty: 'easy',
    purpose,
  }
}

function response(requestId: number): SearchResponse {
  return {
    requestId,
    gameVersion: 0,
    move: { x: 7, y: 7 },
    score: 0,
    depth: 1,
    nodes: 1,
    elapsedMs: 1,
    confidence: 'complete',
    reason: 'search',
    candidates: [],
    urgency: 'normal',
  }
}

/** 记下一个 Promise 的结局，不让被拒绝的 Promise 变成未处理的拒绝。 */
function track(promise: Promise<SearchResponse>) {
  const outcome: { value?: SearchResponse; error?: unknown; settled: boolean } = { settled: false }
  promise.then(
    (value) => Object.assign(outcome, { value, settled: true }),
    (error: unknown) => Object.assign(outcome, { error, settled: true }),
  )
  return outcome
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLaneEngine —— 按需创建', () => {
  it('建好引擎不创建任何 Worker', () => {
    const { workers } = harness()

    expect(workers).toHaveLength(0)
  })

  it('只发落子请求时只创建一个 Worker', async () => {
    const { engine, workers } = harness()

    for (let i = 0; i < 3; i++) {
      const pending = engine.search(request('play'))
      workers[0]!.reply(i)
      await pending
    }

    expect(workers).toHaveLength(1)
  })

  it('求提示时另建一个 Worker，落子与提示各走各的', async () => {
    const { engine, workers } = harness()
    const play = engine.search(request('play'))
    const hint = engine.search(request('hint'))

    expect(workers).toHaveLength(2)
    expect(workers[0]!.received.map((r) => r.purpose)).toEqual(['play'])
    expect(workers[1]!.received.map((r) => r.purpose)).toEqual(['hint'])

    workers[0]!.reply()
    workers[1]!.reply()
    await expect(play).resolves.toBeDefined()
    await expect(hint).resolves.toBeDefined()
  })

  it('复盘分析与编辑器分析走只读车道，与提示共用一个 Worker', () => {
    const { engine, workers } = harness()

    void engine.search(request('analyze'))
    void engine.search(request('hint'))

    expect(workers).toHaveLength(1)
    expect(workers[0]!.received).toHaveLength(2)
  })
})

describe('createLaneEngine —— 落子车道', () => {
  it('上一个落子还在飞时来了新落子：终止旧 Worker、以取消结算旧请求、在新 Worker 上发新请求', async () => {
    const { engine, workers } = harness()
    const first = track(engine.search(request('play')))
    const second = engine.search(request('play'))
    await flush()

    expect(workers).toHaveLength(2)
    expect(workers[0]!.terminated).toBe(true)
    expect(first.error).toBeInstanceOf(SearchCancelledError)

    workers[1]!.reply()
    await expect(second).resolves.toBeDefined()
  })

  it('上一个落子已返回，新落子复用同一个 Worker', async () => {
    const { engine, workers } = harness()
    const first = engine.search(request('play'))
    workers[0]!.reply()
    await first

    void engine.search(request('play'))

    expect(workers).toHaveLength(1)
    expect(workers[0]!.terminated).toBe(false)
  })

  it('取消在飞的落子会终止 Worker，下一次落子新建', () => {
    const { engine, workers } = harness()
    const id = request('play')
    void engine.search(id).catch(() => {})

    engine.cancel(id.requestId)
    expect(workers[0]!.terminated).toBe(true)

    void engine.search(request('play'))
    expect(workers).toHaveLength(2)
  })

  it('取消落子不影响只读车道', () => {
    const { engine, workers } = harness()
    const play = request('play')
    void engine.search(play).catch(() => {})
    void engine.search(request('hint'))

    engine.cancel(play.requestId)

    expect(workers[1]!.terminated).toBe(false)
  })

  it('落子 Worker 出错只让落子请求失败，只读车道上的请求不受影响', async () => {
    const { engine, workers } = harness()
    const play = track(engine.search(request('play')))
    const hint = engine.search(request('hint'))

    workers[0]!.fail('落子 Worker 崩溃')
    await flush()

    expect(play.error).toBeInstanceOf(Error)
    expect((play.error as Error).message).toBe('落子 Worker 崩溃')
    workers[1]!.reply()
    await expect(hint).resolves.toBeDefined()
  })

  it('Worker 新建失败时那条请求以错误结算，下一次请求会再试', async () => {
    const { engine, workers } = harness({ failSpawnAt: 0 })

    await expect(engine.search(request('play'))).rejects.toThrow('Worker 脚本加载失败')

    const retry = engine.search(request('play'))
    workers[1]!.reply()
    await expect(retry).resolves.toBeDefined()
  })

  it('出错之后下一次落子新建 Worker', async () => {
    const { engine, workers } = harness()
    void engine.search(request('play')).catch(() => {})
    workers[0]!.fail('崩溃')

    const retry = engine.search(request('play'))
    expect(workers).toHaveLength(2)
    workers[1]!.reply()
    await expect(retry).resolves.toBeDefined()
  })
})

describe('createLaneEngine —— 只读车道', () => {
  it('取消正在算的那个：终止重建，把排在后面的重发给新 Worker', async () => {
    const { engine, workers } = harness()
    const head = request('analyze')
    void engine.search(head).catch(() => {})
    const rest = [request('analyze'), request('hint')]
    const pending = rest.map((r) => engine.search(r))

    engine.cancel(head.requestId)

    expect(workers[0]!.terminated).toBe(true)
    expect(workers[1]!.received.map((r) => r.requestId)).toEqual(rest.map((r) => r.requestId))
    workers[1]!.reply(0)
    workers[1]!.reply(1)
    await expect(Promise.all(pending)).resolves.toHaveLength(2)
  })

  it('取消排在后面的：不终止 Worker，那条的响应回来时被丢弃', async () => {
    const { engine, workers } = harness()
    const head = engine.search(request('analyze'))
    const queued = request('hint')
    const dropped = track(engine.search(queued))

    engine.cancel(queued.requestId)
    workers[0]!.reply(0)
    workers[0]!.reply(1)
    await flush()

    expect(workers[0]!.terminated).toBe(false)
    await expect(head).resolves.toBeDefined()
    expect(dropped.error).toBeInstanceOf(SearchCancelledError)
  })

  it('取消唯一在飞的那个后不急着新建 Worker，下一次请求才建', () => {
    const { engine, workers } = harness()
    const only = request('hint')
    void engine.search(only).catch(() => {})

    engine.cancel(only.requestId)
    expect(workers).toHaveLength(1)

    void engine.search(request('hint'))
    expect(workers).toHaveLength(2)
  })

  it('重建时新建失败：重发的那些请求以错误结算', async () => {
    const { engine } = harness({ failSpawnAt: 1 })
    const head = request('analyze')
    void engine.search(head).catch(() => {})
    const rest = track(engine.search(request('analyze')))

    engine.cancel(head.requestId)
    await flush()

    expect((rest.error as Error).message).toBe('Worker 脚本加载失败')
  })

  it('已终止的旧 Worker 迟到的事件被忽略', async () => {
    const { engine, workers } = harness()
    const head = request('analyze')
    void engine.search(head).catch(() => {})
    const next = track(engine.search(request('analyze')))
    engine.cancel(head.requestId)

    workers[0]!.fail('旧 Worker 的错误')
    await flush()

    expect(next.settled).toBe(false)
  })

  it('只读 Worker 出错让它上面的请求都失败，不碰落子车道', async () => {
    const { engine, workers } = harness()
    const play = engine.search(request('play'))
    const first = track(engine.search(request('analyze')))
    const second = track(engine.search(request('hint')))

    workers[1]!.fail('只读 Worker 崩溃')
    await flush()

    expect((first.error as Error).message).toBe('只读 Worker 崩溃')
    expect((second.error as Error).message).toBe('只读 Worker 崩溃')
    workers[0]!.reply()
    await expect(play).resolves.toBeDefined()
  })
})

describe('createLaneEngine —— 释放', () => {
  it('dispose 终止两个 Worker，挂起的请求以错误结算', async () => {
    const { engine, workers } = harness()
    const play = track(engine.search(request('play')))
    const hint = track(engine.search(request('hint')))

    engine.dispose()
    await flush()

    expect(workers.map((worker) => worker.terminated)).toEqual([true, true])
    expect(play.error).toBeInstanceOf(Error)
    expect(hint.error).toBeInstanceOf(Error)
  })
})

describe('createLaneEngine —— 预热', () => {
  it('warmUp 提前建好落子 Worker，第一手不再等 Worker 启动；只建一次，不碰只读车道', () => {
    const { engine, workers } = harness()

    engine.warmUp()
    engine.warmUp()
    expect(workers).toHaveLength(1)

    void engine.search(request('play'))
    expect(workers).toHaveLength(1)
    expect(workers[0]!.received.map((r) => r.purpose)).toEqual(['play'])
  })
})

