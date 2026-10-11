import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { Board } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import type { UseBoundStore, StoreApi } from 'zustand'
import type { ReplayStore } from '../../store/replayStore'

export interface ReplayBoardProps {
  readonly store: UseBoundStore<StoreApi<ReplayStore>>
  readonly onExit: () => void
  /** 右侧栏追加内容（分析面板）。 */
  readonly extraPanel?: ReactNode
}

/**
 * 回放视图：棋盘 + 游标控制。
 *
 * 自动播放的定时器**由本组件订阅启停**（`playing` 为真时挂 interval、
 * 否/卸载时清掉）——store 只负责状态，组件不在树上时定时器必须死，
 * 否则切走页面后它会在后台一直推游标。
 */
export function ReplayBoard({ store, onExit, extraPanel }: ReplayBoardProps) {
  const { record, cursor, playing, position, hasPrev, hasNext, stepPrev, stepNext, play, pause } =
    useReplay(store)

  // 卸载时若还在播放，停掉 store 的定时器
  useEffect(() => {
    return () => {
      if (store.getState().playing) store.getState().pause()
    }
  }, [store])

  if (record === null) return null

  const total = record.moves.length

  // 落子编号：已走的每一手按顺序编号（label 省略时 Board 按下标显示 1/2/3…）
  const marks = position.moves.map((point) => ({ point }))

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_344px] lg:grid-rows-[auto_minmax(0,1fr)]">
      <BoardStage>
        <Board
          board={position.board}
          lastMove={position.lastMove}
          winLine={position.winLine}
          nextPlayer={position.current}
          showCoords
          // 回放棋盘只读：interactive=false 时 Board 不会触发 onPlay，
          // 但仍要传一个满足签名的空实现
          interactive={false}
          onPlay={() => {}}
          marks={marks}
        />
      </BoardStage>

      <aside className="order-2 space-y-3 px-3 pb-4 lg:order-2 lg:overflow-y-auto lg:border-l lg:border-border lg:px-4 lg:py-4">
        <Panel title="回放" bodyClassName="space-y-3 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              <span data-testid="move-counter" className="font-mono tabular-nums">
                {cursor} / {total}
              </span>{' '}
              手
            </span>
            <span className="text-xs text-faint">
              {position.status === 'won' || position.status === 'resigned'
                ? record.winner === null
                  ? '和棋'
                  : `${record.winner === 1 ? '黑' : '白'}方胜`
                : '对局中'}
            </span>
          </div>

          <div className="flex gap-2">
            <Button block disabled={!hasPrev} onClick={stepPrev}>
              上一步
            </Button>
            <Button block disabled={!hasNext} onClick={stepNext}>
              下一步
            </Button>
          </div>
          <Button
            block
            onClick={() => (playing ? pause() : play())}
            disabled={total === 0}
          >
            {playing ? '暂停' : '自动播放'}
          </Button>
          <Button block variant="primary" onClick={onExit}>
            ← 回到棋谱列表
          </Button>
        </Panel>

        {extraPanel}
      </aside>
    </div>
  )
}

function useReplay(store: UseBoundStore<StoreApi<ReplayStore>>): ReplayStore {
  return useStore(store)
}
