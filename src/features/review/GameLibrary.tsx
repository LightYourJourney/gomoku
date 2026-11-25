import { useEffect, useId, useRef, useState } from 'react'
import { BLACK } from '../../core/types'
import { DIFFICULTY_LABELS } from '../../ai/difficulty'
import type { GameRecord, GameRecordList, GameRecordsStorage } from '../../persist/gameRecords'
import { PageHeader } from '../../components/ui/PageHeader'
import { Panel } from '../../components/ui/Panel'
import { Button } from '../../components/ui/Button'
import { DataManagementPanel, type DataManagementServices } from './DataManagementPanel'
import { exportFilename, toGameFile } from '../../persist/transfer/format'
import { downloadJson } from './download'
import { indexedDbPositions, type PositionStorage } from '../../persist/positions'
import { formatLocalMinute } from '../../lib/time-format'

export interface GameLibraryProps {
  readonly storage: GameRecordsStorage
  readonly onOpen: (record: GameRecord) => void
  /** 空状态那颗主操作。**必须真的切到对战页**——不渲染只会摆样子的按钮。 */
  readonly onStartBattle: () => void
  /** 生产环境注入；测试不传时不渲染数据面板与单盘导出。 */
  readonly services?: DataManagementServices
  readonly positions?: PositionStorage
  /** 打开局面编辑器；测试/未接线时不渲染入口。 */
  readonly onOpenEditor?: () => void
}

/** 结果一栏的人话：谁赢了 / 认输 / 和棋。 */
function resultLabel(record: GameRecord): string {
  if (record.winner === null) return '和棋'
  const winnerName = record.winner === BLACK ? '黑' : '白'
  return record.resignedBy !== null ? `${winnerName}方胜（对手认输）` : `${winnerName}方胜`
}

/**
 * 一行说明：怎么打的、多少手。
 *
 * **人机局补上难度档**（F-UI-22）：棋谱里最能解释「这局为什么长这样」的就是它，
 * 而它本来就在 `record.difficulty` 里躺着。双人局不标——那里没有 AI 难度，
 * 硬写一个「入门」是在编。
 */
function metaLabel(record: GameRecord): string {
  const mode = record.mode === 'pve' ? '人机' : '双人'
  const difficulty = record.mode === 'pve' ? ` · ${DIFFICULTY_LABELS[record.difficulty]}` : ''
  return `${mode}${difficulty} · ${record.moves.length} 手`
}

/** 这局下完的时间。阶段 D 之前的棋谱没有时间，如实说，不编造。 */
function timeLabel(record: GameRecord): string {
  return (record.createdAt === null ? null : formatLocalMinute(record.createdAt)) ?? '时间未知'
}

/**
 * 这一局在按钮可访问名里的称呼：结果 + 时间 + 列表里第几条，都是界面上看得到、数得出的。
 * 原先用的是内部的 `seq`（「删除棋谱 17」），读屏念出一个屏幕上找不到的编号；
 * 只用「结果 + 时间」又会重名——阶段 D 之前的旧记录全是「时间未知」，同一分钟同结果的两局也一样，
 * 读屏用户分不出要删哪一局。所以补上序号。
 */
function recordName(record: GameRecord, index: number): string {
  return `：${resultLabel(record)}，${timeLabel(record)}（第 ${index + 1} 条）`
}

/** 一批显示多少局。5,000 局全量渲染是 3 万个元素、首屏 433 ms（评估报告 §4.6）；分批够用，不上虚拟列表。 */
const PAGE_SIZE = 50

/** 被跳过的棋谱条数说明——空库与列表上方说的是同一句话。 */
function skippedNote(count: number): string {
  return `另有 ${count} 条棋谱读不出来，多半是更早的版本留下的。`
}

/**
 * 空状态的图形标识。
 *
 * 画四条线加两颗子，一眼是五子棋。**不用 emoji**（`AGENTS.md` 明令禁止拿它
 * 充当最终视觉），也**不放"示例棋谱"**——任务书 §二 说了本阶段不做示例数据，
 * 一个装饰图形不会被人当成真实对局。
 */
