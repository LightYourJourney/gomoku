import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { createReplayStore } from '../../store/replayStore'
import { ANALYSIS_BUDGET_MS, createAnalysisStore } from '../../store/analysisStore'
import type { GameRecord, GameRecordsStorage } from '../../persist/gameRecords'
import { DIFFICULTY_LABELS } from '../../ai/difficulty'
import { ENGINE_VERSION } from '../../ai/version'
import { formatPoint } from '../../lib/coords'
import { buildSummary, pathSummary, verdictLabel } from '../../analysis/analyze'
import { searchPathOf } from '../../ai/types'
import { cx } from '../../lib/cx'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import { PageShell } from '../shell/PageShell'
import type { AiEngine } from '../../ai/engine'
import { useLearnStore } from '../../store/learnStore'
import { useSettingsStore } from '../../store/settingsStore'
import { loadProgress, mergeProgress } from '../../persist/progress'
import { loadSession, saveSession, SCHEMA_VERSION, type PersistedSession } from '../../persist/storage'
import { indexedDbPositions, type PositionStorage } from '../../persist/positions'
import type { DataManagementServices } from './DataManagementPanel'
import { GameLibrary } from './GameLibrary'
import { PositionEditor } from '../positions/PositionEditor'
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
  /**
   * 恢复备份里的进行中对局。**由 App 注入**：`useGameStore` 在模块加载时就
   * 创建 Worker，不能为了一个回调把它拖进组件测试（jsdom 没有 Worker）。
   */
  readonly onRestoreSession?: (session: PersistedSession) => void
  /** 测试可注入；生产默认用 IndexedDB 局面库。 */
  readonly positions?: PositionStorage
}

/**
 * 复盘页：棋谱列表 → 逐手回放 → 引擎分析。
 *
 * 两个 store 用 ref 持有：它们是本页面的会话状态，离开页面即丢弃
 * （回放游标不持久化是有意的——它是浏览行为，不是进度）。
 */
