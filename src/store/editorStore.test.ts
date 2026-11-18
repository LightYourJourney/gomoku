import { describe, expect, it, vi } from 'vitest'
import { createAiEngine, type AiEngine } from '../ai/engine'
import type { SearchResponse } from '../ai/types'
import { positionFromReplay } from '../core/position'
import { BLACK, WHITE } from '../core/types'
import { createEditorStore } from './editorStore'
import { createGameStore } from './gameStore'
import { AI_RESPONSE_TIMEOUT_MS } from './searchDeadline'

function idleEngine(): AiEngine {
  return {
    search: vi.fn(() => Promise.reject(new Error('不该调用'))),
    handleResponse() {},
    handleError() {},
    cancel() {},
    dispose() {},
  }
}

function deferredEngine(): { engine: AiEngine; resolve: (r: SearchResponse) => void } {
  let resolve!: (r: SearchResponse) => void
  const promise = new Promise<SearchResponse>((r) => { resolve = r })
  return {
    engine: {
      search: vi.fn(() => promise),
      handleResponse() {},
      handleError() {},
      cancel() {},
      dispose() {},
    },
    resolve,
  }
}

function response(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    requestId: 1,
    gameVersion: 1,
    move: { x: 7, y: 7 },
    score: 10,
    depth: 4,
    nodes: 100,
    elapsedMs: 20,
    confidence: 'complete',
    reason: 'search',
    candidates: [{ move: { x: 7, y: 7 }, score: 10, attack: 'three', defense: 'none' }],
    urgency: 'normal',
    ...overrides,
  }
}

describe('editorStore —— 编辑历史', () => {
  it('放黑/白/擦除，撤销与重做按编辑快照走', () => {
    const store = createEditorStore(idleEngine())
    store.getState().edit({ x: 7, y: 7 })
    store.getState().setTool('white')
    store.getState().edit({ x: 7, y: 8 })
    store.getState().setTool('erase')
    store.getState().edit({ x: 7, y: 8 })

    expect(store.getState().position.board[8 * 15 + 7]).toBe(0)
    store.getState().undo()
    expect(store.getState().position.board[8 * 15 + 7]).toBe(WHITE)
    store.getState().undo()
    expect(store.getState().position.board[8 * 15 + 7]).toBe(0)
    store.getState().redo()
    expect(store.getState().position.board[8 * 15 + 7]).toBe(WHITE)
  })

  it('新编辑发生后重做分支失效', () => {
    const store = createEditorStore(idleEngine())
    store.getState().edit({ x: 0, y: 0 })
    store.getState().edit({ x: 1, y: 0 })
    store.getState().undo()
    store.getState().edit({ x: 2, y: 0 })

    expect(store.getState().future).toHaveLength(0)
    store.getState().redo()
    expect(store.getState().position.board[2]).toBe(BLACK)
  })

  it('载入新局面重置历史与重做', () => {
    const store = createEditorStore(idleEngine())
    store.getState().edit({ x: 0, y: 0 })
    store.getState().load(
      { board: new Uint8Array(225), nextPlayer: WHITE },
      null,
    )
    expect(store.getState().history).toHaveLength(0)
    expect(store.getState().future).toHaveLength(0)
    expect(store.getState().position.nextPlayer).toBe(WHITE)
  })

  it('覆盖同色不产生历史，覆盖异色产生历史', () => {
    const store = createEditorStore(idleEngine())
    store.getState().edit({ x: 7, y: 7 })
    const history = store.getState().history.length
    store.getState().edit({ x: 7, y: 7 })
    expect(store.getState().history).toHaveLength(history)

    store.getState().setTool('white')
    store.getState().edit({ x: 7, y: 7 })
    expect(store.getState().history.length).toBe(history + 1)
  })
})

