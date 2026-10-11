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

  it('win 是上行音：终止频率高于起始频率', () => {
    const { context, nodes } = createFakeContext()
    createStoneSound(() => context).win()

    const from = nodes.oscillator.frequency.setValueAtTime.mock.calls[0]?.[0] as number
    const to = nodes.oscillator.frequency.exponentialRampToValueAtTime.mock.calls[0]?.[0] as number
    expect(to).toBeGreaterThan(from)
    expect(nodes.oscillator.start).toHaveBeenCalled()
  })

  it('lose 是下行音：终止频率低于起始频率', () => {
    const { context, nodes } = createFakeContext()
    createStoneSound(() => context).lose()

    const from = nodes.oscillator.frequency.setValueAtTime.mock.calls[0]?.[0] as number
    const to = nodes.oscillator.frequency.exponentialRampToValueAtTime.mock.calls[0]?.[0] as number
    expect(to).toBeLessThan(from)
  })

  it('胜负音走同一套合成路径：振荡器接增益、增益接输出', () => {
    const { context, nodes } = createFakeContext()
    const sound = createStoneSound(() => context)

    sound.win()
    expect(nodes.oscillator.connect).toHaveBeenCalledWith(nodes.gain)
    expect(nodes.gain.connect).toHaveBeenCalledWith(context.destination)
    expect(nodes.oscillator.stop).toHaveBeenCalled()

    sound.lose()
    expect(nodes.oscillator.connect).toHaveBeenCalledTimes(2)
  })

  it('环境不支持 WebAudio 时胜负音同样静默降级', () => {
    const sound = createStoneSound(() => null)

    expect(() => sound.win()).not.toThrow()
    expect(() => sound.lose()).not.toThrow()
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

describe('arm —— 首次手势预热', () => {
  it('首次 pointerdown 时创建上下文并 resume', () => {
    // 只 create 不 resume 等于白造一个挂起的 AudioContext：往后每次 play 都
    // 还要自己 resume，而那时手势已经过去了，浏览器照样拦截。
    const fake = createFakeContext('suspended')
    const factory = vi.fn(() => fake.context)
    const sound = createStoneSound(factory)
    const target = new EventTarget()

    sound.arm(target)
    expect(factory).not.toHaveBeenCalled()

    target.dispatchEvent(new Event('pointerdown'))

    expect(factory).toHaveBeenCalledTimes(1)
    expect(fake.resume).toHaveBeenCalledTimes(1)
  })

  it('重复手势只预热一次', () => {
    const fake = createFakeContext('suspended')
    const factory = vi.fn(() => fake.context)
    const sound = createStoneSound(factory)
    const target = new EventTarget()

    sound.arm(target)
    target.dispatchEvent(new Event('pointerdown'))
    target.dispatchEvent(new Event('pointerdown'))

    expect(factory).toHaveBeenCalledTimes(1)
    expect(fake.resume).toHaveBeenCalledTimes(1)
  })

  it('清理函数解绑之后，手势不再预热', () => {
    const factory = vi.fn(() => createFakeContext().context)
    const sound = createStoneSound(factory)
    const target = new EventTarget()

    const off = sound.arm(target)
    off()
    target.dispatchEvent(new Event('pointerdown'))

    expect(factory).not.toHaveBeenCalled()
  })

  it('环境不支持 WebAudio 时预热不抛错', () => {
    const sound = createStoneSound(() => null)
    const target = new EventTarget()

    sound.arm(target)
    expect(() => target.dispatchEvent(new Event('pointerdown'))).not.toThrow()
  })
})
