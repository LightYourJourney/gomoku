import type { ButtonHTMLAttributes, Ref } from 'react'
import { cx } from '../../lib/cx'

export type ButtonVariant = 'primary' | 'default' | 'danger'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg border-transparent hover:brightness-110',
  default: 'bg-surface-2 text-fg border-border hover:border-border-strong',
  danger: 'bg-danger-soft text-danger border-transparent hover:brightness-110',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  block?: boolean
  /** React 19 里 `ref` 是普通 prop，会随 `...rest` 落到 `<button>` 上。 */
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'default',
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium whitespace-nowrap transition',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT_CLASS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    />
  )
}
