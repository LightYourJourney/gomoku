import { describe, expect, it, vi } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK, type Point } from '../core/types'
import { createAiEngine } from './engine'
import type { SearchRequest, SearchResponse } from './types'

function request(requestId: number, gameVersion = 0): SearchRequest {
  return {
    requestId,
    gameVersion,
    board: createBoard(),
    player: BLACK,
    difficulty: 'easy',
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
    confidence: 'exact',
    reason: 'search',
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
