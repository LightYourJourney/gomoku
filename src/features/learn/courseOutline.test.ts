import { describe, expect, it } from 'vitest'
import { LESSONS } from '../../learn/lessons'
import { EMPTY_PROGRESS, type LearningProgress } from '../../persist/progress'
import { STAGES, resolveNext, stageOf } from './courseOutline'

function progressOf(patch: Partial<LearningProgress>): LearningProgress {
  return { ...EMPTY_PROGRESS, ...patch }
}

/**
 * 分组表是**展示层**的东西，但它必须与内容层严丝合缝对得上。
 *
 * 这两条守的是同一类事故：加了第 9 节课，而它没被登记进任何一组——
 * 于是它从列表里**静默消失**（本仓吃过一次同形的亏：Phase 02 的三颗控件
 * 从探针扫描里没了，而所有测试都是绿的，见 `PHASE_02.md`）。
 */
describe('课程分组表', () => {
  it('八节课恰好各出现一次，一节课都不多、不少', () => {
    const listed = STAGES.flatMap((stage) => stage.lessonIds)

    expect([...listed].sort()).toEqual(LESSONS.map((lesson) => lesson.id).sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('顺序与 LESSONS 一致——分组只是切段，不重排课程', () => {
    const listed = STAGES.flatMap((stage) => stage.lessonIds)

    expect(listed).toEqual(LESSONS.map((lesson) => lesson.id))
  })

  it('每组都有名字，且没有空组', () => {
    for (const stage of STAGES) {
      expect(stage.title).not.toBe('')
      expect(stage.lessonIds.length).toBeGreaterThan(0)
    }
  })

  it('stageOf 认得出每一节课', () => {
    for (const lesson of LESSONS) {
      expect(stageOf(lesson.id)).not.toBeNull()
    }
  })

  it('stageOf 对不存在的 id 返回 null，而不是硬塞一组', () => {
    expect(stageOf('not-a-lesson')).toBeNull()
  })
})

/**
 * 「继续学习」指向谁。
 *
 * 规则只有一条：**第一节还没做完的**；全做完了就是 `allDone`。
 * 硬编码一节课的名字在这里是不允许的——任务书 §三 要求进度全部来自真实状态。
 *
 * `lastVisited` **不参与**，理由见下面那条用例。
 */
describe('继续学习指向哪一节', () => {
  it('一节课都没做过时，指向第一节', () => {
    expect(resolveNext(LESSONS, EMPTY_PROGRESS)).toEqual({ kind: 'lesson', id: 'rules' })
  })

  /**
   * **`lastVisited` 不参与推荐**，这是刻意的——它在应用里到不了。
   *
   * 列表页能显示，前提就是「`lastVisited` 不是一节有效的课」：装载时若它是，
   * `LearnScreen` 会把那一节直接展开；点「← 课程列表」时又会清成 null。
   * 所以这里连摆三种 `lastVisited`（一节没做完的课、一节做完的课、一个残局），
   * 结论都必须一样。
   */
  it('不看 lastVisited：它是什么都不影响推荐', () => {
    const base = { completedLessons: ['rules'] }

    for (const lastVisited of [
      { kind: 'lesson' as const, id: 'three' },
      { kind: 'lesson' as const, id: 'rules' },
      { kind: 'lesson' as const, id: 'gone' },
      { kind: 'puzzle' as const, id: 'win-1' },
      null,
    ]) {
      expect(resolveNext(LESSONS, progressOf({ ...base, lastVisited }))).toEqual({
        kind: 'lesson',
        id: 'two',
      })
    }
  })

  it('中途跳着做也不影响：指向第一节没做完的，而不是「最后一个做完的下一节」', () => {
    const progress = progressOf({ completedLessons: ['rules', 'double'] })

    expect(resolveNext(LESSONS, progress)).toEqual({ kind: 'lesson', id: 'two' })
  })

  it('八节全做完时给 allDone', () => {
    const progress = progressOf({ completedLessons: LESSONS.map((lesson) => lesson.id) })

    expect(resolveNext(LESSONS, progress)).toEqual({ kind: 'allDone' })
  })
})
