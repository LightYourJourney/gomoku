import { useEffect, useState } from 'react'
import { BLACK } from '../../core/types'
import { DIFFICULTY_LABELS } from '../../ai/difficulty'
import type { GameRecord, GameRecordList, GameRecordsStorage } from '../../persist/gameRecords'
import { PageHeader } from '../../components/ui/PageHeader'
import { Panel } from '../../components/ui/Panel'
import { Button } from '../../components/ui/Button'

export interface GameLibraryProps {
  readonly storage: GameRecordsStorage
  readonly onOpen: (record: GameRecord) => void
  /** 空状态那颗主操作。**必须真的切到对战页**——不渲染只会摆样子的按钮。 */
  readonly onStartBattle: () => void
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
 *
 * **不加时间戳**：`AGENTS.md` 规定 `Date.now()` 只能出现在 `ai/search.ts`，
 * 而 `GameRecord` 是刻意不存时间的（先后由自增主键表达）；
 * 补上去会让所有存量棋谱作废。先后看列表顺序就够了。
 */
function metaLabel(record: GameRecord): string {
  const mode = record.mode === 'pve' ? '人机' : '双人'
  const difficulty = record.mode === 'pve' ? ` · ${DIFFICULTY_LABELS[record.difficulty]}` : ''
  return `${mode}${difficulty} · ${record.moves.length} 手`
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
      <g stroke="var(--c-border-strong)" strokeWidth="1.5">
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
export function GameLibrary({ storage, onOpen, onStartBattle }: GameLibraryProps) {
  const [result, setResult] = useState<GameRecordList | null>(null)

  useEffect(() => {
    let alive = true
    void storage.list().then((list) => {
      if (alive) setResult(list)
    })
    return () => {
      alive = false
    }
  }, [storage])

  return (
    <>
      <PageHeader
        title="复盘"
        description="保存下来的对局可以逐手回放，也可以让引擎帮你找亏损的手"
      />

      {result === null ? (
        <p className="py-8 text-center text-sm text-faint">正在读取棋谱…</p>
      ) : result.records.length === 0 ? (
        <Panel padding="roomy" bodyClassName="text-center">
          <LibraryGlyph />
          <p className="mt-3 text-sm font-medium text-fg">还没有保存的对局</p>
          <p className="mx-auto mt-2 max-w-xs text-xs text-faint">
            对局结束后会自动存进这里，之后可以逐手回放，也可以让引擎逐手分析、找出亏损最大的几手。
          </p>
          <Button variant="primary" className="mt-4" onClick={onStartBattle}>
            开始一局对战
          </Button>
          {result.degraded && (
            <p data-testid="library-degraded" className="mt-3 text-xs text-warn">
              这个浏览器不让本站保存数据，所以对局关掉页面就没了。
            </p>
          )}
          {result.skipped > 0 && (
            <p data-testid="library-skipped" className="mt-3 text-xs text-faint">
              另有 {result.skipped} 条棋谱读不出来，多半是更早的版本留下的。
            </p>
          )}
        </Panel>
      ) : (
        <>
          {(result.degraded || result.skipped > 0) && (
            <p className="mb-3 text-xs text-faint">
              {result.degraded && (
                <span data-testid="library-degraded">
                  这个浏览器不让本站保存数据，下面这些是本次会话里的对局，关掉页面就没了。
                </span>
              )}
              {result.degraded && result.skipped > 0 && ' '}
              {result.skipped > 0 && (
                <span data-testid="library-skipped">
                  另有 {result.skipped} 条棋谱读不出来，多半是更早的版本留下的。
                </span>
              )}
            </p>
          )}
          <ul className="space-y-2">
            {result.records.map((record) => (
              <li key={record.seq}>
                <button
                  type="button"
                  data-testid={`record-${record.seq}`}
                  onClick={() => onOpen(record)}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-border-strong"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-fg">{resultLabel(record)}</span>
                    <span className="text-xs text-faint">{metaLabel(record)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
