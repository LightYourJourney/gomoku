import { cx } from '../../lib/cx'

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean
  readonly hint?: string
}

export interface SegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  label: string
  columns?: number
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  columns,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-lg bg-surface-2 p-1"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cx(
              'rounded-md px-1.5 py-1.5 text-xs font-medium whitespace-nowrap transition',
              active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
              option.disabled === true && 'cursor-not-allowed opacity-40 hover:text-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
