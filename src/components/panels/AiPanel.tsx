import type { SearchReason } from '../../ai/types'
import { cx } from '../../lib/cx'
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
  /** AI 还没能落子。此时不给重试入口，玩家就只能重开或认输了。 */
  canRetry: boolean
  onRetry: () => void
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

export function AiPanel({ thinking, info, error, canRetry, onRetry, onDismissError }: AiPanelProps) {
  return (
    <Panel title="AI 引擎">
      {/*
        重试入口的显隐只由 canRetry 决定，不能挂在「有没有错误消息」下面——
        玩家一点「知道了」，错误清了，可 AI 欠着的那一手还在，入口却跟着消失，
        对局就彻底卡死了。
      */}
      {(error !== null || canRetry) && (
        <div
          role="alert"
          className={cx(
            'mb-3 rounded-lg px-3 py-2 text-xs',
            error !== null ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn',
          )}
        >
          <p className="break-words">{error ?? 'AI 还没落子，这一手需要重试。'}</p>
          <div className="mt-1.5 flex items-center gap-3">
            {canRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="font-medium underline underline-offset-2"
              >
                重试
              </button>
            )}
            {error !== null && (
              <button
                type="button"
                onClick={onDismissError}
                className="font-medium underline underline-offset-2"
              >
                知道了
              </button>
            )}
          </div>
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
        引擎跑在 Web Worker 里，用 Negamax + Alpha-Beta 迭代加深，配 Zobrist 置换表与
        杀手着法；中级以上还会先跑一遍算杀（连续冲四）。「搜索深度」是已经完整搜完的层数——
        时间预算不够时会退回上一层的结果，所以它不是固定的。
      </p>
    </Panel>
  )
}