export function ReviewScreen({ storage, engine, stores, onRestoreSession, positions }: ReviewScreenProps) {
  // 惰性单例：useState 的初始化函数只跑一次，且不会在渲染期读 ref。
  const [ownReplay] = useState(createReplayStore)
  const [ownAnalysis] = useState(createAnalysisStore)
  const replay = stores?.replay ?? ownReplay
  const analysis = stores?.analysis ?? ownAnalysis

  // 空状态那颗「开始一局对战」要真的切页面，所以得够得着导航。
  // 与 `PuzzleScreen` 同法：页面自己连 store，不让展示组件去连。
  const setView = useLearnStore((state) => state.setView)
  const adoptProgress = useLearnStore((state) => state.adoptProgress)

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
  const [editorOpen, setEditorOpen] = useState(false)

  /*
   * 数据管理的能力注入。`Date.now` 只传引用、不在这里调用——文件名的时间戳
   * 由导出器在真正需要时取；测试可以换成固定时钟。
   */
  const dataServices: DataManagementServices = {
    now: Date.now,
    loadProgress,
    loadSession,
    preferences: () => {
      const settings = useSettingsStore.getState()
      return {
        theme: settings.theme,
        showCoords: settings.showCoords,
        soundEnabled: settings.soundEnabled,
      }
    },
    onMergeProgress: async (incoming) => {
      // 用**内存里的当前进度**合并：用户可能刚完成一节课，写入队列还没落盘；
      // 这时先 loadProgress() 会读到旧值，合并完反而把刚完成的那一项盖掉。
      const live = useLearnStore.getState()
      const current = live.loaded ? live.progress : await loadProgress()
      const merged = mergeProgress(current, incoming)
      // `adoptProgress` 自己会走学习进度的串行写队列；这里不再额外 save，
      // 否则同一份进度会被写两次。
      adoptProgress(merged)
    },
    onRestorePreferences: (preferences) => {
      const settings = useSettingsStore.getState()
      settings.setTheme(preferences.theme)
      settings.setShowCoords(preferences.showCoords)
      settings.setSoundEnabled(preferences.soundEnabled)
    },
    onRestoreSession: (session) => {
      const persisted = { ...session, schemaVersion: SCHEMA_VERSION }
      if (!saveSession(persisted)) throw new Error('会话写入失败')
      onRestoreSession?.(persisted)
    },
  }

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

  if (editorOpen) {
    return (
      <PositionEditor
        engine={engine}
        records={storage}
        positions={positions ?? indexedDbPositions}
        onExit={() => setEditorOpen(false)}
      />
    )
  }

  if (open) {
    return (
      <PageShell
        /*
         * `key` 是必须的：两个分支返回的都是 `<PageShell>`（同类型、同位置），
         * React 会复用同一个实例——于是 `useFocusOnMount` 的 effect 不重跑，
         * 点开一局棋谱之后焦点照样掉回 `<body>`。换 key 把它们变成两棵树。
         * （教学页不需要：`LearnScreen` 进课程时返回的是根类型完全不同的
         * `<LessonView>`，`PageShell` 本来就是新建的。）
         *
         * 代价，如实记：换 key 让 `PageShell` 连同那个 `overflow-y-auto` 的
         * `main` 一起重建，于是从回放返回列表时滚动位置回到顶部（换 key 之前
         * `main` 是复用的，位置会保留）。接受它——列表本来就因为 `GameLibrary`
         * 重挂载而重新读盘，「进入一页从顶部开始」也是常规语义；不为此放弃
         * 焦点修复，也不值得为它给 `PageShell` 加一个只服务本页的 prop。
         */
        key="replay"
        variant="flush"
        toolbar={
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <Button onClick={closeRecord}>← 棋谱列表</Button>
            {/*
              这一页此前**整页没有一级标题**（`FINDINGS.md` 的标题表记着：
              只有 `h2 回放` 与 `h2 引擎分析`）。教学练习页与残局详情页
              在 Phase 04/05 都修过同一个毛病，这里是第三处。
              叫「棋谱回放」而不是「回放」——右栏已经有一个 `Panel title="回放"`
              会渲染成 `h2`，一模一样的两级标题谁也说不清哪个是哪个。
            */}
            <h1 className="truncate text-xl font-semibold text-fg">棋谱回放</h1>
          </div>
        }
      >
        <ReplayBoard
          store={replay}
          onExit={closeRecord}
          extraPanel={<AnalysisPanel store={analysis} engine={engine} replay={replay} />}
        />
      </PageShell>
    )
  }

  return (
    <PageShell key="library">
      <GameLibrary
        storage={storage}
        onOpen={openRecord}
        onStartBattle={() => setView('battle')}
        services={dataServices}
        onOpenEditor={() => setEditorOpen(true)}
      />
    </PageShell>
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
  // 订阅整个回放状态：游标一动，选中态与「当前手」那行都要跟着变。
  const { record, cursor } = useReplay(replay)

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

  /*
   * **结论属于哪一局**。
   *
   * `stop()` 会把 `target` 置空却**不动 `verdicts` 与 `total`**，于是换到另一局
   * 之后，面板会拿上一局的结论与计数继续渲染（`AnalysisPanel` 原先只判
   * `record === null`，不判这一层）。`target` 里带着 `seq`，比一下就知道——
   * 不相等就按「还没分析过」渲染。零新状态、零 store 改动。
   */
  const belongsToThisGame = state.target !== null && state.target.seq === record.seq
  const verdicts = belongsToThisGame ? [...state.verdicts.values()] : []
  const total = belongsToThisGame ? state.total : 0

  // 榜单必须走 buildSummary：它保证「loss 为 0 的手（含与引擎一致）不进榜」。
  // 曾经这里自己 sort + slice，于是 analyze.ts 里那条过滤落在死代码上，
  // 界面照样把「与引擎一致」排进前三行。
  const topLosses = buildSummary(verdicts).topLosses

  /*
   * 「当前选中」**不新增状态**：它就是游标所指的那一手。
   * 手动走步走到同一手，高亮也一样亮——不可能出现「棋盘在第 5 手、
   * 面板说选中第 7 手」。cursor = 0（空盘）时没有当前手，`-1` 不匹配任何下标。
   */
  const selectedMoveIndex = cursor - 1
  const currentVerdict = belongsToThisGame ? state.verdicts.get(selectedMoveIndex) : undefined

  return (
    <Panel title="引擎分析" bodyClassName="space-y-3">
      {/* 结论的出处必须写在最前面：换档位或预算，同一手的结论就可能不同 */}
      <p data-testid="analysis-source" className="text-xs text-faint">
        {DIFFICULTY_LABELS[difficulty]} · {budgetMs}ms · 引擎 {ENGINE_VERSION}
      </p>
      {/*
        任务书 §八 的「技术与来源信息」里点名要有**「分数的含义和局限」**。
        没有这句，「分差约 3 子」会被当成精确值——而它只是棋型评分的粗略换算
        （`analyze.ts` 的 `verdictLabel` 注释写了同一件事，但那是代码注释，
        用户看不到）。预算内没搜完的手连这个都只能算启发式。
      */}
      <p data-testid="analysis-caveat" className="text-xs text-faint">
        分差按棋型评分粗算，不是精确子数；标「启发式」的手没搜完，结论更粗。
      </p>
      {state.error !== null && state.running === false ? (
        /*
         * 分析失败要**说出来**。原先 `error` 只是躺在 store 里没人渲染，
         * 失败之后界面静默退回「开始分析」按钮——与「从没分析过」长得一模一样。
         */
        <>
          <p data-testid="analysis-error" className="text-xs text-warn">
            这次分析没跑完：{state.error}
          </p>
          <Button block variant="primary" onClick={start}>
            重新分析
          </Button>
        </>
      ) : record.moves.length === 0 ? (
        /*
         * 一步都没走就认输：没有可分析的手，不摆那颗「开始分析」。
         * `start` 对这种局面会立刻收尾（`running` 置回 false、`verdicts`
         * 仍为空），面板又渲染回这颗按钮——按下去与没按过长得一模一样，
         * 正是任务书 §二 说的「只有外观、没有实际效果的按钮」。
         */
        <p data-testid="analysis-empty" className="text-xs text-faint">
          这一局没有落子，没有可分析的手。
        </p>
      ) : !state.running && verdicts.length === 0 ? (
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
          分析中…{' '}
          <span data-testid="analysis-progress">
            {verdicts.length} / {total}
          </span>
        </p>
      ) : (
        <div className="space-y-2">
          <p data-testid="analysis-progress" className="text-xs text-faint">
            已完成 {verdicts.length} / {total} 手
          </p>

          {cursor > 0 && (
            <p data-testid="analysis-current" className="text-xs text-muted">
              当前第 {cursor} 手：
              {/*
                取不到结论 ≠ 结论是「没亏损」。
                `verdicts` 里**装着** loss 为 0 的手（`buildVerdict` 总会产出一条，
                而「与引擎一致」正是 `verdictLabel` 的一个分支），所以取不到只有
                两种可能：这一手被跳过了（引擎对某个局面答「无棋可走」，
                `analysisStore` 不编结论，见那边的注释），或者分析没跑到它。
                两种都该如实说——原先这里一律说成「与引擎一致，没有亏损」，
                store 拒绝编造，界面替它编了。
              */}
              {currentVerdict === undefined
                ? '没有分析结果。'
                : `${verdictLabel(currentVerdict)}${
                    currentVerdict.confidence === 'exact' ? '' : '（启发式）'
                  }`}
            </p>
          )}

          {topLosses.map((verdict) => {
            const selected = verdict.moveIndex === selectedMoveIndex
            return (
              <button
                key={verdict.moveIndex}
                type="button"
                data-testid={`verdict-${verdict.moveIndex}`}
                data-selected={selected}
                /*
                 * 跳转就是这一行。`moveIndex` 是**零基**的着法序号，
                 * 而 `goTo` 的游标语义是「已看到第几手」——第 17 手之后
                 * 即 cursor = 17 = moveIndex + 1，两者恰好对齐，不需要补丁。
                 */
                onClick={() => replay.getState().goTo(verdict.moveIndex + 1)}
                /*
                 * 选中**只改边框，不改底色**。
                 *
                 * 第一版写的是 `border-accent bg-accent-soft`——探针当场报了 16 处
                 * 对比度违规：卡片里那两行是 `text-faint`，铺上 `accent-soft` 之后
                 * 浅色掉到 4.49:1（判据要 4.5）、深色只有 3.91:1。
                 * **换底色却不换文字色**，正是下面否决「给当前手换 tone」的同一条理由，
                 * 结果在另一处又踩了一次。边框变强调色已经够「适度突出」，
                 * 而它一个像素的对比度都不动。
                 */
                className={cx(
                  'w-full rounded-lg border p-2 text-left transition',
                  selected ? 'border-accent' : 'border-border hover:border-border-strong',
                )}
              >
                <div className="flex items-baseline justify-between text-xs">
                  <span className={selected ? 'text-accent' : 'text-muted'}>
                    第 {verdict.moveIndex + 1} 手
                  </span>
                  <span className="text-fg">{verdictLabel(verdict)}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-faint">
                  实际 {formatPoint(verdict.move)} · 引擎推荐 {formatPoint(verdict.engineMove)}
                </div>
                <div className="mt-1 text-xs text-faint">
                  深度 {verdict.engineDepth} · 节点 {verdict.engineNodes} ·{' '}
                  {pathSummary(searchPathOf(verdict.reason), verdict.confidence)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function useAnalysis(store: ReturnType<typeof createAnalysisStore>) {
  return useStore(store)
}

function useReplay(store: ReturnType<typeof createReplayStore>) {
  return useStore(store)
}
