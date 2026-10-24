import { describe, expect, it, vi } from 'vitest'
import type { AiEngine } from '../ai/engine'
import type { SearchResponse } from '../ai/types'
import { BLACK, WHITE } from '../core/types'
import { createEditorStore } from './editorStore'
import { createGameStore } from './gameStore'

function idleEngine(): AiEngine {
  return {
    search: vi.fn(() => Promise.reject(new Error('不该调用'))),
    handleResponse() {},
    handleError() {},
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
    confidence: 'exact',
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
