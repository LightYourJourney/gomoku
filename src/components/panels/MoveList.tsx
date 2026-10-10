import { useEffect, useRef } from 'react'
import { cx } from '../../lib/cx'
import { formatPoint } from '../../lib/coords'
import { moverAt } from '../../store/gameStore'
import { BLACK, type Player, type Point } from '../../core/types'

export interface MoveListProps {
  moves: readonly Point[]
  firstPlayer: Player
  lastMove: Point | null
}

interface MoveRow {
  readonly turn: number
  readonly black: Point | null
  readonly white: Point | null
}

function buildRows(moves: readonly Point[], firstPlayer: Player): MoveRow[] {
  const rows: MoveRow[] = []

  moves.forEach((point, index) => {
    const turn = Math.floor(index / 2) + 1
    const mover = moverAt(index, firstPlayer)
    const row = rows[turn - 1] ?? { turn, black: null, white: null }

    rows[turn - 1] = mover === BLACK ? { ...row, black: point } : { ...row, white: point }
  })

  return rows
}

function isSamePoint(a: Point | null, b: Point | null): boolean {
  return a !== null && b !== null && a.x === b.x && a.y === b.y
}

export function MoveList({ moves, firstPlayer, lastMove }: MoveListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = buildRows(moves, firstPlayer)

  useEffect(() => {
    const element = scrollRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [moves.length])

  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-xs text-faint">尚未落子</p>
  }

  return (
    <div ref={scrollRef} className="max-h-64 overflow-y-auto lg:max-h-72">
      <ol className="space-y-0.5 font-mono text-xs">
        {rows.map((row) => (
          <li
            key={row.turn}
            className="grid grid-cols-[2rem_1fr_1fr] items-center gap-1.5 rounded-md px-1.5 py-1 odd:bg-surface-2/60"
          >
            <span className="text-right text-faint">{row.turn}</span>
            <MoveCell point={row.black} player={BLACK} highlighted={isSamePoint(row.black, lastMove)} />
            <MoveCell point={row.white} player={2} highlighted={isSamePoint(row.white, lastMove)} />
          </li>
        ))}
      </ol>
    </div>
  )
}

interface MoveCellProps {
  point: Point | null
  player: Player
  highlighted: boolean
}

function MoveCell({ point, player, highlighted }: MoveCellProps) {
  if (point === null) {
    return <span className="text-faint/50">—</span>
  }

  return (
    <span
      data-testid={`move-${point.x}-${point.y}`}
      className={cx(
        'inline-flex items-center gap-1.5 rounded px-1 py-0.5 tabular-nums',
        highlighted ? 'bg-danger-soft text-danger' : 'text-muted',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          background:
            player === BLACK
              ? 'var(--c-stone-black-b)'
              : 'var(--c-stone-white-a)',
          boxShadow: player === BLACK ? 'none' : 'inset 0 0 0 1px rgb(0 0 0 / 0.2)',
        }}
      />
      {formatPoint(point)}
    </span>
  )
}
