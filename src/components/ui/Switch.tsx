import { useId } from 'react'
import { cx } from '../../lib/cx'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}

/**
 * 整行都是点击目标，只有这一个可交互元素。
 *
 * **名字与说明分开**：说明用 `aria-describedby` 关联，不是靠「可访问名 = 整个按钮的文字」
 * 顺带带出来的。两者的区别在读者那一端很实在——混在一起时，可访问名会变成
 * 「显示坐标棋盘四周标注 A–O / 1–15」，读屏用户每听到一个开关都要把说明念完
 * 才知道这是哪一个；而且列表里的开关名长短不一，扫读时对不齐。
 *
 * 用 `aria-labelledby` 而不是 `aria-label`：名字仍然来自屏幕上真实存在的那段文字，
 * 改了文案不会出现「看得见的字与念出来的名字对不上」。
 */
export function Switch({ checked, onChange, label, description }: SwitchProps) {
  const labelId = useId()
  const descriptionId = useId()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left transition hover:bg-surface-2 active:brightness-95"
    >
      <span className="min-w-0">
        <span id={labelId} className="block text-sm text-fg">
          {label}
        </span>
        {description !== undefined && (
          <span id={descriptionId} className="mt-1 block text-xs text-faint">
            {description}
          </span>
        )}
      </span>
      {/* 轨道与滑块纯装饰：状态已经由 aria-checked 表达，念一遍「开关 已开启」就够 */}
      <span
        aria-hidden="true"
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
