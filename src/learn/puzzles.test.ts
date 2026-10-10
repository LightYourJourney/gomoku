import { describe, expect, it } from 'vitest'
import { CATEGORY_LABELS, CATEGORY_ORDER, PUZZLES } from './puzzles'

const PLACEHOLDER = /TODO|待补|占位|示例文本|lorem|xxx/i

describe('题库结构', () => {
  it('每个分类都有中文名', () => {
    for (const category of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[category], category).toBeTruthy()
    }
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...CATEGORY_ORDER].sort())
  })

  it('每道题的标题、题面、解法都写全了', () => {
    for (const puzzle of PUZZLES) {
      expect(puzzle.title.length, puzzle.id).toBeGreaterThan(1)
      expect(puzzle.prompt.length, puzzle.id).toBeGreaterThan(6)
      expect(puzzle.solution.length, puzzle.id).toBeGreaterThan(6)
    }
  })

  it('题面与解法不是占位符', () => {
    for (const puzzle of PUZZLES) {
      expect(puzzle.prompt, puzzle.id).not.toMatch(PLACEHOLDER)
      expect(puzzle.solution, puzzle.id).not.toMatch(PLACEHOLDER)
    }
  })

  it('每道题至少 2 条渐进提示', () => {
    for (const puzzle of PUZZLES) {
      expect(puzzle.hints.length, puzzle.id).toBeGreaterThanOrEqual(2)
      for (const hint of puzzle.hints) expect(hint.length, puzzle.id).toBeGreaterThan(6)
    }
  })

  it('每道题的分类都在已知分类里', () => {
    for (const puzzle of PUZZLES) {
      expect(CATEGORY_ORDER, puzzle.id).toContain(puzzle.category)
    }
  })

  it('分类不空：每个分类至少 2 道题', () => {
    for (const category of CATEGORY_ORDER) {
      const count = PUZZLES.filter((puzzle) => puzzle.category === category).length

      expect(count, category).toBeGreaterThanOrEqual(2)
    }
  })

  it('同一分类里题目不重名', () => {
    for (const category of CATEGORY_ORDER) {
      const titles = PUZZLES.filter((p) => p.category === category).map((p) => p.title)

      expect(new Set(titles).size, category).toBe(titles.length)
    }
  })
})