describe('editorStore —— 设置与清空', () => {
  it('设置下一手是编辑动作，可撤销', () => {
    const store = createEditorStore(idleEngine())
    store.getState().setNextPlayer(WHITE)
    expect(store.getState().position.nextPlayer).toBe(WHITE)
    store.getState().undo()
    expect(store.getState().position.nextPlayer).toBe(BLACK)
  })

  it('清空保留下一手颜色，可撤销', () => {
    const store = createEditorStore(idleEngine())
    store.getState().edit({ x: 7, y: 7 })
    store.getState().setNextPlayer(WHITE)
    store.getState().clear()
    expect(store.getState().position.nextPlayer).toBe(WHITE)
    expect(store.getState().position.board.some((cell) => cell !== 0)).toBe(false)
    store.getState().undo()
    expect(store.getState().position.board[7 * 15 + 7]).toBe(BLACK)
  })

  it('编辑、清空与分析都不触碰正式对战 store', async () => {
    const { engine, resolve } = deferredEngine()
    const gameStore = createGameStore(idleEngine())
    const before = gameStore.getState().game
    const editor = createEditorStore(engine)

    editor.getState().edit({ x: 7, y: 7 })
    editor.getState().setNextPlayer(WHITE)
    editor.getState().clear()
    editor.getState().undo()
    editor.getState().analyze()

    expect(editor.getState().analysis.status).toBe('running')
    expect(gameStore.getState().game).toBe(before)
    expect(gameStore.getState().game.version).toBe(0)
    expect(gameStore.getState().pendingRequestId).toBeNull()

    resolve(
      response({
        requestId: editor.getState().analysis.requestId!,
        gameVersion: editor.getState().analysis.version!,
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.getState().analysis.status).toBe('done')
    expect(gameStore.getState().game).toBe(before)
    expect(gameStore.getState().pendingRequestId).toBeNull()
  })
})

describe('editorStore —— AI 分析', () => {
  it('不合法局面不调用引擎，给出原因', () => {
    const engine = idleEngine()
    const store = createEditorStore(engine)
    store.getState().edit({ x: 7, y: 7 })
    store.getState().analyze()
    expect(engine.search).not.toHaveBeenCalled()
    expect(store.getState().analysis.status).toBe('error')
    expect(store.getState().analysis.error).toContain('下一手')
  })

  it('白先棋谱载入的快照可以分析（按它自己的先手方判奇偶）', () => {
    const { engine } = deferredEngine()
    const store = createEditorStore(engine)
    const loaded = positionFromReplay([{ x: 7, y: 7 }], WHITE, 1)
    store.getState().load(loaded.position, loaded.provenance)

    store.getState().analyze()

    expect(store.getState().analysis.error ?? null).toBeNull()
    expect(engine.search).toHaveBeenCalledTimes(1)
  })

  it('分析请求携带编辑器版本；继续摆棋后旧响应失效', async () => {
    const { engine, resolve } = deferredEngine()
    const store = createEditorStore(engine)
    store.getState().setNextPlayer(WHITE)
    store.getState().edit({ x: 7, y: 7 })
    store.getState().setNextPlayer(WHITE)

    store.getState().analyze()
    expect(engine.search).toHaveBeenCalledTimes(1)
    const request = vi.mocked(engine.search).mock.calls[0]![0]
    expect(request.gameVersion).toBe(store.getState().version)
    expect(request.purpose).toBe('hint')

    store.getState().setTool('white')
    store.getState().edit({ x: 8, y: 8 })
    resolve(response({ requestId: request.requestId, gameVersion: request.gameVersion }))
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getState().analysis.status).toBe('idle')
    expect(store.getState().analysis.response).toBeNull()
  })

  it('Worker 错误显示在分析状态里', async () => {
    const engine: AiEngine = {
      search: vi.fn(() => Promise.reject(new Error('worker 崩了'))),
      handleResponse() {},
      handleError() {},
      cancel() {},
      dispose() {},
    }
    const store = createEditorStore(engine)
    store.getState().setNextPlayer(WHITE)
    store.getState().edit({ x: 7, y: 7 })
    store.getState().setNextPlayer(WHITE)
    store.getState().analyze()
    await Promise.resolve()
    await Promise.resolve()
    expect(store.getState().analysis.status).toBe('error')
    expect(store.getState().analysis.error).toContain('worker')
  })

  it('分析按所选难度发请求；切档位后旧响应失效', async () => {
    const { engine, resolve } = deferredEngine()
    const store = createEditorStore(engine)
    store.getState().setNextPlayer(WHITE)
    store.getState().edit({ x: 7, y: 7 })
    store.getState().setNextPlayer(WHITE)

    expect(store.getState().difficulty).toBe('medium')
    store.getState().setDifficulty('hard')
    store.getState().analyze()
    const request = vi.mocked(engine.search).mock.calls[0]![0]
    expect(request.difficulty).toBe('hard')
    expect(request.budgetMs).toBeUndefined()
    expect(store.getState().analysis.difficulty).toBe('hard')

    store.getState().setDifficulty('easy')
    resolve(response({ requestId: request.requestId, gameVersion: request.gameVersion }))
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getState().analysis.status).toBe('idle')
    expect(store.getState().analysis.response).toBeNull()
  })
})

describe('editorStore —— 放弃的分析被取消（阶段 B）', () => {
  /** 真的 `createAiEngine`：被取消的请求真的以 `SearchCancelledError` 拒绝。 */
  function realEngine() {
    const aborted: number[] = []
    const posted: number[] = []
    const engine = createAiEngine(
      (request) => posted.push(request.requestId),
      (requestId) => aborted.push(requestId),
    )
    return { engine, aborted, posted }
  }

  function analyzable(engine: AiEngine) {
    const store = createEditorStore(engine)
    store.getState().setNextPlayer(WHITE)
    store.getState().edit({ x: 7, y: 7 })
    store.getState().setNextPlayer(WHITE)
    return store
  }

  it('分析中继续摆棋：那次分析被取消，拒绝不落到错误状态', async () => {
    const { engine, aborted, posted } = realEngine()
    const store = analyzable(engine)
    store.getState().analyze()

    store.getState().setTool('white')
    store.getState().edit({ x: 8, y: 8 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(aborted).toEqual(posted)
    expect(store.getState().analysis.status).toBe('idle')
    expect(store.getState().analysis.error).toBeNull()
  })

  it('分析中切档位：那次分析被取消', () => {
    const { engine, aborted, posted } = realEngine()
    const store = analyzable(engine)
    store.getState().analyze()

    store.getState().setDifficulty('easy')

    expect(aborted).toEqual(posted)
  })

  it('离开编辑器（abandonAnalysis）：在飞的分析被取消', () => {
    const { engine, aborted, posted } = realEngine()
    const store = analyzable(engine)
    store.getState().analyze()

    store.getState().abandonAnalysis()

    expect(aborted).toEqual(posted)
    expect(store.getState().analysis.status).toBe('idle')
  })

  it('引擎永不结算时超时：落到错误状态、文案是超时而不是「已取消」，并取消请求', async () => {
    vi.useFakeTimers()
    try {
      const { engine, aborted, posted } = realEngine()
      const store = analyzable(engine)
      store.getState().analyze()

      await vi.advanceTimersByTimeAsync(AI_RESPONSE_TIMEOUT_MS - 1)
      expect(store.getState().analysis.status).toBe('running')

      await vi.advanceTimersByTimeAsync(1)
      expect(store.getState().analysis.status).toBe('error')
      expect(store.getState().analysis.error).toContain(`${AI_RESPONSE_TIMEOUT_MS / 1000} 秒`)
      expect(aborted).toEqual(posted)
    } finally {
      vi.useRealTimers()
    }
  })
})
