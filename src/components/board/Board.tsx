import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type CSSProperties } from 'react'
import { idx } from '../../core/board'
import { BOARD_SIZE, type Board as BoardModel, type Player, type Point } from '../../core/types'
import { columnLabel, formatPoint, rowLabel } from '../../lib/coords'
import { motionClass } from '../../lib/motion'

export type MarkTone = 'accent' | 'good' | 'bad'

export interface BoardMark {
  readonly point: Point
  /** 标记上的文字。省略时按数组下标显示 1/2/3… */
  readonly label?: string
  /** 默认 `accent`（强调色，AI 提示用）；`good` / `bad` 用于判题反馈。 */
  readonly tone?: MarkTone
  /**
   * 圆的半径，默认 0.4（一格为 1）。
   *
   * 回放的落子编号用小半径（0.26）：默认尺寸会把棋子整个盖住，
   * 看不出那一手是黑是白——编号的意义就少了一半。
   */
  readonly radius?: number
}

/** 三种色调对应的填充色。避开棋盘木色，也互相分得开。 */
const MARK_FILL: Record<MarkTone, string> = {
  accent: 'var(--c-accent)',
  good: 'var(--c-good)',
  bad: 'var(--c-danger)',
}

export interface BoardProps {
  board: BoardModel
  lastMove: Point | null
  winLine: readonly Point[] | null
  /** 下一手是谁，用于悬停预览的棋子颜色 */
  nextPlayer: Player
  showCoords: boolean
  /** 是否允许落子（轮到自己、且对局未结束） */
  interactive: boolean
  /**
   * 棋盘上的标记。AI 提示的候选点、教学里标出的关键点、判题的对错反馈都走它，
   * 按给定顺序画在棋子之上。
   *
   * **标记原样渲染，不做过滤**——包括画在已有棋子的交叉点上。判题反馈正需要这样：
   * 「这一手走错了」的标记就该落在那颗刚落下的子上。这里曾经有一条「跳过已占用点」
   * 的兜底，结果是反馈标记被静默吃掉，什么错都不报。
   *
   * 一致性由调用方负责，而两个调用方本来就满足：提示与练习的标记都在局面变化的
   * 那一刻清空，所以标记永远对应当前局面。
   */
  marks?: readonly BoardMark[]
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

/** 键盘焦点的默认起点：天元。五子棋的第一手，也是个好记的坐标。 */
const CENTER_POINT: Point = { x: 7, y: 7 }

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

/**
 * touch-action 必须锁死。
 *
 * 只用 `manipulation` 的话只禁掉双击缩放，手指在棋盘上稍微带一点拖动就会变成
 * 滚页面，落子被取消——这正是「页面滚动干扰棋盘操作」。棋盘在页面里最多占
 * 半屏高，下面的面板仍然可以滚动，锁住棋盘不牺牲可滚动的区域。
 */
const SVG_STYLE: CSSProperties = { display: 'block', touchAction: 'none' }

export function Board({
  board,
  lastMove,
  winLine,
  nextPlayer,
  showCoords,
  interactive,
  marks,
  onPlay,
}: BoardProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [hovered, setHovered] = useState<Point | null>(null)
  // 键盘焦点所在格。默认天元——那是五子棋的第一手，也是个合理的起点。
  const [focused, setFocused] = useState<Point>(CENTER_POINT)
  const focusCellRef = useRef<SVGRectElement | null>(null)

  /**
   * 棋盘此刻是否真的握着 DOM 焦点。
   *
   * 焦点环按它显隐，而不是按 `focused`——`focused` 是「Tab 会落在哪一格」的
   * roving 停靠点，开局就有一个（天元），拿它当焦点指示会在空盘上凭空画一个环。
   *
   * 监听挂在 `<svg>` 上一对，**不是每格一个**：225 个 focus 处理器会让每次
   * 焦点变化都重建整盘，实测把用例耗时翻了一倍（14s → 24s）。
   */
  const [hasFocus, setHasFocus] = useState(false)

  /**
   * 把 DOM 焦点搬到某一格上。
   *
   * roving tabindex 只改 `tabIndex` 是不够的——读屏软件跟的是**真实的焦点**，
   * 不搬它就等于键盘用户在原地打转。真正的 `focus()` 放在 effect 里：
   * 那时 React 已经把新的 tabIndex 落到 DOM 上了（组件测试里也是同步的，
   * 用 rAF 会和断言抢时间）。
   *
   * **挂载时不抢焦点**：页面加载就把焦点拽到棋盘上，对屏幕阅读器用户是
   * 一种绑架——只有键盘真的移动过焦点（`movedByKeyboard`）才搬。
   */
  const movedByKeyboardRef = useRef(false)

  const moveFocus = (point: Point): void => {
    movedByKeyboardRef.current = true
    setFocused(point)
  }

  useEffect(() => {
    if (!interactive || !movedByKeyboardRef.current) return
    // 只在焦点还留在棋盘上、或已经掉到 body 时才接管。轮到 AI 时整盘不可聚焦，
    // 焦点会掉到 body；但玩家也可能趁这段时间 Tab 到「悔棋」上——
    // 那时把焦点抢回棋盘是帮倒忙。
    const active = document.activeElement
    const unclaimed =
      active === null ||
      active === document.body ||
      active === document.documentElement ||
      active.getAttribute('role') === 'gridcell'
    if (!unclaimed) return
    focusCellRef.current?.focus()
  }, [focused, interactive])

  const handleKeyDown = (event: ReactKeyboardEvent, point: Point): void => {
    if (!interactive) return

    const step: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    }

    const delta = step[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      // 越界即停，不绕回另一头——棋盘不是环面
      const next = { x: point.x + delta.x, y: point.y + delta.y }
      if (next.x >= 0 && next.x < BOARD_SIZE && next.y >= 0 && next.y < BOARD_SIZE) {
        moveFocus(next)
      }
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      moveFocus({ x: event.key === 'Home' ? 0 : BOARD_SIZE - 1, y: point.y })
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleClick(point)
    }
  }

