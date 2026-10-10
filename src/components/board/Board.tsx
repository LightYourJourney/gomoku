import { useId, useState, type CSSProperties } from 'react'
import { idx } from '../../core/board'
import { BOARD_SIZE, type Board as BoardModel, type Player, type Point } from '../../core/types'

export interface BoardProps {
  board: BoardModel
  lastMove: Point | null
  winLine: readonly Point[] | null
  /** 下一手是谁，用于悬停预览的棋子颜色 */
  nextPlayer: Player
  showCoords: boolean
  /** 是否允许落子（轮到自己、且对局未结束） */
  interactive: boolean
  onPlay: (point: Point) => void
}

/** 棋盘外留一圈空白：坐标标签有地方放，棋盘也不至于顶到边框。 */
const MARGIN = 1
const EXTENT = BOARD_SIZE - 1
const VIEW_SIZE = EXTENT + MARGIN * 2
const VIEW_BOX = `${-MARGIN} ${-MARGIN} ${VIEW_SIZE} ${VIEW_SIZE}`

const STONE_RADIUS = 0.44

/**
 * 命中区是边长一整格的正方形，相邻格子严丝合缝地铺满棋盘。
 *
 * 不用圆形热区：半径半格的圆只会在相邻交叉点处相切，格与格之间留下死区，
 * 手指点偏一点就没反应。整格命中意味着「点在哪一格就下在哪一个交叉点」。
 *
 * 必须同时把 strokeWidth 置 0：`pointer-events: all` 的命中范围是「内部 + 周界」，
 * 而未指定 stroke 时 stroke-width 的初始值是 1，每个格子会向外多出半格，
 * 于是点在交叉点正中反而会落到右下相邻的那一格去。
 */
const HALF_CELL = 0.5

/** 天元与四个星位，棋盘的定位参照。 */
const STAR_POINTS: readonly Point[] = [
  { x: 3, y: 3 },
  { x: 11, y: 3 },
  { x: 3, y: 11 },
  { x: 11, y: 11 },
  { x: 7, y: 7 },
]

const AXIS = Array.from({ length: BOARD_SIZE }, (_, i) => i)
const COLUMN_LABELS = AXIS.map((x) => String.fromCharCode(65 + x))

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

const SVG_STYLE: CSSProperties = { display: 'block', touchAction: 'manipulation' }

