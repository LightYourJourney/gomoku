import { useEffect, useState } from 'react'
import { BLACK } from '../../core/types'
import type { GameRecord, GameRecordsStorage } from '../../persist/gameRecords'
import { PageHeader } from '../../components/ui/PageHeader'
import { Panel } from '../../components/ui/Panel'

export interface GameLibraryProps {
  readonly storage: GameRecordsStorage
  readonly onOpen: (record: GameRecord) => void
}

/** 结果一栏的人话：谁赢了 / 认输 / 和棋。 */
function resultLabel(record: GameRecord): string {
  if (record.winner === null) return '和棋'
  const winnerName = record.winner === BLACK ? '黑' : '白'
  return record.resignedBy !== null ? `${winnerName}方胜（对手认输）` : `${winnerName}方胜`
}

function modeLabel(record: GameRecord): string {
  return record.mode === 'pve' ? '人机' : '双人'
}

/**
 * 棋谱列表。加载失败如实显示——隐私模式降级后是空库，
 * 与「真的没有对局」对玩家来说没有区别，文案不假装知道原因。
 */
export function GameLibrary({ storage, onOpen }: GameLibraryProps) {
  const [records, setRecords] = useState<readonly GameRecord[] | null>(null)

  useEffect(() => {
    let alive = true
    void storage.list().then(
      (list) => {
        if (alive) setRecords(list)
      },
      () => {
        if (alive) setRecords([])
      },
    )
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

      {records === null ? (
        <p className="py-8 text-center text-sm text-faint">正在读取棋谱…</p>
      ) : records.length === 0 ? (
        <Panel padding="roomy" bodyClassName="text-center">
          <p className="text-sm text-muted">还没有保存的对局</p>
          <p className="mt-2 text-xs text-faint">去下一局吧——对局结束后会自动存进这里</p>
        </Panel>
      ) : (
        <ul className="space-y-2">
          {records.map((record) => (
            <li key={record.seq}>
              <button
                type="button"
                data-testid={`record-${record.seq}`}
                onClick={() => onOpen(record)}
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-border-strong"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">{resultLabel(record)}</span>
                  <span className="text-xs text-faint">
                    {modeLabel(record)} · {record.moves.length} 手
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
