import type { ButtonHTMLAttributes, Ref } from 'react'
import { cx } from '../../lib/cx'

/**
 * 按钮等级。规范见 `docs/ui-redesign/DESIGN_SYSTEM.md` §6.1。
 *
 * `default` 保留为 `secondary` 的别名——它曾经是唯一的默认档，
 * 现有调用方里还有人显式写着 `variant="default"`。改名不该让调用方跟着改。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'default' | 'ghost' | 'danger'

/** 只有两档。第三档（`xs`）没有真实需求，不做。 */
export type ButtonSize = 'md' | 'sm'

const VARIANT_CLASS: Record<Exclude<ButtonVariant, 'default'>, string> = {
  /** 当前唯一该做的事。一屏最多一个。 */
  primary: 'bg-accent text-accent-fg border-transparent hover:brightness-110 active:brightness-95',
  /** 常规操作。 */
  secondary:
    'bg-surface-2 text-fg border-border hover:border-border-strong active:brightness-95',
  /**
   * 低权重操作（错误条里的「重试」、提示面板的「收起」）。
   *
   * 保留下划线是刻意的：这几个按钮长在 `role="alert"` 或说明文字旁边，
   * 去掉下划线后它们看起来就是普通文字，没人知道能点。
   */
  ghost:
    'bg-transparent text-muted border-transparent underline underline-offset-2 hover:bg-surface-2 hover:text-fg active:brightness-95',
  /** 破坏性操作（认输）。 */
  danger: 'bg-danger-soft text-danger border-transparent hover:brightness-110 active:brightness-95',
}

/**
 * 两档的高度都是**下限**（`min-h-*`），不是固定值——文案换行或放大字号时
 * 按钮跟着长高，而不是把内容裁掉。
 *
 * `sm` 的 24px 是 WCAG 2.5.8 的下限，不能再小；`md` 的 36px 是触控的常见建议值。
 * 这两条由 `Button.test.tsx` 钉住。
 */
const SIZE_CLASS: Record<ButtonSize, string> = {
  md: 'min-h-9 px-3 py-2 text-sm',
  sm: 'min-h-6 px-2 py-1 text-xs',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  /** React 19 里 `ref` 是普通 prop，会随 `...rest` 落到 `<button>` 上。 */
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const resolved = variant === 'default' ? 'secondary' : variant

  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition',
        'disabled:cursor-not-allowed disabled:opacity-40',
        SIZE_CLASS[size],
        VARIANT_CLASS[resolved],
        block && 'w-full',
        className,
      )}
      {...rest}
    />
  )
}
