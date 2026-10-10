import { describe, expect, it, vi } from 'vitest'
import { BLACK, WHITE } from '../core/types'
import { createStoneSound } from './sound'

interface FakeNodes {
  oscillator: { type: string; frequency: Record<string, ReturnType<typeof vi.fn>>; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
  gain: { gain: Record<string, ReturnType<typeof vi.fn>>; connect: ReturnType<typeof vi.fn> }
}

function createFakeContext(state: AudioContextState = 'running') {
  const oscillator = {
    type: 'sine',
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  }
  const resume = vi.fn(() => Promise.resolve())
  const close = vi.fn(() => Promise.resolve())

  const context = {
    state,
    currentTime: 1,
    destination: {},
    createOscillator: () => oscillator,
    createGain: () => gain,
    resume,
    close,
  }

  return { context: context as unknown as AudioContext, nodes: { oscillator, gain } as FakeNodes, resume, close }
}

describe('createStoneSound', () => {
  it('环境不支持 WebAudio 时静默降级，不抛错', () => {
    const sound = createStoneSound(() => null)

    expect(() => sound.play(BLACK)).not.toThrow()
  })

  it('播放时创建一个振荡器并接到增益节点，最后送到输出', () => {
    const { context, nodes } = createFakeContext()
    const sound = createStoneSound(() => context)

    sound.play(BLACK)

    expect(nodes.oscillator.frequency.setValueAtTime).toHaveBeenCalled()
    expect(nodes.oscillator.connect).toHaveBeenCalledWith(nodes.gain)
    expect(nodes.gain.connect).toHaveBeenCalledWith(context.destination)
    expect(nodes.oscillator.start).toHaveBeenCalled()
    expect(nodes.oscillator.stop).toHaveBeenCalled()
  })

  it('黑白子的起始音高不同', () => {
    const black = createFakeContext()
    createStoneSound(() => black.context).play(BLACK)
    const blackFrequency = black.nodes.oscillator.frequency.setValueAtTime.mock.calls[0]?.[0]

    const white = createFakeContext()
    createStoneSound(() => white.context).play(WHITE)
    const whiteFrequency = white.nodes.oscillator.frequency.setValueAtTime.mock.calls[0]?.[0]

    expect(blackFrequency).not.toBe(whiteFrequency)
  })

  it('上下文被挂起时尝试恢复', () => {
    const { context, resume } = createFakeContext('suspended')
    const sound = createStoneSound(() => context)

    sound.play(BLACK)

    expect(resume).toHaveBeenCalled()
  })

  it('只创建一次音频上下文', () => {
    const factory = vi.fn(() => createFakeContext().context)
    const sound = createStoneSound(factory)

    sound.play(BLACK)
    sound.play(WHITE)
    sound.play(BLACK)

    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('dispose 会关闭上下文，之后再播放会重新创建', () => {
    const first = createFakeContext()
    const factory = vi.fn(() => first.context)
    const sound = createStoneSound(factory)

    sound.play(BLACK)
    sound.dispose()

    expect(first.close).toHaveBeenCalled()

    sound.play(BLACK)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
