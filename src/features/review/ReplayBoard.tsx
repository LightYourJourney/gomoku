import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { Board } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import type { UseBoundStore, StoreApi } from 'zustand'
import { cx } from '../../lib/cx'
import { REPLAY_SPEED_LABELS, type ReplaySpeed, type ReplayStore } from '../../store/replayStore'
import { SIDE_PANEL_CLASS } from '../shell/PageShell'
import { ReplayTimeline } from './ReplayTimeline'

export interface ReplayBoardProps {
  readonly store: UseBoundStore<StoreApi<ReplayStore>>
  readonly onExit: () => void
  /** 右侧栏追加内容（分析面板）。 */
  readonly extraPanel?: ReactNode
}

/**
 * 回放棋盘上「当前手」的编号半径。
 *
 * 其余手是 `0.26`（`Board.tsx` 的注释解释了为什么要小：大半径会把棋子整个盖住，
 * 就看不出那一手是黑是白）。当前手稍微放大一点，好在密排的编号里认出来。
 *
 * **只能放这么大。** 棋子半径是 `STONE_RADIUS = 0.44`（`Board.tsx:61`），
 * 编号与棋子同心：0.26 时边缘余 0.18 单位，0.32 时只剩 0.12——
 * 390 视口（棋盘约 340px，1 单位 ≈ 21.25px）下就是 3.8px → 2.6px。
 * 再大就该把棋子吃掉了，得不偿失。
 */
const CURRENT_STEP_RADIUS = 0.32
const PLAIN_STEP_RADIUS = 0.26

/**
 * 回放视图：棋盘 + 游标控制。
 *
 * 自动播放的定时器由 store 自己持有（**单一入口**，见 `replayStore` 的
 * `startTimer`），本组件只负责：卸载时如果还在播就停掉，
 * 以及把「手动定位」的意图转给 store。
 */
export function ReplayBoard({ store, onExit, extraPanel }: ReplayBoardProps) {
  const {
    record, cursor, playing, speed, position,
    hasPrev, hasNext, stepPrev, stepNext, goTo, play, pause, setSpeed,
  } = useReplay(store)

  // 卸载时若还在播放，停掉 store 的定时器
  useEffect(() => {
    return () => {
      if (store.getState().playing) store.getState().pause()
    }
  }, [store])

  if (record === null) return null

  const total = record.moves.length

  /*
   * 落子编号：已走的每一手按顺序编号（label 省略时 Board 按下标显示 1/2/3…）。
   * 当前手（`cursor - 1`）那一枚半径略大——cursor 为 0 时没有当前手，
   * `-1` 不会命中任何下标，自然全是常规半径。
   */
  const marks = position.moves.map((point, index) => ({
    point,
    radius: index === cursor - 1 ? CURRENT_STEP_RADIUS : PLAIN_STEP_RADIUS,
  }))

  return (
    <>
      {/* 两栏栅格由 `PageShell` 的 flush 正文提供，这里只出棋盘与侧栏两块 */}
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

      <aside className={cx('order-2 space-y-3 px-3 pb-4 wide-layout:order-2', SIDE_PANEL_CLASS)}>
        <Panel title="回放" bodyClassName="space-y-3">
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

          <ReplayTimeline cursor={cursor} total={total} onSeek={goTo} />

          <div className="flex gap-2">
            <Button block disabled={!hasPrev} onClick={() => goTo(0)}>
              开局
            </Button>
            <Button block disabled={!hasNext} onClick={() => goTo(total)}>
              终局
            </Button>
          </div>

          <div className="flex gap-2">
            <Button block disabled={!hasPrev} onClick={stepPrev}>
              上一步
            </Button>
            <Button block disabled={!hasNext} onClick={stepNext}>
              下一步
            </Button>
          </div>

          {/*
            到尾之后「自动播放」没有可播的东西，禁用掉。
            原先它只按 `total === 0` 禁用，于是终局上按下去会先把按钮变成
            「暂停」、等一个 tick 才发现到头——现在 store 里也拦了一道。
          */}
          <Button block disabled={!hasNext} onClick={() => (playing ? pause() : play())}>
            {playing ? '暂停' : '自动播放'}
          </Button>

          {/*
            速度是三选一，但用 `aria-pressed` 的切换按钮而不是 `role="radio"`：
            原生 radio 的方向键行为要自己实现，而这里三颗按钮本来就能逐个 Tab 到，
            语义上「按下去了哪一个」比「一组单选」更贴近事实。
          */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted">速度</span>
            <div className="flex flex-1 gap-1" role="group" aria-label="播放速度">
              {(['slow', 'normal', 'fast'] as const satisfies readonly ReplaySpeed[]).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`replay-speed-${value}`}
                    aria-pressed={speed === value}
                    onClick={() => setSpeed(value)}
                    className={cx(
                      // `h-7`：探针的命中区判据把 <24px 的可交互元素判红，留足余量
                      'h-7 flex-1 rounded-md border text-xs transition',
                      speed === value
                        ? 'border-accent bg-accent-soft font-medium text-accent'
                        : 'border-border text-muted hover:border-border-strong',
                    )}
                  >
                    {REPLAY_SPEED_LABELS[value]}
                  </button>
                ),
              )}
            </div>
          </div>

          {/*
            这一颗是**导航**，不是本页的主操作——同屏的主操作是右边分析面板的
            「开始分析」。两个实心强调色按钮并排时，用户不知道该按哪个，
            规范里那条「一屏最多一个 primary」说的就是这件事。
          */}
          <Button block onClick={onExit}>
            ← 回到棋谱列表
          </Button>
        </Panel>

        {extraPanel}
      </aside>
    </>
  )
}

function useReplay(store: UseBoundStore<StoreApi<ReplayStore>>): ReplayStore {
  return useStore(store)
}
