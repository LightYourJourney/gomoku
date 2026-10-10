import type { Confidence, MoveSuggestion, ThreatKind, Urgency } from '../../ai/types'
import { formatPoint } from '../../lib/coords'
import { cx } from '../../lib/cx'
import { HINT_BUDGET_MS } from '../../store/gameStore'
import { Panel } from '../ui/Panel'

const URGENCY_LABELS: Record<Urgency, { label: string; tone: string }> = {
  win: { label: '必胜', tone: 'bg-accent-soft text-accent' },
  mustBlock: { label: '必须防守', tone: 'bg-danger-soft text-danger' },
  danger: { label: '危险', tone: 'bg-warn-soft text-warn' },
  normal: { label: '一般', tone: 'bg-surface-2 text-muted' },
}

const THREAT_LABELS: Record<ThreatKind, string> = {
  five: '成五',
  openFour: '活四',
  four: '冲四',
  openThree: '活三',
  three: '眠三',
  none: '无',
}

/** 展示多少个候选。与引擎侧的候选上限一致。 */
const MAX_SHOWN = 3

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  exact: '结论：精确',
  heuristic: '结论：启发式，不保证最优',
}

export interface HintPanelProps {
  /** 按推荐度降序。null 表示还没求过提示。 */
  candidates: readonly MoveSuggestion[] | null
  urgency: Urgency | null
  /** 这份提示是精确结论还是预算用尽后的启发式建议。 */
  confidence: Confidence | null
  thinking: boolean
  error: string | null
  /** 此刻能不能求提示：轮到自己、对局进行中、且没有请求在飞。 */
  canAsk: boolean
  onAsk: () => void
  onClear: () => void
}

function Candidate({ suggestion, rank }: { suggestion: MoveSuggestion; rank: number }) {
  const { move, score, attack, defense } = suggestion

  return (
    <li
      data-testid={`hint-candidate-${move.x}-${move.y}`}
      className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">
        {rank}
      </span>
      <span className="font-mono text-xs font-semibold tabular-nums text-fg">
        {formatPoint(move)}
      </span>
      <span className="flex flex-wrap gap-1 text-[11px]">
        {attack !== 'none' && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">
            进攻 {THREAT_LABELS[attack]}
          </span>
        )}
        {defense !== 'none' && (
          <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">
            防守 {THREAT_LABELS[defense]}
          </span>
        )}
      </span>
      <span className="ml-auto font-mono text-[11px] tabular-nums text-faint">{score}</span>
    </li>
  )
}

export function HintPanel({
  candidates,
  urgency,
  confidence,
  thinking,
  error,
  canAsk,
  onAsk,
  onClear,
}: HintPanelProps) {
  const shown = (candidates ?? []).slice(0, MAX_SHOWN)
  const badge = urgency === null ? null : URGENCY_LABELS[urgency]
  const showConfidence = confidence !== null && shown.length > 0

  return (
    <Panel title="AI 提示" bodyClassName="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAsk}
          disabled={!canAsk || thinking}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          求提示
        </button>

        {shown.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label="收起提示"
            className="text-xs font-medium text-muted underline underline-offset-2 transition hover:text-fg"
          >
            收起
          </button>
        )}

        {badge !== null && shown.length > 0 && (
          <span
            data-testid="hint-urgency"
            className={cx('ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium', badge.tone)}
          >
            {badge.label}
          </span>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {thinking ? (
        <p className="text-xs text-muted">正在计算提示…</p>
      ) : shown.length === 0 ? (
        error === null && (
          <p className="text-xs text-faint">
            点「求提示」让引擎给出三个推荐着法，棋盘上会用编号标出。提示只做分析，不会替你落子。
          </p>
        )
      ) : (
        <ul className="space-y-1.5">
          {shown.map((suggestion, index) => (
            <Candidate
              key={`${suggestion.move.x},${suggestion.move.y}`}
              suggestion={suggestion}
              rank={index + 1}
            />
          ))}
        </ul>
      )}

      {showConfidence && (
        <p
          data-testid="hint-confidence"
          className={cx(
            'rounded-lg px-3 py-2 text-[11px]',
            confidence === 'heuristic' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted',
          )}
        >
          {CONFIDENCE_LABELS[confidence]}
        </p>
      )}

      <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
        提示用 {HINT_BUDGET_MS} ms 的短预算单独算一遍，与 AI 正式走子的搜索互不占用。
        它只是建议，不保证最优；局面一变（落子、悔棋、重开）标记就会自动清空。
      </p>
    </Panel>
  )
}
