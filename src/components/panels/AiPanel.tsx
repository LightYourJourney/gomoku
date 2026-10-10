import type { SearchReason } from '../../ai/types'
import type { AiInfo } from '../../store/gameStore'
import { Panel } from '../ui/Panel'

const REASON_LABELS: Record<SearchReason, string> = {
  win: '直接取胜',
  block: '必须防守',
  search: '搜索结果',
  opening: '开局天元',
  timeout: '超时回退',
  no_move: '无棋可走',
}

const CONFIDENCE_LABELS = {
  exact: '精确',
  heuristic: '启发式',
} as const

export interface AiPanelProps {
  thinking: boolean
  info: AiInfo | null
  error: string | null
  onDismissError: () => void
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="mt-0.5 font-mono text-xs tabular-nums text-fg">{value}</div>
    </div>
  )
}

export function AiPanel({ thinking, info, error, onDismissError }: AiPanelProps) {
  return (
    <Panel title="AI 引擎">
      {error !== null && (
        <div
          role="alert"
          className="mb-3 flex items-start justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="shrink-0 font-medium underline underline-offset-2"
          >
            知道了
          </button>
        </div>
      )}

      {thinking ? (
        <p className="py-2 text-xs text-muted">正在 Web Worker 中搜索，主线程不受影响…</p>
      ) : info === null ? (
        <p className="py-2 text-xs text-faint">尚未产生分析结果。</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="判断" value={REASON_LABELS[info.reason]} />
            <Stat label="结论" value={CONFIDENCE_LABELS[info.confidence]} />
            <Stat label="搜索深度" value={`${info.depth} 层`} />
            <Stat label="搜索节点" value={String(info.nodes)} />
            <Stat label="耗时" value={`${info.elapsedMs} ms`} />
            <Stat label="局面评分" value={String(info.score)} />
          </div>

          {info.confidence === 'heuristic' && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] text-warn">
              时间预算内未搜完，这一手是启发式建议，不保证最优。
            </p>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
        Phase 1 的引擎使用棋型评分与 1–2 层 Negamax 搜索，能识破直接取胜与必须防守。
        更深的迭代加深、置换表与算杀将在 Phase 2 接入。
      </p>
    </Panel>
  )
}
