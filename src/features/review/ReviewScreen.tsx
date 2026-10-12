import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { createReplayStore } from '../../store/replayStore'
import { ANALYSIS_BUDGET_MS, createAnalysisStore } from '../../store/analysisStore'
import type { GameRecord, GameRecordsStorage } from '../../persist/gameRecords'
import { DIFFICULTY_LABELS } from '../../ai/difficulty'
import { ENGINE_VERSION } from '../../ai/version'
import { formatPoint } from '../../lib/coords'
import { buildSummary, verdictLabel } from '../../analysis/analyze'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import { AppHeader } from '../shell/AppHeader'
import type { AiEngine } from '../../ai/engine'
import { GameLibrary } from './GameLibrary'
import { ReplayBoard } from './ReplayBoard'

export interface ReviewScreenProps {
  readonly storage: GameRecordsStorage
  readonly engine: AiEngine
  /**
   * 注入 store 实例（测试用）。生产不传，组件自己建——
   * 两个 store 是这一页的会话状态，离开就丢（回放游标不持久化是有意的）。
   */
  readonly stores?: {
    readonly replay: ReturnType<typeof createReplayStore>
    readonly analysis: ReturnType<typeof createAnalysisStore>
  }
}

/**
 * 复盘页：棋谱列表 → 逐手回放 → 引擎分析。
 *
 * 两个 store 用 ref 持有：它们是本页面的会话状态，离开页面即丢弃
 * （回放游标不持久化是有意的——它是浏览行为，不是进度）。
 */
export function ReviewScreen({ storage, engine, stores }: ReviewScreenProps) {
  // 惰性单例：useState 的初始化函数只跑一次，且不会在渲染期读 ref。
  const [ownReplay] = useState(createReplayStore)
  const [ownAnalysis] = useState(createAnalysisStore)
  const replay = stores?.replay ?? ownReplay
  const analysis = stores?.analysis ?? ownAnalysis

  // 离开复盘页就停掉分析：结果不再有人看，继续跑没有意义。
  // 注意 `stop()` 只能**丢弃结果**——引擎没有取消接口，已经发出去的那一次
  // 搜索仍会在共用的 Worker 上跑完（最多一个预算，400ms），之后不再发新的。
  // 回放也一并停。
  useEffect(() => {
    return () => {
      analysis.getState().stop()
      replay.getState().pause()
    }
  }, [analysis, replay])

  const [open, setOpen] = useState(false)

  function openRecord(record: GameRecord) {
    analysis.getState().stop()
    replay.getState().open(record)
    setOpen(true)
  }

  function closeRecord() {
    analysis.getState().stop()
    replay.getState().close()
    setOpen(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader />
      {open ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <Button onClick={closeRecord}>← 棋谱列表</Button>
          </div>
          <main className="flex min-h-0 flex-1 flex-col">
            <ReplayBoard
              store={replay}
              onExit={closeRecord}
              extraPanel={<AnalysisPanel store={analysis} engine={engine} replay={replay} />}
            />
          </main>
        </>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <GameLibrary storage={storage} onOpen={openRecord} />
        </main>
      )}
    </div>
  )
}

interface AnalysisPanelProps {
  readonly store: ReturnType<typeof createAnalysisStore>
  readonly engine: AiEngine
  readonly replay: ReturnType<typeof createReplayStore>
}

/**
 * 分析面板。
 *
 * 头部必须注明**引擎版本、档位与预算**——同一局面换个预算结论就可能不同，
 * 不写明出处等于给一个无法解读的分数。结论只呈现分差与推荐着法，
 * 不贴「失误」标签。
 */
function AnalysisPanel({ store, engine, replay }: AnalysisPanelProps) {
  const state = useAnalysis(store)
  const record = replay.getState().record

  if (record === null) return null

  // 分析固定用初级档：换档位结论就会变，界面必须把档位与预算一起标出来。
  // 预算不写死 400，读 ANALYSIS_BUDGET_MS——标注与实际用的必须是同一个数。
  const difficulty = 'easy' as const
  const budgetMs = ANALYSIS_BUDGET_MS

  function start() {
    const current = replay.getState().record
    if (current === null) return
    store.getState().start({ record: current, engine, difficulty, budgetMs })
  }

  // 榜单必须走 buildSummary：它保证「loss 为 0 的手（含与引擎一致）不进榜」。
  // 曾经这里自己 sort + slice，于是 analyze.ts 里那条过滤落在死代码上，
  // 界面照样把「与引擎一致」排进前三行。
  const verdicts = [...state.verdicts.values()]
  const topLosses = buildSummary(verdicts).topLosses

  return (
    <Panel title="引擎分析" bodyClassName="space-y-3 p-3.5">
      {/* 结论的出处必须写在最前面：换档位或预算，同一手的结论就可能不同 */}
      <p data-testid="analysis-source" className="text-[11px] text-faint">
        {DIFFICULTY_LABELS[difficulty]} · {budgetMs}ms · 引擎 {ENGINE_VERSION}
      </p>
      {!state.running && verdicts.length === 0 ? (
        <>
          <p className="text-xs text-faint">
            逐手跑一遍引擎，找出与引擎首选差得最多的几手。分析只读，不会改动棋谱。
          </p>
          <Button block variant="primary" onClick={start}>
            开始分析
          </Button>
        </>
      ) : state.running ? (
        <p className="text-xs text-muted">
          分析中… <span data-testid="analysis-progress">{state.verdicts.size} / {state.total}</span>
        </p>
      ) : (
        <div className="space-y-2">
          <p data-testid="analysis-progress" className="text-xs text-faint">
            已完成 {state.verdicts.size} / {state.total} 手
          </p>
          {topLosses.map((verdict) => (
            <div key={verdict.moveIndex} data-testid={`verdict-${verdict.moveIndex}`} className="rounded-lg border border-border p-2">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted">第 {verdict.moveIndex + 1} 手</span>
                <span className="text-fg">{verdictLabel(verdict)}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-faint">
                实际 {formatPoint(verdict.move)} · 引擎推荐 {formatPoint(verdict.engineMove)}
              </div>
              <div className="mt-0.5 text-[11px] text-faint">
                深度 {verdict.engineDepth} · 节点 {verdict.engineNodes} ·{' '}
                {verdict.confidence === 'exact' ? '搜索完成' : '预算内未搜完（启发式）'}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function useAnalysis(store: ReturnType<typeof createAnalysisStore>) {
  return useStore(store)
}
