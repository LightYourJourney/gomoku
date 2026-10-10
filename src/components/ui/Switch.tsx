import { cx } from '../../lib/cx'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}

/** 整行都是点击目标，只有这一个可交互元素，读屏软件读到的名字就是 label。 */
export function Switch({ checked, onChange, label, description }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left transition hover:bg-surface-2"
    >
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {description !== undefined && (
          <span className="mt-0.5 block text-xs text-faint">{description}</span>
        )}
      </span>
      <span
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-full transition',
          checked ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
    </button>
  )
}
