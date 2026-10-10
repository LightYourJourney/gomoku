import { useCallback, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import { cx } from '../../lib/cx'
import { CATEGORY_LABELS, CATEGORY_ORDER, PUZZLES } from '../../learn/puzzles'
import type { Puzzle } from '../../learn/types'
import { useLearnStore } from '../../store/learnStore'
import { PracticeBoard } from '../learn/PracticeBoard'
import { AppHeader } from '../shell/AppHeader'

/** 残局挑战：按分类列题，进去之后用与课程同一套练习交互。 */
export function PuzzleScreen() {
  const progress = useLearnStore((state) => state.progress)
  const visit = useLearnStore((state) => state.visit)

  const [openId, setOpenId] = useState<string | null>(null)
  const puzzle = PUZZLES.find((entry) => entry.id === openId) ?? null

  const open = (id: string): void => {
    setOpenId(id)
    visit('puzzle', id)
  }

  if (puzzle !== null) {
    return (
      <PuzzleView
        puzzle={puzzle}
        onExit={() => {
          setOpenId(null)
          visit(null)
        }}
      />
    )
  }

  const done = PUZZLES.filter((entry) => progress.solvedPuzzles.includes(entry.id)).length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppHeader />

      <div className="mx-auto w-full max-w-3xl px-3 py-5 lg:px-6">
        <header className="mb-4 flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-fg">残局挑战</h1>
          <span data-testid="puzzle-progress" className="text-xs text-faint">
            已通过 {done} / {PUZZLES.length} 题
          </span>
        </header>

        <p className="mb-4 text-sm leading-relaxed text-muted">
          每道题都只给局面和目标，不给答案。解法由引擎现场算出来，所以想出别的走法
          一样算对——判定看的是棋型，不是某一个坐标。
        </p>

        <div className="space-y-4">
          {CATEGORY_ORDER.map((category) => {
            const group = PUZZLES.filter((entry) => entry.category === category)

            return (
              <Panel key={category} title={CATEGORY_LABELS[category]} bodyClassName="p-2.5">
                <ul className="space-y-1.5">
                  {group.map((entry) => {
                    const solved = progress.solvedPuzzles.includes(entry.id)

                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => open(entry.id)}
                          data-testid={`puzzle-${entry.id}`}
                          data-done={solved}
                          className={cx(
                            'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition',
                            solved
                              ? 'border-good/40 bg-good-soft'
                              : 'border-border bg-surface hover:border-border-strong',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cx(
                              'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                              solved ? 'bg-good text-accent-fg' : 'bg-surface-2 text-muted',
                            )}
                          >
                            {solved ? '✓' : '·'}
                          </span>
                          <span className="min-w-0 truncate text-sm text-fg">{entry.title}</span>
                          <span className="ml-auto text-xs text-faint">›</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Panel>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface PuzzleViewProps {
  readonly puzzle: Puzzle
  readonly onExit: () => void
}

function PuzzleView({ puzzle, onExit }: PuzzleViewProps) {
  const solved = useLearnStore((state) => state.progress.solvedPuzzles.includes(puzzle.id))
  const solvePuzzle = useLearnStore((state) => state.solvePuzzle)
  const [round, setRound] = useState(0)

  // 引用要稳定：练习组件把它放进 effect 的依赖里。
  const handleSolved = useCallback(() => solvePuzzle(puzzle.id), [puzzle.id, solvePuzzle])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button onClick={onExit}>← 残局列表</Button>
        <span className="truncate text-sm font-medium text-fg">{puzzle.title}</span>
        <span className="ml-auto text-xs text-faint">{CATEGORY_LABELS[puzzle.category]}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_344px] lg:grid-rows-[auto_minmax(0,1fr)]">
        <PracticeBoard
          // 换 key 强制重建，用来实现「再来一次」
          key={`${puzzle.id}:${round}`}
          practice={puzzle}
          onSolved={handleSolved}
          footer={
            <div className="space-y-2">
              <p className="text-xs text-good">这一题已经通过。</p>
              <Button block onClick={() => setRound((value) => value + 1)}>
                再来一次
              </Button>
            </div>
          }
        />
      </div>

      {solved && (
        <p className="shrink-0 px-3 pb-3 text-xs text-faint">做对的题会记在进度里，刷新也不会丢。</p>
      )}
    </div>
  )
}
