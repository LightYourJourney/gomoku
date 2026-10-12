import type { Confidence, MoveSuggestion, Urgency } from '../../ai/types'
import { formatPoint } from '../../lib/coords'
import { cx } from '../../lib/cx'
import { threatLabel } from '../../lib/shape-labels'
import { HINT_BUDGET_MS } from '../../store/gameStore'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'

const URGENCY_LABELS: Record<Urgency, { label: string; tone: string }> = {
  win: { label: '必胜', tone: 'bg-accent-soft text-accent' },
  mustBlock: { label: '必须防守', tone: 'bg-danger-soft text-danger' },
  danger: { label: '危险', tone: 'bg-warn-soft text-warn' },
  normal: { label: '一般', tone: 'bg-surface-2 text-muted' },
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
  onClear: () => void
}

function Candidate({ suggestion, rank }: { suggestion: MoveSuggestion; rank: number }) {
  const { move, score, attack, defense } = suggestion

  return (
    <li
      data-testid={`hint-candidate-${move.x}-${move.y}`}
      className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">
        {rank}
      </span>
      <span className="font-mono text-xs font-semibold tabular-nums text-fg">
        {formatPoint(move)}
      </span>
      <span className="flex flex-wrap gap-1 text-xs">
        {attack !== 'none' && (
          <span className="rounded bg-accent-soft px-2 py-0.5 text-accent">
            进攻 {threatLabel(attack)}
          </span>
        )}
        {defense !== 'none' && (
          <span className="rounded bg-warn-soft px-2 py-0.5 text-warn">
            防守 {threatLabel(defense)}
          </span>
        )}
      </span>
      <span className="ml-auto font-mono text-xs tabular-nums text-faint">{score}</span>
    </li>
  )
}

/**
 * 提示的**结果**面板。
 *
 * **入口不在这里。** 「求提示」是棋盘下方工具栏上的一颗按钮（`ControlBar`）：
 * 任务书 §四 要求把常用操作收到棋盘附近，同时「不得导致同一请求被多个入口重复触发」。
 * 所以本面板只展示候选、紧急度、置信度，以及一个「收起」。
 */
export function HintPanel({ candidates, urgency, confidence, thinking, error, onClear }: HintPanelProps) {
  const shown = (candidates ?? []).slice(0, MAX_SHOWN)
  const badge = urgency === null ? null : URGENCY_LABELS[urgency]
  const showConfidence = confidence !== null && shown.length > 0

  return (
    <Panel title="AI 提示" bodyClassName="space-y-3">
      {shown.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear} aria-label="收起提示">
            收起
          </Button>

          {badge !== null && (
            <span
              data-testid="hint-urgency"
              className={cx('ml-auto rounded-full px-3 py-1 text-xs font-medium', badge.tone)}
            >
              {badge.label}
            </span>
          )}
        </div>
      )}

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
            用棋盘下方的「求提示」让引擎给出三个推荐着法，棋盘上会用编号标出。
            提示只做分析，不会替你落子。
          </p>
        )
      ) : (
        <ul className="space-y-2">
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
            'rounded-lg px-3 py-2 text-xs',
            confidence === 'heuristic' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted',
          )}
        >
          {CONFIDENCE_LABELS[confidence]}
        </p>
      )}

      {/*
        这段说明**只在真有候选时出现**（F-UI-03 的一半）。
        原先它无条件挂在面板底部：没求过提示的人一进对战页就先读到一段关于
        「800 ms 短预算」的技术介绍，而 `DESIGN_SYSTEM.md` §7 写明默认界面不出现
        内部参数这类东西。任务书 §六 也点了同一件事。
        完整的渐进披露（收进「?」）留 Phase 03。
      */}
      {shown.length > 0 && (
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-faint">
          提示用 {HINT_BUDGET_MS} ms 的短预算单独算一遍，与 AI 正式走子的搜索互不占用。
          它只是建议，不保证最优；局面一变（落子、悔棋、重开）标记就会自动清空。
        </p>
      )}
    </Panel>
  )
}