function LibraryGlyph() {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className="mx-auto h-12 w-12"
      data-testid="library-glyph"
    >
      {/*
        网格线用 `--c-grid`——`Board.tsx` 的 `board-grid` 本身用的就是它。
        原先写的是 `--c-border-strong`，那个令牌在 `DESIGN_SYSTEM.md` §2.2 里的
        用途是「控件的 hover 描边、开关的关闭态」，禁用途一栏明写「**常态**」；
        §6 说得更硬：「常态不许用」。画在这里的就是常态的棋盘线。
      */}
      <g stroke="var(--c-grid)" strokeWidth="1.5">
        {[8, 18, 28, 38].map((at) => (
          <line key={`v${at}`} x1={at} y1={8} x2={at} y2={38} />
        ))}
        {[8, 18, 28, 38].map((at) => (
          <line key={`h${at}`} x1={8} y1={at} x2={38} y2={at} />
        ))}
      </g>
      <circle cx="18" cy="18" r="4.6" fill="var(--c-fg)" />
      <circle cx="28" cy="28" r="4.6" fill="var(--c-surface)" stroke="var(--c-fg)" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * 棋谱列表。
 *
 * 读取失败**不再伪装成空库**。`list()` 从不上抛，所以「没下过棋」与
 * 「棋谱读不出来」在返回值上长得一样——现在靠两个信号分开：
 * `degraded`（存储不可用，数据来自内存兜底）与 `skipped`（读到了但没通过校验）。
 * 两个都**只说事实、不猜原因**。
 */
export function GameLibrary({
  storage,
  positions,
  onOpen,
  onStartBattle,
  services,
  onOpenEditor,
}: GameLibraryProps) {
  const [result, setResult] = useState<GameRecordList | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE_SIZE)
  /** 正在等「确认删除」的那一局。 */
  const [confirming, setConfirming] = useState<number | null>(null)
  const [deleteNote, setDeleteNote] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void storage.list().then((list) => {
      if (alive) setResult(list)
    })
    return () => {
      alive = false
    }
  }, [storage, reloadKey])

  /*
   * 删除流程里按钮是**整颗换掉**的（「删除」→「确认删除 / 取消」→ 行消失），
   * 被卸载的节点带走焦点，焦点掉到 `<body>`。所以每一步都指定下一个落点：
   * 写进 `pendingFocus`，等这次状态变化渲染完再 `focus()`——元素那时才在 DOM 里。
   */
  const idBase = useId()
  const focusId = (kind: 'record' | 'delete' | 'confirm', seq: number): string => `${idBase}-${kind}-${seq}`
  const startBattleId = `${idBase}-start`
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    const id = pendingFocus.current
    if (id === null) return
    pendingFocus.current = null
    document.getElementById(id)?.focus()
  })

  async function deleteRecord(seq: number): Promise<void> {
    setConfirming(null)
    // 删掉之后焦点去这一行的下一行；它是最后一行就去上一行；删光了去空状态的主操作。
    const records = result?.records ?? []
    const index = records.findIndex((record) => record.seq === seq)
    const neighbour = records[index + 1] ?? records[index - 1]
    try {
      const { persisted } = await storage.delete(seq)
      /*
       * 没写进库（降级到内存）时内存里那条**也已经删了**，所以列表照样移除：
       * 留着它的话再点那一行，打开的是一局已经不存在的棋。
       */
      setResult((current) =>
        current === null ? current : { ...current, records: current.records.filter((record) => record.seq !== seq) },
      )
      pendingFocus.current = neighbour === undefined ? startBattleId : focusId('record', neighbour.seq)
      setDeleteNote(
        persisted
          ? { ok: true, text: '已删除这局棋谱。' }
          : { ok: false, text: '棋谱库现在不可用，只删了本次会话里的这一局——刷新后它可能仍在。' },
      )
    } catch (err) {
      pendingFocus.current = focusId('delete', seq)
      setDeleteNote({ ok: false, text: `删除失败：${err instanceof Error ? err.message : String(err)}` })
    }
  }

  function exportRecord(record: GameRecord): void {
    if (services === undefined) return
    try {
      downloadJson(exportFilename('game', services.now), toGameFile(record))
      setExportError(null)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <PageHeader
        title="复盘"
        description="保存下来的对局可以逐手回放，也可以让引擎帮你找亏损的手"
      />

      {onOpenEditor !== undefined && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={onOpenEditor}>
            局面研究
          </Button>
        </div>
      )}

      {services !== undefined && (
        <div className="mb-3">
          <DataManagementPanel
            storage={storage}
            positions={positions ?? indexedDbPositions}
            services={services}
            degraded={result?.degraded ?? false}
            onImported={() => setReloadKey((key) => key + 1)}
          />
        </div>
      )}

      {deleteNote !== null && (
        <p
          role={deleteNote.ok ? 'status' : 'alert'}
          className={`mb-3 text-xs ${deleteNote.ok ? 'text-muted' : 'text-danger'}`}
        >
          {deleteNote.text}
        </p>
      )}

      {exportError !== null && (
        <p role="alert" data-testid="export-error" className="mb-3 text-xs text-danger">
          导出失败：{exportError}
        </p>
      )}

      {result === null ? (
        <p className="py-8 text-center text-sm text-faint">正在读取棋谱…</p>
      ) : result.records.length === 0 ? (
        <Panel padding="roomy" bodyClassName="text-center">
          <LibraryGlyph />
          <p className="mt-3 text-sm font-medium text-fg">还没有保存的对局</p>
          <p className="mx-auto mt-2 max-w-xs text-xs text-faint">
            对局结束后会自动存进这里，之后可以逐手回放，也可以让引擎逐手分析、找出亏损最大的几手。
          </p>
          <Button id={startBattleId} variant="primary" className="mt-4" onClick={onStartBattle}>
            开始一局对战
          </Button>
          {result.degraded && (
            <p data-testid="library-degraded" className="mt-3 text-xs text-warn">
              这个浏览器不让本站保存数据，所以对局关掉页面就没了。
            </p>
          )}
          {result.skipped > 0 && (
            <p data-testid="library-skipped" className="mt-3 text-xs text-faint">
              {skippedNote(result.skipped)}
            </p>
          )}
        </Panel>
      ) : (
        <>
          {(result.degraded || result.skipped > 0) && (
            /*
             * 颜色挂在各自的 span 上，不挂在父 `<p>`：这两句不是一个等级。
             * 「存不了数据」是警告（与空库分支同色），「有 N 条读不出来」
             * 是对更早数据的说明。原先父级统一 `text-faint`，于是同一句
             * 降级警告在空库时是 `warn`、有棋谱时降成了三级信息。
             */
            <p className="mb-3 text-xs">
              {result.degraded && (
                <span data-testid="library-degraded" className="text-warn">
                  这个浏览器不让本站保存数据，下面这些是本次会话里的对局，关掉页面就没了。
                </span>
              )}
              {result.degraded && result.skipped > 0 && ' '}
              {result.skipped > 0 && (
                <span data-testid="library-skipped" className="text-faint">
                  {skippedNote(result.skipped)}
                </span>
              )}
            </p>
          )}
          {confirming !== null && (
            <p className="mb-2 text-xs text-warn">删除的是本机保存的这一局，删除后不能撤销。</p>
          )}
          <ul className="space-y-2">
            {result.records.slice(0, shown).map((record, index) => (
              <li key={record.seq} className="flex items-stretch gap-2">
                <button
                  type="button"
                  id={focusId('record', record.seq)}
                  data-testid={`record-${record.seq}`}
                  onClick={() => onOpen(record)}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-border-strong"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-fg">{resultLabel(record)}</span>
                    <span className="shrink-0 text-xs text-faint">{metaLabel(record)}</span>
                  </div>
                  <div className="mt-1 text-xs text-faint">{timeLabel(record)}</div>
                </button>
                {services !== undefined && (
                  <Button
                    size="sm"
                    aria-label={`导出棋谱${recordName(record, index)}`}
                    onClick={() => exportRecord(record)}
                  >
                    导出
                  </Button>
                )}
                {/* 删除不可撤销：与局面库同一套二次确认，危险色只给「确认删除」那一下。 */}
                {confirming === record.seq ? (
                  <>
                    <Button
                      id={focusId('confirm', record.seq)}
                      size="sm"
                      variant="danger"
                      aria-label={`确认删除棋谱${recordName(record, index)}`}
                      onClick={() => void deleteRecord(record.seq)}
                    >
                      确认删除
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        pendingFocus.current = focusId('delete', record.seq)
                        setConfirming(null)
                      }}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <Button
                    id={focusId('delete', record.seq)}
                    size="sm"
                    aria-label={`删除棋谱${recordName(record, index)}`}
                    onClick={() => {
                      pendingFocus.current = focusId('confirm', record.seq)
                      setDeleteNote(null)
                      setConfirming(record.seq)
                    }}
                  >
                    删除
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {result.records.length > shown && (
            <div className="mt-3 text-center">
              <Button size="sm" onClick={() => setShown((count) => count + PAGE_SIZE)}>
                再显示 {Math.min(PAGE_SIZE, result.records.length - shown)} 局（共 {result.records.length} 局）
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
