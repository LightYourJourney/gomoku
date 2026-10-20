import { BLACK, CELL_COUNT, WHITE, type Board, type Player } from '../core/types'
import { EVALUATION_LINES, LINES_BY_CELL, scoreLine } from './evaluate'

/**
 * 增量局面评估（Phase 10B 的**实验性原型**）。
 *
 * ## 它解决什么
 *
 * `evaluateBoard()` 每次都要扫完全部 72 条线段。搜索里绝大多数节点的分数来自
 * 叶子评估，这一步因此是当前引擎最贵的单项（见 `docs/ai-research/CPU_PROFILE.md`）。
 *
 * 但落下一颗棋子只可能改变**经过该交叉点**的那几条线：横、竖、两条斜向，
 * 最多 4 条（边角上长度不足 5 的斜线不在评估集合里，所以常常只有 2–3 条）。
 * 其余 68 条以上的线分数原封不动。
 *
 * ## 它保证什么
 *
 * **与 `evaluateBoard()` 逐位相等**，不是近似：
 *
 * - 每条线仍调用同一个 `scoreLine()`（`evaluate.ts` 导出，**只有这一份实现**）；
 * - 总分维护的是「每条线各自的黑分、白分之和」，整数运算，不引入浮点误差；
 * - 撤销恢复的是落子前**存下来的旧值**，不是重算——重算会让「撤销」也变成一次
 *   全量更新的开销，而这个原型要回答的正是「更新 + 撤销」加起来值不值。
 *
 * 一致性由 `incrementalEvaluate.test.ts` 钉住：手写局面 + 随机差分（含随机穿插
 * 撤销），每一步都比对黑白两个视角。
 *
 * ## 它不是什么
 *
 * - **不是新的启发式**。分值规则完全沿用现有评估，不调整任何权重。
 * - **不是生产路径**。搜索还没有接它（那要看 Phase 10B 的实测结论）。
 * - **不拥有全局状态**。每个实例自带棋盘副本与撤销栈，可以同时存在多个。
 */

/** 一个交叉点最多被 4 条评估线段经过（横 / 竖 / 两条斜向）。 */
const MAX_LINES_PER_CELL = 4

interface Frame {
  cell: number
  count: number
  readonly lineIds: Int32Array
  readonly oldBlack: Float64Array
  readonly oldWhite: Float64Array
  totalBlack: number
  totalWhite: number
}

export interface IncrementalEvaluator {
  /**
   * 当前棋盘（**内部副本**，只读）。
   *
   * 构造时传入的棋盘不会被修改；要落子请走 `place()`。
   */
  readonly board: Board
  /** 当前撤销栈深度，等于已落子且未撤销的手数。 */
  readonly depth: number
  /** `player` 视角的总分，与 `evaluateBoard(board, player)` 相等。 */
  score(player: Player): number
  /** 落一子并更新受影响的线段。只接受空点。 */
  place(index: number, player: Player): void
  /** 撤销最近一次 `place()`，恢复它之前的全部分数。 */
  undo(): void
}

export function createIncrementalEvaluator(source: Board): IncrementalEvaluator {
  if (source.length !== CELL_COUNT) {
    throw new Error(`棋盘长度应为 ${CELL_COUNT}，收到 ${source.length}`)
  }

  // 副本：调用方的棋盘永远不会被这里改动（搜索靠这一条保证输入不变）
  const board = source.slice()
  const lineCount = EVALUATION_LINES.length
  const lineBlack = new Float64Array(lineCount)
  const lineWhite = new Float64Array(lineCount)

  let totalBlack = 0
  let totalWhite = 0

  for (let lineId = 0; lineId < lineCount; lineId++) {
    const line = EVALUATION_LINES[lineId]!
    const black = scoreLine(board, line, BLACK)
    const white = scoreLine(board, line, WHITE)
    lineBlack[lineId] = black
    lineWhite[lineId] = white
    totalBlack += black
    totalWhite += white
  }

  const frames: Frame[] = []
  let depth = 0

  /** 复用同一深度上的帧对象，避免每次落子都分配一个新对象。 */
  function frameAt(level: number): Frame {
    const existing = frames[level]
    if (existing !== undefined) return existing
    const frame: Frame = {
      cell: -1,
      count: 0,
      lineIds: new Int32Array(MAX_LINES_PER_CELL),
      oldBlack: new Float64Array(MAX_LINES_PER_CELL),
      oldWhite: new Float64Array(MAX_LINES_PER_CELL),
      totalBlack: 0,
      totalWhite: 0,
    }
    frames[level] = frame
    return frame
  }

  return {
    get board(): Board {
      return board
    },

    get depth(): number {
      return depth
    },

    score(player: Player): number {
      // `evaluateBoard` 的语义是「己方总分 − 对手总分」，不是「己方总分」。
      // 两种颜色的线分都维护着，是因为落子/撤销都要按线回滚；对外只暴露差值。
      return player === BLACK ? totalBlack - totalWhite : totalWhite - totalBlack
    },

    place(index: number, player: Player): void {
      if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) {
        throw new Error(`落子下标越界：${index}`)
      }
      if (board[index] !== 0) {
        throw new Error(`交叉点 ${index} 已被占用`)
      }

      const lineIds = LINES_BY_CELL[index]!
      const frame = frameAt(depth)
      frame.cell = index
      frame.count = lineIds.length
      frame.totalBlack = totalBlack
      frame.totalWhite = totalWhite

      board[index] = player

      for (let i = 0; i < lineIds.length; i++) {
        const lineId = lineIds[i]!
        const line = EVALUATION_LINES[lineId]!
        const oldB = lineBlack[lineId]!
        const oldW = lineWhite[lineId]!

        frame.lineIds[i] = lineId
        frame.oldBlack[i] = oldB
        frame.oldWhite[i] = oldW

        const nextB = scoreLine(board, line, BLACK)
        const nextW = scoreLine(board, line, WHITE)

        totalBlack += nextB - oldB
        totalWhite += nextW - oldW
        lineBlack[lineId] = nextB
        lineWhite[lineId] = nextW
      }

      depth++
    },

    undo(): void {
      if (depth === 0) throw new Error('撤销栈为空')

      depth--
      const frame = frames[depth]!
      board[frame.cell] = 0

      for (let i = 0; i < frame.count; i++) {
        const lineId = frame.lineIds[i]!
        lineBlack[lineId] = frame.oldBlack[i]!
        lineWhite[lineId] = frame.oldWhite[i]!
      }

      totalBlack = frame.totalBlack
      totalWhite = frame.totalWhite
    },
  }
}
