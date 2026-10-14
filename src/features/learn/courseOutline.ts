import type { Lesson } from '../../learn/types'
import type { LearningProgress } from '../../persist/progress'

/**
 * 课程的分阶段展示。
 *
 * **这是展示层的分组，不是内容层的事实。** 所以它住在 `features/learn/` 而不是
 * `learn/lessons.ts`：内容层由 `content.test.ts` 守着，往里加一个「这课属于哪一组」
 * 就等于让内容替界面表态（`AGENTS.md` 的依赖方向也是这么分的：
 * `features → learn` 单向）。
 *
 * 分组的依据是**课程实际讲什么**（任务书 §二 也要求以现有内容为准）：
 * 规则与二 → 三与四 → 双威胁与防守 → 组合与算杀。**不改写任何课程事实来迁就分组。**
 */
export interface Stage {
  readonly id: string
  readonly title: string
  readonly lessonIds: readonly string[]
}

export const STAGES: readonly Stage[] = [
  { id: 'basics', title: '基础入门', lessonIds: ['rules', 'two'] },
  { id: 'shapes', title: '棋型进阶', lessonIds: ['three', 'four'] },
  { id: 'tactics', title: '攻防策略', lessonIds: ['double', 'defense'] },
  { id: 'combat', title: '综合实战', lessonIds: ['combo', 'vcf'] },
]

/**
 * 「继续学习」指向谁：**第一节还没做完的**；全做完了就是 `allDone`。
 *
 * **这里刻意不看 `lastVisited`**，理由是它会是一条到不了的分支：
 * 列表页显示出来的前提就是「`lastVisited` 不是一节有效的课」——
 * 装载时若它是，`LearnScreen` 会把那一节直接展开（那条恢复逻辑有自己的用例）；
 * 玩家点「← 课程列表」时又会把它清成 `null`。
 * 所以「优先上次停留的那节」这个写法在本应用里**一次都不会执行**，
 * 留着就是纸面防御（本仓在 `AiInfo.move` 上吃过一次同形的亏，见 `PHASE_03.md` §17.2）。
 *
 * 顺带这也意味着推荐稳定：**复习已完成的课时，顶部不会推荐那节已经做完的课**——
 * 「看谁没做完」天然排除了它。
 */
export type NextUp = { readonly kind: 'lesson'; readonly id: string } | { readonly kind: 'allDone' }

export function resolveNext(lessons: readonly Lesson[], progress: LearningProgress): NextUp {
  const done = new Set(progress.completedLessons)
  const firstOpen = lessons.find((lesson) => !done.has(lesson.id))

  return firstOpen === undefined ? { kind: 'allDone' } : { kind: 'lesson', id: firstOpen.id }
}
