import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMove, createGame, resign } from '../../core/game'
import type { GameState } from '../../core/game'
import { BLACK } from '../../core/types'
import type { StoneSound } from '../../lib/sound'
import { useSettingsStore } from '../../store/settingsStore'
import { useGameStore } from '../../store/useGameStore'
import { BattleScreen } from './BattleScreen'

// jsdom 里没有 Worker，而 `useGameStore` 在模块加载时就构造引擎（见 ai/browserEngine.ts）。
// 这一组用例不碰 AI：引擎只是被建出来，一次搜索都不发。
// 必须用 vi.hoisted —— 普通语句排在 import 之后，那时模块已经炸了。
vi.hoisted(() => {
  class FakeWorker {
    addEventListener(): void {}
    postMessage(): void {}
  }
  // 记下原本的 Worker（jsdom 里通常是 undefined），用完在 afterAll 里还回去。
  // 不还原的话，同一文件里将来新增的用例会在「Worker 永远存在」的假前提下写，
  // 而那是这个文件自己造的假象。
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

function fakeSound(): StoneSound {
  return {
    play: vi.fn(),
    win: vi.fn(),
    lose: vi.fn(),
    arm: vi.fn(() => () => {}),
    dispose: vi.fn(),
  }
}

const sound = fakeSound()

/** 黑棋横向连成五子取胜的九手棋。 */
function wonByBlack(): GameState {
  const points = [
    { x: 0, y: 0 }, { x: 0, y: 1 },
    { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 2, y: 0 }, { x: 2, y: 1 },
    { x: 3, y: 0 }, { x: 3, y: 1 },
    { x: 4, y: 0 },
  ]
  let state = createGame()
  for (const point of points) {
    const result = applyMove(state, point)
    if (!result.ok) throw new Error(`落子失败：${point.x},${point.y}`)
    state = result.state
  }
  return state
}

function setup(game: GameState = createGame()) {
  useSettingsStore.setState({ soundEnabled: true })
  useGameStore.setState({ game, mode: 'pve', humanColor: BLACK, aiThinking: false })

  return render(<BattleScreen sound={sound} />)
}

/** 直接落一局新棋局进 store，模拟落子/悔棋/重开造成的状态变化。 */
function setGame(game: GameState): void {
  act(() => {
    useGameStore.setState({ game })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BattleScreen —— 终局音效', () => {
  it('挂载时把音频预热绑到 window 的首次手势上', () => {
    // 预热必须挂在持有实例的这一层：换个地方新建实例预热，暖的是一份
    // 没人播放的上下文，等于没做。
    setup()

    expect(sound.arm).toHaveBeenCalledWith(window)
  })

  it('开局不响胜负音', () => {
    setup()

    expect(sound.win).not.toHaveBeenCalled()
    expect(sound.lose).not.toHaveBeenCalled()
  })

  it('分出胜负那一刻响一次胜音', () => {
    setup()
    expect(sound.win).not.toHaveBeenCalled()

    setGame(wonByBlack())

    expect(sound.win).toHaveBeenCalledTimes(1)
    expect(sound.lose).not.toHaveBeenCalled()
  })

  it('终局之后再重渲染不会重复响——边沿触发，不是电平', () => {
    const { rerender } = setup()
    setGame(wonByBlack())
    expect(sound.win).toHaveBeenCalledTimes(1)

    rerender(<BattleScreen sound={sound} />)
    rerender(<BattleScreen sound={sound} />)

    expect(sound.win).toHaveBeenCalledTimes(1)
  })

  it('玩家落败响败音', () => {
    setup()
    setGame({ ...wonByBlack(), winner: 2 })

    expect(sound.lose).toHaveBeenCalledTimes(1)
    expect(sound.win).not.toHaveBeenCalled()
  })

  it('认输也是终局，照样响', () => {
    setup()

    setGame(resign(createGame(), BLACK))

    expect(sound.lose).toHaveBeenCalledTimes(1)
  })

  it('和棋不响：既不是赢也不是输，塞哪个都是说谎', () => {
    setup()

    setGame({ ...createGame(), status: 'draw' })

    expect(sound.win).not.toHaveBeenCalled()
    expect(sound.lose).not.toHaveBeenCalled()
  })

  it('关掉音效后终局不响', () => {
    setup()
    useSettingsStore.setState({ soundEnabled: false })

    setGame(wonByBlack())

    expect(sound.win).not.toHaveBeenCalled()
    expect(sound.lose).not.toHaveBeenCalled()
  })

  it('悔棋回到进行中不响，之后再分出胜负会再响一次', () => {
    setup()
    setGame(wonByBlack())
    expect(sound.win).toHaveBeenCalledTimes(1)

    setGame(createGame()) // 悔棋 / 重开：回到进行中
    expect(sound.win).toHaveBeenCalledTimes(1)
    expect(sound.lose).not.toHaveBeenCalled() // 回到进行中不是终局，一颗音都不该放

    setGame(wonByBlack())
    expect(sound.win).toHaveBeenCalledTimes(2)
  })
})

/**
 * 防误触确认的**取消路径**：任务书 §五 要求「取消之后保留所有棋局状态」。
 *
 * e2e 那边验的是**后果**（棋子还在、AI 那一手照样落下来）；这里验的是**机制**：
 * 取消之后 store 的每一个字段都还是原来那个对象引用。
 * 两者的分工是有意的——e2e 抓「用户看得见的不对」，这条抓「将来有人在取消分支里
 * 加了一行副作用」，而那种改动在界面上可能一时看不出来。
 *
 * §5.2 当初点名要的就是这一条：`pendingRequestId` 与 `aiThinking` 必须原样保留，
 * 否则取消会顺手把 AI 正在飞的那一手作废掉。
 *
 * **关于「组件测试不该断言内部 state」（`AGENTS.md` 的测试一节）**：
 * 那条管的是断言**组件自己的**内部状态（渲染细节、私有字段）——这类断言会随实现
 * 改动而碎，且不证明用户看到什么。这里断言的是 store 的公开状态，
 * 而「取消不碰 store」本身就是一条**规格要求**（它没有可见的等价物：
 * 「没发生的事」看不见）。仓库里已有同样的先例：`AppHeader.test.tsx` 断言
 * `useLearnStore.getState().view`、`learn/screens.test.tsx` 断言
 * `progress.completedLessons`。**可见后果那一半由 e2e 覆盖**
 * （取消之后棋子还在、AI 那一手照样落下来），两条是互补的。
 */
describe('BattleScreen —— 确认弹窗的取消不碰 store', () => {
  const WATCHED = [
    'game',
    'mode',
    'humanColor',
    'difficulty',
    'aiThinking',
    'aiError',
    'aiInfo',
    'pendingRequestId',
    'hint',
    'hintUrgency',
    'hintConfidence',
    'hintThinking',
    'hintError',
    'pendingHintRequestId',
    'recordSaveState',
    'recordedSeq',
  ] as const

  it.each([
    ['重新开始', '重新开始'],
    ['认输', '认输'],
  ])('点「%s」再取消，字段逐个没动', (_label, buttonName) => {
    // 「进行中 + 有落子 + AI 正在思考」：把所有会被拦的条件一次性踩满
    const played = applyMove(createGame(), { x: 7, y: 7 })
    if (!played.ok) throw new Error('落子失败')
    setup(played.state)
    act(() => {
      useGameStore.setState({ aiThinking: true, pendingRequestId: 4242 })
    })

    const before = useGameStore.getState()

    fireEvent.click(screen.getByRole('button', { name: buttonName }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const after = useGameStore.getState()
    for (const key of WATCHED) {
      // 引用相等：store 是不可变的，没被碰过的字段就是同一个对象
      expect(after[key], `${key} 被改动了`).toBe(before[key])
    }
  })
})
