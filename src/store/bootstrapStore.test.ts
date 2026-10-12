import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `bootstrapStore()` 里装配的是**真实**的浏览器引擎，`useGameStore` 模块
 * 一加载就会 `new Worker(...)`。jsdom 没有 Worker，所以先把它换成空实现——
 * 与 `BattleScreen.test.tsx:14-20` 同一手法。这里的用例不会真的触发搜索。
 */
vi.hoisted(() => {
  class FakeWorker {
    addEventListener(): void {}
    postMessage(): void {}
  }
  // 记下原本的 Worker（jsdom 里通常是 undefined），用完在 afterAll 里还回去——
  // 与 `BattleScreen.test.tsx` 同一手法，那边也补了还原。
  ;(globalThis as { __originalWorker?: unknown }).__originalWorker = (
    globalThis as { Worker?: unknown }
  ).Worker
  Object.assign(globalThis, { Worker: FakeWorker })
})

afterAll(() => {
  const original = (globalThis as { __originalWorker?: unknown }).__originalWorker
  if (original === undefined) Reflect.deleteProperty(globalThis, 'Worker')
  else Object.assign(globalThis, { Worker: original })
})

import { STORAGE_KEY, encodeSession } from '../persist/storage'
import { bootstrapStore, useGameStore } from './useGameStore'

/**
 * `bootstrapStore` 是应用启动时**只调一次**的装配函数（`main.tsx:9`，
 * 在 React 挂载之前）。它做两件事，缺一不可：
 *
 * 1. 把上次的对局从 localStorage 接回来（刷新不丢局面）；
 * 2. 订阅 store，此后**每一次**状态变化都把当前手顺写回 localStorage。
 *
 * 这一整条链路此前没有任何测试：grep `bootstrapStore` 全仓只有 `main.tsx:9`
 * 与定义处。e2e 覆盖了「刷新后恢复」（`battle.spec.ts:80,107`），
 * 但**自动写入**这一半没有直接断言——它坏了只会表现为「刷新回到更早的局面」，
 * 不会报错。
 *
 * 用本地双人模式：它不会自动发起 AI 请求，用例因此不依赖 Worker。
 */
describe('bootstrapStore', () => {
  beforeEach(() => {
    // `useGameStore` 是模块级单例，用例之间必须自己复位——否则上一条留下的
    // 手顺会被下一条看见。先复位（此时若已有订阅，它会顺带写一次 localStorage），
    // 再清掉，让每个用例都从「本机没有存档」开始。
    useGameStore.getState().newGame({ mode: 'pvp' })
    localStorage.clear()
  })

  it('恢复上次的对局，并且此后每次变化都写回 localStorage', async () => {
    const moves = [
      { x: 3, y: 7 },
      { x: 3, y: 9 },
      { x: 4, y: 7 },
    ]
    localStorage.setItem(
      STORAGE_KEY,
      encodeSession({
        moves,
        firstPlayer: 1,
        mode: 'pvp',
        humanColor: 1,
        difficulty: 'easy',
        resignedBy: null,
      }),
    )

    bootstrapStore()

    // ① 恢复：手顺与模式都接回来了
    const restored = useGameStore.getState()
    expect(restored.mode).toBe('pvp')
    expect(restored.game.moves).toEqual(moves)
    expect(restored.game.version).toBe(3)

    // ② 订阅：再落一手，localStorage 立刻跟着变
    useGameStore.getState().playHuman({ x: 5, y: 7 })

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()

    const persisted = JSON.parse(raw!) as { schemaVersion: number; moves: unknown[]; mode: string }
    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.mode).toBe('pvp')
    expect(persisted.moves).toEqual([...moves, { x: 5, y: 7 }])

    // 写的是**当前**局面，不是发起订阅那一刻的快照
    expect(persisted.moves).toHaveLength(4)
  })

  it('没有存档时保持默认状态，并且照样建立订阅', () => {
    bootstrapStore()

    expect(useGameStore.getState().game.moves).toHaveLength(0)

    // 订阅同样生效：换个难度也会被写下去
    useGameStore.getState().setDifficulty('hard')
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).difficulty).toBe('hard')
  })

  it('损坏的存档被当作没有存档，不把半截数据灌进状态机', () => {
    localStorage.setItem(STORAGE_KEY, '{"schemaVersion":2,"moves":[{"x":1,"y":1},{"x":99,"y":0}]')

    expect(() => bootstrapStore()).not.toThrow()
    expect(useGameStore.getState().game.moves).toHaveLength(0)
  })
})


describe('自动存档的写入频率', () => {
  // 这个 describe 在 `describe('bootstrapStore')` 之外，拿不到它的 beforeEach
  beforeEach(() => {
    localStorage.clear()
  })

  /**
   * `subscribe` 没有 selector，任何 state 变化都会把回调跑一遍——落子一手会连着
   * 触发好几次（`aiThinking`、`aiInfo`、`recordSaveState`…），每次都
   * `JSON.stringify` 整条手顺并**同步**写 localStorage。
   *
   * 存档里只有 game / mode / humanColor / difficulty 四项，所以这四项没变时
   * 不该落盘。`game` 是不可变的，引用比较就够。
   */
  it('与存档无关的状态变化不重复写 localStorage', () => {
    bootstrapStore() // 建立订阅（重复调用只是多挂一个，写入会被过滤掉）

    // 先落一手，让存档真的变一次
    useGameStore.getState().playHuman({ x: 0, y: 0 })

    const spy = vi.spyOn(Storage.prototype, 'setItem')
    try {
      // 这些字段都不在存档里
      useGameStore.setState({ aiThinking: true, aiInfo: null, recordSaveState: 'idle' })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('存档里的字段真的变了则照常落盘', () => {
    bootstrapStore()

    // 先把难度归到一个已知值（这一步本身会写一次，所以要放在 spy 之前）
    useGameStore.getState().setDifficulty('easy')

    const spy = vi.spyOn(Storage.prototype, 'setItem')
    try {
      useGameStore.getState().setDifficulty('expert')
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})
