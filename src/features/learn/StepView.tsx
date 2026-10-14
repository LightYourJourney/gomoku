import { useState } from 'react'
import { Board } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import { cx } from '../../lib/cx'
import { parseBoardLines } from '../../lib/board-lines'
import { replay } from '../../core/game'
import { BLACK } from '../../core/types'
import type { LessonStep } from '../../learn/types'
import { SIDE_PANEL_CLASS } from '../shell/PageShell'

export interface StepViewProps {
  readonly step: LessonStep
  readonly index: number
  readonly total: number
}

/**
 * 讲解的一页。有 `sequence` 时渲染成可以一步一步看的棋盘演示。
 *
 * 演示的每一帧都用 `replay(手顺.slice(0, k))` 还原，**不另写一套摆子逻辑**——
 * `replay` 已经在 core 里且经过完整测试，重写一遍只会多一处会走样的地方。
 */
export function StepView({ step, index, total }: StepViewProps) {
  const [frame, setFrame] = useState(0)
  const sequence = step.sequence

  const frameCount = sequence?.moves.length ?? 0
  const shownMoves = sequence?.moves.slice(0, frame) ?? []

  const game = sequence === undefined ? null : replay(shownMoves, sequence.firstPlayer)
  const board =
    game?.board ?? (step.board === undefined ? null : parseBoardLines(step.board.lines))

  const marks = step.marks ?? []
  const lastMove = game?.lastMove ?? null

  return (
    <>
      <BoardStage>
        {board === null ? (
          <div className="grid h-full w-full place-items-center bg-surface-2 text-sm text-faint">
            这一页没有棋盘
          </div>
        ) : (
          <Board
            board={board}
            lastMove={lastMove}
            winLine={game?.winLine ?? null}
            nextPlayer={sequence?.firstPlayer ?? BLACK}
            showCoords={false}
            interactive={false}
            marks={marks}
            onPlay={() => {}}
          />
        )}
      </BoardStage>

      <aside className={cx('order-2 space-y-3 px-3 pb-4 wide-layout:order-3', SIDE_PANEL_CLASS)}>
        <Panel title={`讲解 ${index + 1} / ${total}`}>
          {/*
        这一页的 h1 在工具栏上（课名），所以这里只能是 h2——
        原先它是 h1，于是「讲解 2 / 3」那个 h2 之后又冒出一个 h1（层级倒着走）。
      */}
        <h2 className="text-base font-semibold text-fg">{step.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
        </Panel>

        {sequence !== undefined && (
          <Panel title="棋盘演示">
            <div className="flex items-center gap-2">
              <Button
                disabled={frame === 0}
                onClick={() => setFrame((value) => Math.max(0, value - 1))}
              >
                上一手
              </Button>
              <Button
                variant="primary"
                disabled={frame >= frameCount}
                onClick={() => setFrame((value) => Math.min(frameCount, value + 1))}
              >
                下一手
              </Button>
              <span
                data-testid="sequence-progress"
                className="ml-auto font-mono text-xs tabular-nums text-faint"
              >
                {frame} / {frameCount}
              </span>
            </div>
            <p className="mt-2 text-xs text-faint">
              一步一步看这盘棋怎么走完——手数顺序就是获胜的过程。
            </p>
          </Panel>
        )}
      </aside>
    </>
  )
}
