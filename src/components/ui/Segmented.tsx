import { useRef, type KeyboardEvent } from 'react'
import { cx } from '../../lib/cx'

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean
  /** 悬停提示。省略时用 `label` 兜底——窄栏里标签会被截断，得留一条看全文的路。 */
  readonly hint?: string
}

export interface SegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  label: string
  columns?: number
  /**
   * 变更**前**的拦截钩子。返回 `false` 表示这次不算数：**不换选中、也不搬焦点**。
   *
   * 对战页用它做防误触确认（切换模式 / 执子会重开一局）——那时它会顺手把确认弹窗
   * 打开，所以**它允许有副作用，别当成纯谓词**：名字取 `beforeChange` 而不是
   * `canChange` 就是这个意思。
   *
   * 为什么不直接在 `onChange` 里拦（拦截点放回调里就够了）：键盘路径是
   * 「先 `onChange`、再 `focus()` 到新选项」，拦在 `onChange` 里的话焦点已经走了
   * ——取消之后焦点落在那个 `aria-checked=false` 且 `tabIndex=-1` 的选项上，
   * 整组的 Tab 停靠点说选中的是 A、焦点却在 B。
   *
   * **它被调用时 `onChange` 就不会被调用**，所以「拦截」这件事必须整个写在这里，
   * 不能一半在钩子里一半在回调里——那样返回 `false` 时两边都不动，什么也不会发生。
   */
  beforeChange?: (next: T) => boolean
}

/** 方向键的两种惯例都要支持：radiogroup 里左右与上下是等价的。 */
const STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/**
 * 分段控件（单选）。
 *
 * **键盘走的是 radiogroup 的既定模式，不是「一排按钮」**：
 * 整组只有一个 Tab 停靠点，组内用方向键移动，选中跟着焦点走。
 * 两件事必须同时做——`onChange` 与真的 `focus()`：只改选中不搬焦点，
 * 读屏软件（跟的是真实焦点）会停在原地，键盘用户以为按键没反应。
 * 这与 `Board` 的 roving tabindex 是同一条约定。
 *
 * 到两端即停、不绕回；禁用的选项会被跳过。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  columns,
  beforeChange,
}: SegmentedProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>())

  const enabled = options.filter((option) => option.disabled !== true)
  const selectedIndex = enabled.findIndex((option) => option.value === value)
  // 选中的那一项是停靠点；万一它被禁用了（不该发生，但不能让它锁死键盘），退回第一项
  const stopValue = enabled[selectedIndex === -1 ? 0 : selectedIndex]?.value

  /** 被否决时把焦点收回选中项——不让它停在 `aria-checked=false` 的选项上。 */
  function snapBackToSelection(): void {
    buttons.current.get(value)?.focus()
  }

  function moveTo(next: T | undefined): void {
    if (next === undefined || next === value) return
    if (beforeChange?.(next) === false) return
    onChange(next)
    buttons.current.get(next)?.focus()
  }

  function step(current: T, delta: number): T | undefined {
    const index = enabled.findIndex((option) => option.value === current)
    if (index === -1) return undefined
    return enabled[index + delta]?.value
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: T): void {
    const delta = STEP[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      moveTo(step(current, delta))
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const target = event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]
      moveTo(target?.value)
    }
  }

  function handleClick(next: T): void {
    /*
     * **点已经选中的那一项什么都不做**——radiogroup 的既定语义就是如此
     * （ARIA：选中项被再次激活不产生变更事件），键盘路径 `moveTo` 也是这么判的。
     *
     * 少了这一行会出真事，而且两头都不对：
     * - 不拦的调用方（例如 `setDifficulty`）本来只是白白跑一遍；
     * - **会重建棋局的调用方更糟**：`setMode('pve')` 在已经是人机模式时仍然 `newGame()`，
     *   于是「点一下当前高亮的那个选项」把进行中的棋局清掉了；
     * - 而本阶段加了确认之后，它还会先弹一句「切换对战模式？」——
     *   用户根本没切换什么，却拿到一个破坏性确认。
     *
     * 焦点不在这里搬：浏览器在点击（mousedown）时就已经把它给了被点的这一颗，
     * 与下面 `onChange(next)` 那条路径一样，交给浏览器。
     * 这里曾经显式 `focus()` 了一次，**但它量不到**——撤掉之后用例照样全绿
     * （user-event 在 mousedown 阶段就 focus 了），按「不做没验证的复杂度」删掉。
     */
    if (next === value) return

    if (beforeChange?.(next) === false) {
      // 浏览器已经先把焦点给了被点的这一颗，收回来
      snapBackToSelection()
      return
    }
    onChange(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-lg bg-surface-2 p-1"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value
        const disabled = option.disabled === true

        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node === null) buttons.current.delete(option.value)
              else buttons.current.set(option.value, node)
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            // 整组只有一个 Tab 停靠点；组内靠方向键走
            tabIndex={!disabled && option.value === stopValue ? 0 : -1}
            title={option.hint ?? option.label}
            onClick={() => handleClick(option.value)}
            onKeyDown={(event) => handleKeyDown(event, option.value)}
            className={cx(
              'min-w-0 truncate rounded-md px-2 py-2 text-xs font-medium transition',
              active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
              disabled && 'cursor-not-allowed opacity-40 hover:text-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
