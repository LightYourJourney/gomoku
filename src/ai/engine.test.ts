import { describe, expect, it, vi } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK, type Point } from '../core/types'
import { createAiEngine, SearchCancelledError } from './engine'
import type { SearchRequest, SearchResponse } from './types'

function request(requestId: number, gameVersion = 0): SearchRequest {
  return {
    requestId,
    gameVersion,
    board: createBoard(),
    player: BLACK,
    difficulty: 'easy',
    purpose: 'play',
  }
}

function response(requestId: number, move: Point | null = { x: 7, y: 7 }): SearchResponse {
  return {
    requestId,
    gameVersion: 0,
    move,
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

describe('createAiEngine', () => {
  it('search 把请求发给 Worker', () => {
    const post = vi.fn()
    const engine = createAiEngine(post)

    void engine.search(request(1))

    expect(post).toHaveBeenCalledWith(request(1))
  })

  it('收到同 requestId 的响应时兑现对应的 promise', async () => {
    const engine = createAiEngine(() => {})
    const pending = engine.search(request(7))

    engine.handleResponse(response(7, { x: 3, y: 4 }))

    await expect(pending).resolves.toMatchObject({ requestId: 7, move: { x: 3, y: 4 } })
  })

  it('requestId 对不上的响应被忽略，不会误兑现其他请求', async () => {
    const engine = createAiEngine(() => {})
    const first = engine.search(request(1))
    const second = engine.search(request(2))

    engine.handleResponse(response(2, { x: 9, y: 9 }))

    await expect(second).resolves.toMatchObject({ requestId: 2 })

    let settled = false
    void first.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    engine.handleResponse(response(1))
    await expect(first).resolves.toMatchObject({ requestId: 1 })
  })

  it('重复的响应不会让同一个请求兑现两次', async () => {
    const engine = createAiEngine(() => {})
    const pending = engine.search(request(1))

    engine.handleResponse(response(1, { x: 1, y: 1 }))
    engine.handleResponse(response(1, { x: 2, y: 2 }))

    await expect(pending).resolves.toMatchObject({ move: { x: 1, y: 1 } })
  })

  it('dispose 让挂起的请求以错误结束，不留下悬挂的 promise', async () => {
    const engine = createAiEngine(() => {})
    const pending = engine.search(request(1))

    engine.dispose()

    await expect(pending).rejects.toThrow(/释放/)
  })

  it('dispose 之后再发起搜索直接拒绝', async () => {
    const engine = createAiEngine(() => {})
    engine.dispose()

    await expect(engine.search(request(1))).rejects.toThrow(/释放/)
  })

  it('重复 dispose 不报错', () => {
    const engine = createAiEngine(() => {})

    engine.dispose()
    expect(() => engine.dispose()).not.toThrow()
  })

  it('Worker 报错时挂起的请求以错误结束', async () => {
    const engine = createAiEngine(() => {})
    const pending = engine.search(request(1))

    engine.handleError('引擎崩溃')

    await expect(pending).rejects.toThrow('引擎崩溃')
  })

  it('Worker 报错后，后续搜索仍然可以正常工作', async () => {
    const engine = createAiEngine(() => {})
    void engine.search(request(1)).catch(() => {})
    engine.handleError('引擎崩溃')

    const retry = engine.search(request(2))
    engine.handleResponse(response(2))

    await expect(retry).resolves.toMatchObject({ requestId: 2 })
  })

  it('发送阶段就抛错时，请求立即失败且不留下登记记录', async () => {
    const engine = createAiEngine(() => {
      throw new Error('通道已关闭')
    })

    await expect(engine.search(request(1))).rejects.toThrow('通道已关闭')

    // 已经失败的请求不应再被响应唤醒。
    expect(() => engine.handleResponse(response(1))).not.toThrow()
  })
})

describe('createAiEngine —— Worker 报错的消息为空', () => {
  /**
   * `browserEngine.ts:21` 把 `event.message` 原样传进来，而 Worker **加载失败**
   * （跨源脚本、MIME 不对、网络断）时 `ErrorEvent.message` 常常是空串。
   * 空串不能当成「没有错误」——那会让界面显示一个空的错误框。
   */
  it('handleError 收到空串时兜底成一句能读的话', async () => {
    const engine = createAiEngine(() => {})
    const pending = engine.search(request(1))

    engine.handleError('')

    await expect(pending).rejects.toThrow('AI 引擎异常')
  })
})

describe('createAiEngine —— 取消', () => {
  it('cancel 以 SearchCancelledError 拒绝那个请求，并通知传输层中止一次', async () => {
    const abort = vi.fn()
    const engine = createAiEngine(() => {}, abort)
    const pending = engine.search(request(3))

    engine.cancel(3)

    await expect(pending).rejects.toBeInstanceOf(SearchCancelledError)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledWith(3)
  })

  it('取消之后才到达的同 id 响应被丢弃，其他请求不受影响', async () => {
    const engine = createAiEngine(() => {})
    const cancelled = engine.search(request(1))
    const kept = engine.search(request(2))
    cancelled.catch(() => {})

    engine.cancel(1)
    engine.handleResponse(response(1))
    engine.handleResponse(response(2))

    await expect(cancelled).rejects.toBeInstanceOf(SearchCancelledError)
    await expect(kept).resolves.toMatchObject({ requestId: 2 })
  })

  it('对已结算或不认识的 id 取消是空操作：不调 abort、不抛', async () => {
    const abort = vi.fn()
    const engine = createAiEngine(() => {}, abort)
    const settled = engine.search(request(1))
    engine.handleResponse(response(1))
    await settled

    expect(() => engine.cancel(1)).not.toThrow()
    expect(() => engine.cancel(99)).not.toThrow()
    expect(abort).not.toHaveBeenCalled()
  })

  it('dispose 之后 cancel 是空操作', () => {
    const abort = vi.fn()
    const engine = createAiEngine(() => {}, abort)
    void engine.search(request(1)).catch(() => {})
    engine.dispose()

    expect(() => engine.cancel(1)).not.toThrow()
    expect(abort).not.toHaveBeenCalled()
  })

  it('cancel 可以指定拒绝的原因（超时兜底用它报超时，而不是「已取消」）', async () => {
    const abort = vi.fn()
    const engine = createAiEngine(() => {}, abort)
    const pending = engine.search(request(4))

    engine.cancel(4, new Error('超时了'))

    await expect(pending).rejects.toThrow('超时了')
    expect(abort).toHaveBeenCalledWith(4)
  })

  it('不传 abort 时 cancel 仍然收干净待决表', async () => {
    const engine = createAiEngine(() => {})
    const pending = engine.search(request(5))

    engine.cancel(5)

    await expect(pending).rejects.toBeInstanceOf(SearchCancelledError)
  })
})

describe('createAiEngine —— 只让指定请求失败', () => {
  it('handleError 带 id 列表时只让列出的请求失败', async () => {
    const engine = createAiEngine(() => {})
    const failed = engine.search(request(1))
    const kept = engine.search(request(2))

    engine.handleError('落子 Worker 崩溃', [1])
    engine.handleResponse(response(2))

    await expect(failed).rejects.toThrow('落子 Worker 崩溃')
    await expect(kept).resolves.toMatchObject({ requestId: 2 })
  })

  it('空列表是空操作，不会退化成「全部失败」', async () => {
    const engine = createAiEngine(() => {})
    const kept = engine.search(request(1))

    engine.handleError('崩溃', [])
    engine.handleResponse(response(1))

    await expect(kept).resolves.toMatchObject({ requestId: 1 })
  })

  it('列表里已不在待决表的 id 被忽略', () => {
    const engine = createAiEngine(() => {})

    expect(() => engine.handleError('崩溃', [42])).not.toThrow()
  })
})
