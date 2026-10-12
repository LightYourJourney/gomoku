import { cx } from '../../lib/cx'
import type { GameStatusDescriptor, StatusTone } from '../../features/battle/status'
import { StoneDot } from './StoneDot'

const TONE_CLASS: Record<StatusTone, string> = {
  playing: 'border-border bg-surface text-fg',
  thinking: 'border-accent/35 bg-accent-soft text-accent',
  result: 'border-transparent bg-fg text-bg',
}

export interface StatusPillProps {
  status: GameStatusDescriptor
  /**
   * 是否真有请求在飞（`aiThinking` / `hintThinking`）。
   *
   * **转圈的判据是它，不是 `status.tone`。** `describeStatus` 在人机模式下
   * 只要轮到 AI 就返回 `tone: 'thinking'`——包括「轮到 AI」但根本没在思考的时候
   * （引擎报错后卡住、点重试之前）。照 `tone` 渲染转圈的话，转圈的语义
   * 「正在进行」就成了假话（发现 F-UI-06：截图里药丸写着「轮到 AI」而圈照转，
   * 同一屏的引擎面板是红的）。玩家会继续等，而不是去点「重试」。
   */
  busy?: boolean
}

/**
 * 状态药丸。**不是 live region**：播报交给 `BoardAnnouncer` 一处，
 * 两个 `role="status"` 会把同一件事念两遍。这里是给眼睛看的。
 *
 * 位置由调用方决定——对战页把它放进棋盘上方的状态条（`MatchBar`）里。
 */
export function StatusPill({ status, busy = false }: StatusPillProps) {
  const spinning = status.tone === 'thinking' && busy

  return (
    <div
      data-testid="status-pill"
      className={cx(
        // `py-1.5` 而不是 `py-2`：这一条的高度直接压棋盘（对战页中列的纵向预算，见
        // `BattleScreen` 的注释）。34px 对一枚状态标签足够，视觉上差不出半个字。
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
        TONE_CLASS[status.tone],
      )}
    >
      {spinning ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        status.player !== null && <StoneDot player={status.player} />
      )}
      <span className="whitespace-nowrap">{status.label}</span>
    </div>
  )
}