  /**
   * 焦点环画成 SVG 元素，而不是靠 CSS 的 outline。
   *
   * SVG 里 outline-width / outline-offset 按**用户坐标**算：1 单位 = 一整格，
   * 于是 `outline: 2px` 变成两个格子宽的边框，焦点框能横跨半个棋盘（实测踩到，
   * 只有截图看得见）。自己画一枚环，单位就是棋盘自己的坐标系，多大就是多大。
   */
  const focusRing = interactive && hasFocus ? (
    <circle
      data-testid="focus-ring"
      cx={focused.x}
      cy={focused.y}
      r={0.56}
      fill="none"
      stroke="var(--c-accent)"
      strokeWidth={0.07}
      pointerEvents="none"
    />
  ) : null

  /** 一格的可读名：坐标 + 状态。键盘用户靠它知道自己在哪、这一格有什么。 */
  const cellLabel = (point: Point): string => {
    const cell = board[idx(point.x, point.y)]
    const base = formatPoint(point)
    if (cell === 0) return `${base} 空位`
    const who = cell === 1 ? '黑棋' : '白棋'
    const isLast = lastMove !== null && lastMove.x === point.x && lastMove.y === point.y
    return isLast ? `${base} ${who}（最后一手）` : `${base} ${who}`
  }

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
    // 点过哪一格，Tab 停靠点就跟到哪一格——否则点完再按方向键会从旧格继续。
    // 不走 moveFocus：那是键盘路径，不该让鼠标也开启「AI 走完自动还焦点」。
    setFocused(point)
    onPlay(point)
  }

  const visibleMarks = marks ?? []

  const stones: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[idx(x, y)] !== 0) stones.push({ x, y })
    }
  }

  return (
    <svg
      data-testid="board"
      viewBox={VIEW_BOX}
      style={SVG_STYLE}
      className="h-full w-full select-none"
      role={interactive ? 'grid' : 'img'}
      aria-label={
        interactive
          ? `五子棋棋盘，已落子 ${stones.length} 手。用方向键移动、回车落子。`
          : `五子棋棋盘，已落子 ${stones.length} 手${lastMove ? `，最后一手在 ${formatPoint(lastMove)}` : ''}`
      }
      onMouseLeave={() => setHovered(null)}
      // 焦点进出整盘各一次；格与格之间移动会成对触发，React 会合并成一次更新
      onFocus={() => setHasFocus(true)}
      onBlur={() => setHasFocus(false)}
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
              {columnLabel(x)}
            </text>
          ))}
          {AXIS.map((x) => (
            <text key={`colBottom${x}`} data-testid="coord" x={x} y={EXTENT + 0.6}>
              {columnLabel(x)}
            </text>
          ))}
          {AXIS.map((y) => (
            <text key={`rowLeft${y}`} data-testid="coord" x={-0.6} y={y}>
              {rowLabel(y)}
            </text>
          ))}
          {AXIS.map((y) => (
            <text key={`rowRight${y}`} data-testid="coord" x={EXTENT + 0.6} y={y}>
              {rowLabel(y)}
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
              // 只有最新一手播落下动效——每颗子都播会让整盘一起闪
              className={key === lastKey ? motionClass('stoneDrop') : undefined}
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
                  className={motionClass('lastMovePulse')}
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

      {/*
        标记压在最后一手环与胜利连线之上、命中区之下。
        配色与最后一手的朱砂环分得开；命中区在最后，点击照常落到交叉点上。
      */}
      {visibleMarks.length > 0 && (
        <g data-testid="board-marks" pointerEvents="none">
          {visibleMarks.map((mark, index) => {
            const tone = mark.tone ?? 'accent'
            const radius = mark.radius ?? 0.4

            return (
              <g
                key={pointKey(mark.point)}
                data-testid={`board-mark-${mark.point.x}-${mark.point.y}`}
                data-tone={tone}
              >
                <circle
                  cx={mark.point.x}
                  cy={mark.point.y}
                  r={radius}
                  fill={MARK_FILL[tone]}
                  opacity={0.92}
                />
                <text
                  x={mark.point.x}
                  y={mark.point.y}
                  fontSize={radius * 1.25}
                  fontFamily="var(--font-mono)"
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--c-accent-fg)"
                >
                  {mark.label ?? String(index + 1)}
                </text>
              </g>
            )
          })}
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

      {focusRing}

      {/*
        命中区。可交互时按 ARIA grid 组织：每行是一个 role="row"，
        每格是 role="gridcell"——gridcell 必须有 row 作上下文，
        平铺 225 个 cell 是无主的。只读（回放）时不加这些语义。
      */}
      <g>
        {AXIS.map((y) => (
          <g key={y} role={interactive ? 'row' : undefined}>
            {AXIS.map((x) => {
              const point = { x, y }
              const occupied = board[idx(x, y)] !== 0
              const playable = interactive && !occupied
              const isFocusStop = focused.x === x && focused.y === y

              return (
                <rect
                  key={pointKey(point)}
                  ref={isFocusStop ? focusCellRef : undefined}
                  data-testid={`intersection-${x}-${y}`}
                  role={interactive ? 'gridcell' : undefined}
                  aria-label={interactive ? cellLabel(point) : undefined}
                  tabIndex={interactive ? (isFocusStop ? 0 : -1) : undefined}
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
                  onKeyDown={(event) => handleKeyDown(event, point)}
                />
              )
            })}
          </g>
        ))}
      </g>
    </svg>
  )
}
