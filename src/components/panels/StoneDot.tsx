import { cx } from '../../lib/cx'
import type { Player } from '../../core/types'

export interface StoneDotProps {
  player: Player
  size?: number
  className?: string
}

/** 与棋盘棋子用同一套渐变，面板里的小圆点才不会看起来像另一个东西。 */
export function StoneDot({ player, size = 13, className }: StoneDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background:
          player === 1
            ? 'radial-gradient(circle at 35% 30%, var(--c-stone-black-a), var(--c-stone-black-b))'
            : 'radial-gradient(circle at 35% 30%, var(--c-stone-white-a), var(--c-stone-white-b))',
        boxShadow:
          player === 1
            ? '0 1px 2px rgb(0 0 0 / 0.4)'
            : 'inset 0 0 0 1px rgb(0 0 0 / 0.15), 0 1px 2px rgb(0 0 0 / 0.18)',
      }}
    />
  )
}
