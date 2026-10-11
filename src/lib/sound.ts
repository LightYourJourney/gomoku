import type { Player } from '../core/types'

export interface StoneSound {
  play(player: Player): void
  /** 胜局音：短促的上行。 */
  win(): void
  /** 败局音：短促的下行。 */
  lose(): void
  /**
   * 首次手势时预热音频上下文，返回解绑函数。
   *
   * 浏览器不允许在用户手势之前启动音频，所以上下文只能等到第一次
   * `pointerdown` 才创建。**必须连 `resume()` 一起做**：只 create 不 resume
   * 等于白造一个挂起的上下文，往后每次发声都还得自己 resume，而那时手势
   * 已经过去了——预热就是无效的。
   */
  arm(target: EventTarget): () => void
  dispose(): void
}

function defaultAudioContext(): AudioContext | null {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext
  return Ctor === undefined ? null : new Ctor()
}

/** 一次短促的扫频：起始频率滑向终止频率，配一条极短的包络。 */
function sweep(
  ctx: AudioContext,
  options: { from: number; to: number; seconds: number; peak: number },
): void {
  const now = ctx.currentTime

  const oscillator = ctx.createOscillator()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(options.from, now)
  oscillator.frequency.exponentialRampToValueAtTime(options.to, now + options.seconds)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(options.peak, now + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + options.seconds + 0.04)

  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(now)
  oscillator.stop(now + options.seconds + 0.06)
}

/**
 * 音效用 WebAudio 实时合成，不引入任何音频文件：
 * 一段快速下滑的正弦加上极短的包络，听起来就是棋子磕在木盘上的「嗒」。
 * 黑子略低沉、白子略清脆，闭着眼也能听出是谁落的。
 */
export function createStoneSound(
  createContext: () => AudioContext | null = defaultAudioContext,
): StoneSound {
  let context: AudioContext | null | undefined

  function ensureContext(): AudioContext | null {
    if (context === undefined) {
      context = createContext()
    }
    return context
  }

  /** 拿到一个能发声的上下文；拿不到就返回 null（静默降级）。 */
  function ready(): AudioContext | null {
    const ctx = ensureContext()
    if (ctx === null) return null

    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
    return ctx
  }

  return {
    play(player) {
      const ctx = ready()
      if (ctx === null) return

      sweep(ctx, { from: player === 1 ? 320 : 400, to: 90, seconds: 0.09, peak: 0.25 })
    },

    win() {
      const ctx = ready()
      if (ctx === null) return

      // 上行五度，比落子音长一些，是句号不是标点
      sweep(ctx, { from: 523, to: 784, seconds: 0.16, peak: 0.2 })
    },

    lose() {
      const ctx = ready()
      if (ctx === null) return

      sweep(ctx, { from: 392, to: 196, seconds: 0.22, peak: 0.18 })
    },

    arm(target) {
      const warm = (): void => {
        // 对已经在跑的上下文 resume() 是空操作，所以这里不判 state
        const ctx = ensureContext()
        if (ctx !== null) void ctx.resume()
      }

      target.addEventListener('pointerdown', warm, { once: true })
      return () => target.removeEventListener('pointerdown', warm)
    },

    dispose() {
      if (context !== undefined && context !== null) {
        void context.close()
      }
      context = undefined
    },
  }
}
