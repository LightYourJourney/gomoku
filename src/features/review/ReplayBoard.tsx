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
 * 回放编号的半径与字号（用户单位）。
 *
 * **半径**受两条约束：`Board.tsx` 的注释解释了编号为什么要小（大半径会把棋子
 * 整个盖住，就看不出那一手是黑是白），而棋子半径是 `STONE_RADIUS = 0.44`。
 * 取 0.30、当前手略大到 0.34——390 视口（棋盘约 340px，1 单位 ≈ 21.25px）下
 * 棋子外露 2.98px / 2.13px，都还看得出黑白，当前手则是个更实的块。
 *
 * **字号与半径解绑了**（`BoardMark.fontSize`）。原先字号恒等于 `radius × 1.25`，
 * 于是半径被「棋子要露在外面」卡住的同时字号也被连带卡在 6.91px，
 * 够不着 `DESIGN_SYSTEM` §8.2 的 10px 下限（F-UI-14）。徽标的高度是 `2r`，
 * 装得下更大的字，所以按 10px 反推：`10 / 21.25 = 0.4706`，取 **0.51**
 * （≈ 10.84px）留 8% 余量。
 *
 * **代价，如实记**：pill 的宽度只取决于字号，所以三位数手数（≥100 手）的徽标
 * 会宽到 1.189 单位，相邻两个各伸 0.594、**重叠 0.1886 单位**
 * （@390 约 4px；棋盘越大绝对值越大——778 的棋盘上是 9.2px，相对比例不变）。
 *
 * 这比「底色相叠」更麻烦一点：0.1886 **超过了每侧 0.12 的内边距**，
 * 后画的 pill（`Board.tsx` 按 marks 顺序绘制）会盖住前一格**文字的右缘**
 * 约 0.069 单位，@390 约 1.5px。「半宽 < 1 格」的硬约束仍满足（0.594 < 1），
 * 手顺**总数也没减少**；但「三位数密排时数字仍读得出」这句
 * **我没有实测**（手上没有 ≥100 手的真实棋谱），只能说大概率，不是结论。
 */
const CURRENT_STEP_RADIUS = 0.34
const PLAIN_STEP_RADIUS = 0.3
const STEP_FONT_SIZE = 0.51

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
    fontSize: STEP_FONT_SIZE,
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
            {/*
              「还在下」是 `status === 'playing'`，**不是**「没赢也没认输」。
              `GameStatus` 有四态（`core/types.ts`）：`playing | won | draw | resigned`——
              早先这里列的是 `'won' || 'resigned'`，于是满盘和棋（`'draw'`）落进
              else，这一栏写着「对局中」，而它上面那条列表行明明写着「和棋」。
            */}
            <span data-testid="replay-status" className="text-xs text-faint">
              {position.status === 'playing'
                ? '对局中'
                : record.winner === null
                  ? '和棋'
                  : `${record.winner === 1 ? '黑' : '白'}方胜`}
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
              {(Object.keys(REPLAY_SPEED_LABELS) as readonly ReplaySpeed[]).map(
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
