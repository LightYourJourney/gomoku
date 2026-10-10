import { createBoard, idx } from '../core/board'
import { BOARD_SIZE, type Board, type Point } from '../core/types'

/**
 * 字符画 ↔ 棋盘的解析器住在 `lib/board-lines.ts`——课程与题库是产品内容，
 * 运行时要用它，不能依赖只给测试用的模块。
 *
 * 这里保留旧名字转发一层，免得一次性改十几个测试文件的 import；
 * 谁改到哪个文件顺手换成新名即可。
 */
export {
  formatBoardLines as linesFromBoard,
  parseBoardLines as boardFromLines,
} from '../lib/board-lines'

/**
 * 接近填满、但**构造上不存在五连**的局面。
 *
 * 上色规则 `(x + 2y) % 4 < 2`，四个方向上最长只连得出两颗子，所以既不会触发
 * 「必胜」也不会触发「必防」的捷径，搜索真的会跑起来；留出 `holes` 个空位，
 * 候选点因而很少。
 *
 * **不要拿「相邻行黑白交替」那类填充当近似满盘用**：那样主对角线 `x === y`
 * 全是一色，黑棋早就连成十四子，引擎只会走必防捷径——用它当样本，测的其实是
 * 捷径而不是满盘。
 */
export function nearlyFullBoard(holes: readonly Point[] = DEFAULT_HOLES): Board {
  const board = createBoard()

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      board[idx(x, y)] = (x + 2 * y) % 4 < 2 ? 1 : 2
    }
  }

  for (const { x, y } of holes) board[idx(x, y)] = 0

  return board
}

/** 八个空位，分散在棋盘中部，互不构成威胁。 */
const DEFAULT_HOLES: readonly Point[] = [
  { x: 7, y: 7 },
  { x: 6, y: 6 },
  { x: 8, y: 8 },
  { x: 5, y: 5 },
  { x: 9, y: 9 },
  { x: 7, y: 8 },
  { x: 8, y: 7 },
  { x: 3, y: 3 },
]
