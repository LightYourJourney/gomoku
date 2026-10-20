import { idx, inBounds } from '../core/board'
import { BOARD_SIZE, CELL_COUNT, type Board, type Point } from '../core/types'
import { countCall } from './metrics'

/**
 * 候选点搜索半径。
 *
 * 五子棋的着法几乎总落在已有棋子附近，遍历全部空位既慢又无意义。
 * 半径 1 足以覆盖所有能立刻连成五的点，半径 2 用来给中长期的棋型留出空间。
 */
export const NEIGHBOR_RADIUS = 2

/**
 * 返回所有「已有棋子邻域内」的空位。
 * 空盘与满盘都返回空数组——两种情况由调用方分别处理成「下天元」与「无棋可走」。
 */
export function candidateMoves(board: Board, radius: number = NEIGHBOR_RADIUS): Point[] {
  countCall('candidateMoves')

  const moves: Point[] = []
  const seen = new Uint8Array(CELL_COUNT)

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[idx(x, y)] === 0) continue

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (!inBounds(nx, ny)) continue

          const index = idx(nx, ny)
          if (board[index] !== 0 || seen[index] === 1) continue

          seen[index] = 1
          moves.push({ x: nx, y: ny })
        }
      }
    }
  }

  return moves
}
