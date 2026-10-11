import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  Object.assign(globalThis, { Worker: FakeWorker })
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
