import { idx, opponentOf } from '../../src/core/board'
import { findWinLine, validateMove } from '../../src/core/rules'
import { BOARD_SIZE, type Board, type Player, type Point } from '../../src/core/types'

/**
 * 独立的强制胜证明器。
 *
 * **它不调用搜索引擎**，只依赖 `core/rules.ts` 的合法性与成五判定，
 * 因此可以作为「标准答案」用来验收引擎：如果证明器说某局面存在三手强制胜，
 * 引擎却没走出一条强制胜的路线，那是引擎的问题，不是证明器在复读引擎。
 *
 * ## 只证明「3 手强制胜」
 *
 * 定义：存在我方着法 m，使得**对手无论怎么应**，我方下一步都有成五点。
 * 这是 VCF（连续冲四）的最短形态，也是本阶段局面库里唯一断言的强制胜类型。
 * 更长的链需要真正的搜索，那会把「证明器」变成第二个引擎，失去独立性。
 *
 * ## 为什么枚举半径是 4
 *
 * 成五需要一个 5 连窗口，窗口内最远的同色子可能在 4 格外，所以「能落子影响
 * 胜负」的点一定在已有棋子的 4 格以内。半径取 4 不会漏掉任何可能改变结论的着法；
 * 更远的应手既不堵我、也不可能自己成五，对结论没有影响。
 */

const PROOF_RADIUS = 4

function inRange(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE
}

/** 我方在此落子后的棋盘；调用方保证该点为空。 */
function withStone(board: Board, point: Point, player: Player): Board {
  const next = board.slice()
  next[idx(point.x, point.y)] = player
  return next
}

/** 这一步能否立即成五。 */
function winsAt(board: Board, point: Point, player: Player): boolean {
  if (validateMove(board, point) !== null) return false
  return findWinLine(withStone(board, point, player), point) !== null
}

/** 当前方所有「一步成五」的点。 */
export function winningPoints(board: Board, player: Player): Point[] {
  const points: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[idx(x, y)] !== 0) continue
      const point = { x, y }
      if (winsAt(board, point, player)) points.push(point)
    }
  }
  return points
}

/**
 * 值得枚举的落点：已有棋子的 `PROOF_RADIUS` 格以内。
 * 空盘返回天元（唯一的对称代表）。
 */
function relevantPoints(board: Board): Point[] {
  const points: Point[] = []
  let any = false

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[idx(x, y)] === 0) continue
      any = true
      for (let dy = -PROOF_RADIUS; dy <= PROOF_RADIUS; dy++) {
        for (let dx = -PROOF_RADIUS; dx <= PROOF_RADIUS; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (!inRange(nx, ny) || board[idx(nx, ny)] !== 0) continue
          points.push({ x: nx, y: ny })
        }
      }
    }
  }

  if (!any) return [{ x: Math.floor(BOARD_SIZE / 2), y: Math.floor(BOARD_SIZE / 2) }]

  // 去重（同一空点会被多颗邻居重复推入）
  const seen = new Set<number>()
  return points.filter((p) => {
    const key = idx(p.x, p.y)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface ForcedWinProof {
  /** 证明成立时给出的第一步。 */
  readonly move: Point
  /** 对手所有应手之后的落点集合（用于说明「无论怎么应」覆盖了哪些点）。 */
  readonly repliesChecked: number
}

/**
 * 证明「当前方存在 3 手强制胜」。
 *
 * 返回 null 表示**证明不出来**——注意这不等于「不存在」，只是本证明器
 * 不搜索更长的链。报告与文档必须这样表述。
 */
export function proveForcedWin(board: Board, player: Player): ForcedWinProof | null {
  const opponent = opponentOf(player)

  // 已经能一步成五，直接算成立（更短的胜也满足「对手怎么应都输」）。
  const now = winningPoints(board, player)
  if (now.length > 0) return { move: now[0]!, repliesChecked: 0 }

  // 对手此刻就能成五：我方必须先堵，无法在本回合内完成强制胜。
  if (winningPoints(board, opponent).length > 0) return null

  for (const move of relevantPoints(board)) {
    const afterMine = withStone(board, move, player)
    if (findWinLine(afterMine, move) !== null) {
      return { move, repliesChecked: 0 }
    }

    // 我这一手之后，对手若已有成五点，他会直接赢——这手不成立。
    if (winningPoints(afterMine, opponent).length > 0) continue

    /*
     * 对手的每一种应手之后，我方都必须还有成五点。
     * 半径 4 之外的点既堵不住我、也不可能自己成五，所以枚举是完备的。
     */
    let ok = true
    let replies = 0

    for (const reply of relevantPoints(afterMine)) {
      replies++
      const afterReply = withStone(afterMine, reply, opponent)
      if (findWinLine(afterReply, reply) !== null) {
        // 对手这一手自己成五，博弈已结束
        ok = false
        break
      }
      if (winningPoints(afterReply, player).length === 0) {
        ok = false
        break
      }
    }

    if (ok) return { move, repliesChecked: replies }
  }

  return null
}
