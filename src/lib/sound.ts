import type { Player } from '../core/types'

export interface StoneSound {
  play(player: Player): void
  dispose(): void
}

function defaultAudioContext(): AudioContext | null {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext
  return Ctor === undefined ? null : new Ctor()
}

/**
 * 落子音效用 WebAudio 实时合成，不引入任何音频文件：
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

  return {
    play(player) {
      const ctx = ensureContext()
      if (ctx === null) return

      if (ctx.state === 'suspended') {
        void ctx.resume()
      }

      const now = ctx.currentTime
      const startFrequency = player === 1 ? 320 : 400

      const oscillator = ctx.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(startFrequency, now)
      oscillator.frequency.exponentialRampToValueAtTime(90, now + 0.09)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)

      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.15)
    },

    dispose() {
      if (context !== undefined && context !== null) {
        void context.close()
      }
      context = undefined
    },
  }
}
