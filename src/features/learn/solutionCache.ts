import type { Point } from '../../core/types'
import { solveMove } from '../../learn/hints'
import type { Practice } from '../../learn/types'
import { parseBoardLines } from '../../lib/board-lines'

/** 一道题的求解器。注入是为了让缓存本身可单测，不依赖真实算杀。 */
export type PracticeSolver = (practice: Practice) => Point | null

/**
 * 按 `Practice` 对象缓存求解结果。
 *
 * **为什么需要它**：第三级提示要在渲染路径上同步跑一遍求解。实测（Phase 09A
 * `yarn bench:learn`）最慢 5.15 ms——不构成卡顿，缓存省下的是「再做一次」时
 * 重复付的那几毫秒，属于顺手的小优化，不是性能修复。求解是纯函数，同一道题
 * 的结果不会变；但「再做一次」会重建 `PracticeBoard`，没有缓存就得**再付一次**。
 *
 * **只缓存非 null**：`null` 可能是「这道题无解」，也可能是「算杀预算耗尽」——
 * 后者下一次预算可能就够了。把 null 缓存下来会把它变成永久结论。
 *
 * 键是 `Practice` 对象本身（题库/课程里的静态对象），用 `WeakMap` 不持有引用、
 * 不需要清理；换题自然换键，不会串题。
 */
export function createSolutionCache(solve: PracticeSolver): PracticeSolver {
  const cache = new WeakMap<Practice, Point>()

  return (practice) => {
    const hit = cache.get(practice)
    if (hit !== undefined) return hit

    const found = solve(practice)
    if (found !== null) cache.set(practice, found)
    return found
  }
}

/** 生产用的求解入口：解析盘面 → `solveMove`（时钟按约定注入）。 */
export const solvePractice = createSolutionCache((practice) =>
  solveMove(parseBoardLines(practice.board.lines), practice.player, practice.goal, Date.now),
)