export function Board({
  board,
  lastMove,
  winLine,
  nextPlayer,
  showCoords,
  interactive,
  onPlay,
}: BoardProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [hovered, setHovered] = useState<Point | null>(null)

  const winKeys = new Set((winLine ?? []).map(pointKey))
  const lastKey = lastMove === null ? null : pointKey(lastMove)

  const handleEnter = (point: Point): void => {
    if (!interactive || board[idx(point.x, point.y)] !== 0) {
      setHovered(null)
      return
    }
    setHovered(point)
  }

  const handleClick = (point: Point): void => {
    if (!interactive) return
    if (board[idx(point.x, point.y)] !== 0) return
    setHovered(null)
    onPlay(point)
  }

  const stones: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[idx(x, y)] !== 0) stones.push({ x, y })
    }
  }

  return (
    <svg
      viewBox={VIEW_BOX}
      style={SVG_STYLE}
      className="h-full w-full select-none"
      role="img"
      aria-label={`五子棋棋盘，已落子 ${stones.length} 手${lastMove ? `，最后一手在 ${COLUMN_LABELS[lastMove.x]}${BOARD_SIZE - lastMove.y}` : ''}`}
      onMouseLeave={() => setHovered(null)}
    >
      <defs>
        <linearGradient id={`${uid}-wood`} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="var(--c-board-a)" />
          <stop offset="100%" stopColor="var(--c-board-b)" />
        </linearGradient>

        <radialGradient id={`${uid}-vignette`} cx="50%" cy="42%" r="78%">
          <stop offset="50%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
        </radialGradient>

        <radialGradient id={`${uid}-black`} cx="36%" cy="30%" r="80%">
          <stop offset="0%" stopColor="var(--c-stone-black-a)" />
          <stop offset="100%" stopColor="var(--c-stone-black-b)" />
        </radialGradient>

        <radialGradient id={`${uid}-white`} cx="36%" cy="30%" r="80%">
          <stop offset="0%" stopColor="var(--c-stone-white-a)" />
          <stop offset="100%" stopColor="var(--c-stone-white-b)" />
        </radialGradient>
      </defs>

      <rect
        x={-MARGIN}
        y={-MARGIN}
        width={VIEW_SIZE}
        height={VIEW_SIZE}
        fill={`url(#${uid}-wood)`}
      />

      <g stroke="var(--c-grid)" strokeWidth={0.032} strokeLinecap="round">
        {AXIS.map((i) => (
          <line key={`h${i}`} x1={0} y1={i} x2={EXTENT} y2={i} />
        ))}
        {AXIS.map((i) => (
          <line key={`v${i}`} x1={i} y1={0} x2={i} y2={EXTENT} />
        ))}
        <rect x={0} y={0} width={EXTENT} height={EXTENT} fill="none" strokeWidth={0.07} />
      </g>

      <g fill="var(--c-star)">
        {STAR_POINTS.map((point) => (
          <circle key={pointKey(point)} cx={point.x} cy={point.y} r={0.085} />
        ))}
      </g>

      <rect
        x={-MARGIN}
        y={-MARGIN}
        width={VIEW_SIZE}
        height={VIEW_SIZE}
        fill={`url(#${uid}-vignette)`}
        pointerEvents="none"
      />

      {showCoords && (
        <g
          fill="var(--c-star)"
          fontSize={0.52}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          dominantBaseline="central"
          opacity={0.85}
        >
          {AXIS.map((x) => (
            <text key={`colTop${x}`} data-testid="coord" x={x} y={-0.6}>
              {COLUMN_LABELS[x]}
            </text>
          ))}
          {AXIS.map((x) => (
            <text key={`colBottom${x}`} data-testid="coord" x={x} y={EXTENT + 0.6}>
              {COLUMN_LABELS[x]}
            </text>
          ))}
          {AXIS.map((y) => (
            <text key={`rowLeft${y}`} data-testid="coord" x={-0.6} y={y}>
              {BOARD_SIZE - y}
            </text>
          ))}
          {AXIS.map((y) => (
            <text key={`rowRight${y}`} data-testid="coord" x={EXTENT + 0.6} y={y}>
              {BOARD_SIZE - y}
            </text>
          ))}
        </g>
      )}

      {/* 连线画在棋子下面：压在棋子上会把棋子的质感糊掉。 */}
      {winLine !== null && winLine.length >= 2 && (
        <line
          x1={winLine[0].x}
          y1={winLine[0].y}
          x2={winLine[winLine.length - 1].x}
          y2={winLine[winLine.length - 1].y}
          stroke="var(--c-accent)"
          strokeWidth={0.2}
          strokeLinecap="round"
          opacity={0.5}
          pointerEvents="none"
        />
      )}

      <g pointerEvents="none">
        {stones.map((point) => {
          const player = board[idx(point.x, point.y)] as Player
          const key = pointKey(point)
          const isBlack = player === 1

          return (
            <g
              key={key}
              data-testid={`stone-${point.x}-${point.y}`}
              data-player={player}
              data-last={key === lastKey || undefined}
              data-win={winKeys.has(key) || undefined}
            >
              <circle
                cx={point.x + 0.04}
                cy={point.y + 0.06}
                r={STONE_RADIUS}
                fill="#000000"
                opacity={isBlack ? 0.34 : 0.24}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={STONE_RADIUS}
                fill={`url(#${uid}-${isBlack ? 'black' : 'white'})`}
                stroke={isBlack ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)'}
                strokeWidth={0.02}
              />
              <ellipse
                cx={point.x - 0.13}
                cy={point.y - 0.15}
                rx={0.17}
                ry={0.11}
                fill="#ffffff"
                opacity={isBlack ? 0.3 : 0.75}
                transform={`rotate(-34 ${point.x - 0.13} ${point.y - 0.15})`}
              />
              {key === lastKey && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={0.47}
                  fill="none"
                  stroke="var(--c-danger)"
                  strokeWidth={0.075}
                />
              )}
            </g>
          )
        })}
      </g>

      {winLine !== null && (
        <g data-testid="win-line" pointerEvents="none">
          {winLine.map((point) => (
            <circle
              key={pointKey(point)}
              cx={point.x}
              cy={point.y}
              r={0.49}
              fill="none"
              stroke="var(--c-accent)"
              strokeWidth={0.075}
            />
          ))}
        </g>
      )}

      {hovered !== null && (
        <circle
          data-testid="hover-stone"
          data-player={nextPlayer}
          cx={hovered.x}
          cy={hovered.y}
          r={STONE_RADIUS * 0.92}
          fill={nextPlayer === 1 ? 'var(--c-stone-black-b)' : 'var(--c-stone-white-a)'}
          opacity={0.32}
          pointerEvents="none"
        />
      )}

      <g>
        {AXIS.map((y) =>
          AXIS.map((x) => {
            const point = { x, y }
            const occupied = board[idx(x, y)] !== 0
            const playable = interactive && !occupied

            return (
              <rect
                key={pointKey(point)}
                data-testid={`intersection-${x}-${y}`}
                x={x - HALF_CELL}
                y={y - HALF_CELL}
                width={HALF_CELL * 2}
                height={HALF_CELL * 2}
                fill="transparent"
                strokeWidth={0}
                pointerEvents="all"
                className={playable ? 'cursor-pointer' : undefined}
                onClick={() => handleClick(point)}
                onMouseEnter={() => handleEnter(point)}
              />
            )
          }),
        )}
      </g>
    </svg>
  )
}
