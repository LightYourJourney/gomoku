export interface ReplayTimelineProps {
  /** 已看到第几手（0 = 空盘）。 */
  readonly cursor: number
  /** 总手数。 */
  readonly total: number
  /** 定位到第 N 手之后。调用方负责暂停播放——那是 store 的规则。 */
  readonly onSeek: (index: number) => void
}

/**
 * 回放时间轴。
 *
 * **用原生 `<input type="range">` 而不是自绘的进度条**：键盘（方向键 / Home / End）、
 * `role="slider"`、`aria-valuenow/min/max` 全是白送的——任务书 §五 要的
 * 「键盘可操作 + 有可访问标签」用它最省，也最不容易做错。
 *
 * 两处容易踩的：
 *
 * 1. **高度必须显式给足**。原生 range 的默认盒子只有 16px 高，而探针的
 *    命中区判据（`ui.probe.mjs` 第 5 条）会把 < 24px 的可交互元素判红，
 *    棋盘交叉点是唯一豁免。`h-7`（28px）留了余量，不贴着 24 那条线走。
 * 2. **`aria-valuetext` 要说人话**。读屏默认念裸数字（"5"），而这个控件的
 *    量纲是**手**——念成「第 5 手，共 9 手」才不需要用户自己换算。
 *
 * 0 手局（认输时一手没走）整条禁用：那时 `max` 与 `value` 都是 0，
 * 滑块没有可动区间。
 */
export function ReplayTimeline({ cursor, total, onSeek }: ReplayTimelineProps) {
  const disabled = total === 0

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">进度</span>
        <span data-testid="timeline-counter" className="font-mono tabular-nums text-faint">
          {cursor} / {total} 手
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={total}
        step={1}
        value={cursor}
        disabled={disabled}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="回放手数"
        aria-valuetext={`第 ${cursor} 手，共 ${total} 手`}
        className="h-7 w-full cursor-pointer [accent-color:var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  )
}
