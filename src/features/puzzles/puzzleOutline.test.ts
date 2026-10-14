import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, PUZZLES } from '../../learn/puzzles'
import { categoryProgress, nextPuzzleAfter, resolveNextPuzzle } from './puzzleOutline'

const ALL_IDS = PUZZLES.map((puzzle) => puzzle.id)

/**
 * 「继续挑战」指向哪一道。
 *
 * 规则只有一条：**第一道还没通过的**；全通过了就是 `null`。
 * 与课程那边的 `resolveNext` 同一条口径，也同样**不看 `lastVisited`**
 * ——列表页能显示，前提就是它不再是一道有效的题（装载时会直接展开它，
 * 退出时会清成 null）。
 */
describe('继续挑战指向哪一道', () => {
  it('一道都没做过时指向第一道', () => {
    expect(resolveNextPuzzle(PUZZLES, [])?.id).toBe('win-h')
  })

  it('中途跳着做也不影响：指向第一道没做的，而不是「最后做完的那道之后」', () => {
    expect(resolveNextPuzzle(PUZZLES, ['win-h', 'block-h', 'vcf-basic'])?.id).toBe('win-diag')
  })

  it('十五道全做完时返回 null', () => {
    expect(resolveNextPuzzle(PUZZLES, ALL_IDS)).toBeNull()
  })

  it('进度里混着已经删掉的 id 也不影响——它不参与查找', () => {
    expect(resolveNextPuzzle(PUZZLES, ['已经删掉的题'])?.id).toBe('win-h')
  })
})

/**
 * 「下一题」按**题库声明的顺序**走。
 *
 * 不按分类内循环：`PUZZLES` 的顺序就是唯一的真实顺序（分类顺序 × 类内顺序），
 * 另造一条顺序就是第二个真相。跨分类往下走也符合训练流程的直觉——一类做完接着做下一类。
 */
describe('下一题', () => {
  it('同一分类内往下走', () => {
    expect(nextPuzzleAfter(PUZZLES, 'win-h')?.id).toBe('win-diag')
  })

  it('**跨分类**时也照走不误', () => {
    // win-vertical 是「一步获胜」的最后一道，下一道是「挡住直接胜着」的第一道
    expect(nextPuzzleAfter(PUZZLES, 'win-vertical')?.id).toBe('block-h')
  })

  it('最后一道返回 null——「没有下一题」是它该有的意思', () => {
    const last = PUZZLES[PUZZLES.length - 1]!
    expect(nextPuzzleAfter(PUZZLES, last.id)).toBeNull()
  })

  it('id 不存在时也返回 null，而不是猜一道题出来', () => {
    expect(nextPuzzleAfter(PUZZLES, '根本没有这道题')).toBeNull()
  })

  it('相邻两道之间首尾相接，从第一道能一路走到最后一道', () => {
    const walked: string[] = []
    let current = PUZZLES[0]!.id
    for (let guard = 0; guard < 100; guard++) {
      walked.push(current)
      const next = nextPuzzleAfter(PUZZLES, current)
      if (next === null) break
      current = next.id
    }

    expect(walked).toEqual(ALL_IDS)
  })
})

/**
 * 分类进度。
 *
 * 全部**派生**自题库与完成记录，不存第二份状态（任务书 §四 明确要求）。
 * 顺序取「分类在题库里首次出现的顺序」而不是另传一张表：函数的输出完全由输入决定，
 * 换一份题库，顺序跟着它走。
 */
describe('分类进度', () => {
  it('顺序与题库里分类首次出现的顺序一致', () => {
    const order = categoryProgress(PUZZLES, []).map((entry) => entry.category)

    expect(order).toEqual([...CATEGORY_ORDER])
  })

  it('计数只算该分类里已通过的那几道', () => {
    // win-h / win-diag 属于「一步获胜」；block-h 属于「挡住直接胜着」
    const progress = categoryProgress(PUZZLES, ['win-h', 'win-diag', 'block-h'])
    const byCategory = new Map(progress.map((entry) => [entry.category, entry]))

    expect(byCategory.get('winInOne')).toEqual({ category: 'winInOne', done: 2, total: 3 })
    expect(byCategory.get('blockFive')).toEqual({ category: 'blockFive', done: 1, total: 3 })
    expect(byCategory.get('vcf')).toEqual({ category: 'vcf', done: 0, total: 2 })
  })

  it('任何一个分类的 done 都不会超过 total——重复 id 也不例外', () => {
    const progress = categoryProgress(PUZZLES, ['win-h', 'win-h', 'win-h'])

    for (const entry of progress) {
      expect(entry.done).toBeLessThanOrEqual(entry.total)
    }
  })

  it('空题库不炸，返回空表', () => {
    expect(categoryProgress([], ALL_IDS)).toEqual([])
  })

  /**
   * 守卫：**每道题都得落进某一个分类里**，而且分类数就是题型表上那几个。
   *
   * 与 `courseOutline.test.ts` 那条「八节课恰好各出现一次」同一类事故：
   * 新加一道题、分类写了个不在表里的值，它就会从分组列表里**静默消失**——
   * 而所有测试都是绿的（本仓吃过同形的亏：Phase 02 的三颗控件从探针扫描里没了）。
   */
  it('十五道题一个不漏地落进六个分类，题数与题库对得上', () => {
    const progress = categoryProgress(PUZZLES, [])

    expect(progress.map((entry) => entry.category)).toEqual([...CATEGORY_ORDER])
    expect(progress.reduce((sum, entry) => sum + entry.total, 0)).toBe(PUZZLES.length)
    expect(new Set(PUZZLES.map((puzzle) => puzzle.category)).size).toBe(CATEGORY_ORDER.length)
  })
})
