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

/**
 * 「继续挑战」指向哪一道。
 *
 * 默认是**第一道还没通过的**；给了 `preferredCategory`（本次会话里刚打开过的那一类）
 * 且那一类还有没做的，就优先给那一类里的第一道——**跳着练的人不会被弹回最前面**。
 * 那一类做完了就照常回退，所以它只是排序上的偏好，不会扣住人。
 *
 * **偏好只能来自会话内记忆，不能读 `lastVisited`。** 点「← 残局列表」会把它清成
 * `null`，而列表页能显示的前提正是它不是一道有效的题——读它的那个分支**到不了**
 * （与 Phase 04 删掉的 `resolveNext` 优先分支同类）。代价是刷新列表页后偏好丢失，
 * 回退成「第一道没做的」；换成持久化能修，但那要新增状态，而任务书 §四 要求
 * 这类东西由现有数据推导。
 *
 * 全通过了返回 `null`——那时偏好不影响结论。
 */
export function resolveNextPuzzle(
  puzzles: readonly Puzzle[],
  solved: readonly string[],
  preferredCategory?: PuzzleCategory | null,
): Puzzle | null {
  const done = new Set(solved)
  const isOpen = (puzzle: Puzzle): boolean => !done.has(puzzle.id)

  if (preferredCategory != null) {
    const inCategory = puzzles.find((puzzle) => puzzle.category === preferredCategory && isOpen(puzzle))
    if (inCategory !== undefined) return inCategory
  }

  return puzzles.find(isOpen) ?? null
}

export interface CategoryGroup {
  readonly category: PuzzleCategory
  /** 这一类里的题，题库顺序。 */
  readonly puzzles: readonly Puzzle[]
  readonly done: number
}

/**
 * 按分类分组，并数出每一类做完了几道。
 *
 * **连成员一起给**，不只给计数。初版只返回 `{ category, done, total }`，
 * 于是消费方拿到计数之后还得自己再 `puzzles.filter(...)` 找一遍成员——
 * 分组做了两遍，而且那两遍的「一类里有哪些题」是同一个问题的两个答案。
 * 现在 `total` 就是 `puzzles.length`，不留一个会跟成员对不上的冗余字段。
 *
 * **顺序取「分类在题库里首次出现的顺序」**，不另收一张顺序表：输出完全由输入决定，
 * 换一份题库顺序就跟着它走（`PUZZLES` 的声明顺序本来就等于题型表的顺序，
 * 有一条用例钉着这一点）。
 *
 * `done` 用 `Set` 数而不是 `filter(...).length`：重复 id 不会把它顶到
 * `puzzles.length` 以上——进度数组来自存储，是一个可以被手改的输入。
 */
export function categoryProgress(
  puzzles: readonly Puzzle[],
  solved: readonly string[],
): readonly CategoryGroup[] {
  const done = new Set(solved)
  const order: PuzzleCategory[] = []
  const groups = new Map<PuzzleCategory, { puzzles: Puzzle[]; done: number }>()

  for (const puzzle of puzzles) {
    let entry = groups.get(puzzle.category)
    if (entry === undefined) {
      entry = { puzzles: [], done: 0 }
      groups.set(puzzle.category, entry)
      order.push(puzzle.category)
    }

    entry.puzzles.push(puzzle)
    if (done.has(puzzle.id)) entry.done += 1
  }

  return order.map((category) => {
    const group = groups.get(category)!
    return { category, puzzles: group.puzzles, done: group.done }
  })
}

/**
 * 全部通过时那句话。
 *
 * 两处都在说同一件事（列表页的进度块、详情页的 footer），所以它**只有一份**。
 * 两轴审查时这两处已经漂了——一处写「用用看吧。」、另一处写「用用看。」
 * ——正是「同一句话抄两遍」的必然结局。改文案现在只改这里。
 */
export function allDoneText(total: number): string {
  return `${total} 道题都通过了——这些棋型，去实战里用用看。`
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
