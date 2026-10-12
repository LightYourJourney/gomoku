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
}

/**
 * 顶部状态药丸。**不是 live region**：播报交给 `BoardAnnouncer` 一处，
 * 两个 `role="status"` 会把同一件事念两遍。这里是给眼睛看的。
 */
export function StatusPill({ status }: StatusPillProps) {
  return (
    <div
      data-testid="status-pill"
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors',
        TONE_CLASS[status.tone],
      )}
    >
      {status.tone === 'thinking' ? (
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
