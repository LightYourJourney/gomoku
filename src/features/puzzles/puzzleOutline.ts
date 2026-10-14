import type { Puzzle, PuzzleCategory } from '../../learn/types'

/**
 * 残局列表页要用到的三条**派生**逻辑。
 *
 * 全是纯函数，住在 `features/` 而不是 `learn/`：`learn/` 是内容层（题库、
 * 判定、提示），而这里算的是**界面要显示什么**——与 `courseOutline.ts` 同理。
 * 依赖方向不变（`features → learn`）。
 *
 * 没有一条读进度存储：完成记录以 `readonly string[]` 传进来，
 * 于是这些函数不需要 store、不需要 IndexedDB，测试里直接给数组。
 */

/** 第一道还没通过的题。全通过了返回 `null`。 */
export function resolveNextPuzzle(
  puzzles: readonly Puzzle[],
  solved: readonly string[],
): Puzzle | null {
  const done = new Set(solved)
  return puzzles.find((puzzle) => !done.has(puzzle.id)) ?? null
}

export interface CategoryProgress {
  readonly category: PuzzleCategory
  readonly done: number
  readonly total: number
}

/**
 * 每个分类的完成数。
 *
 * **顺序取「分类在题库里首次出现的顺序」**，不另收一张顺序表：输出完全由输入决定，
 * 换一份题库顺序就跟着它走（`PUZZLES` 的声明顺序本来就等于题型表的顺序，
 * 有一条用例钉着这一点）。
 *
 * `done` 用 `Set` 数而不是 `filter(...).length` 两遍：重复 id 不会把它顶到
 * `total` 以上——进度数组来自存储，是一个可以被手改的输入。
 */
export function categoryProgress(
  puzzles: readonly Puzzle[],
  solved: readonly string[],
): readonly CategoryProgress[] {
  const done = new Set(solved)
  const order: PuzzleCategory[] = []
  const counts = new Map<PuzzleCategory, { done: number; total: number }>()

  for (const puzzle of puzzles) {
    let entry = counts.get(puzzle.category)
    if (entry === undefined) {
      entry = { done: 0, total: 0 }
      counts.set(puzzle.category, entry)
      order.push(puzzle.category)
    }

    entry.total += 1
    if (done.has(puzzle.id)) entry.done += 1
  }

  return order.map((category) => ({ category, ...counts.get(category)! }))
}

/**
 * 题库里的下一道题；已经是最后一道（或者 id 根本不在题库里）时返回 `null`。
 *
 * 两种「没有下一题」合成同一个返回值是刻意的：调用方要做的事一模一样
 * ——把出口换成结束状态。分开表达只会多一个没人处理的分支。
 */
export function nextPuzzleAfter(puzzles: readonly Puzzle[], id: string): Puzzle | null {
  const index = puzzles.findIndex((puzzle) => puzzle.id === id)
  return index === -1 ? null : (puzzles[index + 1] ?? null)
}
