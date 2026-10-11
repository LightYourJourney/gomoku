import { describe, expect, it } from 'vitest'
import { CATEGORY_LABELS, CATEGORY_ORDER, PUZZLES } from './puzzles'

const PLACEHOLDER = /TODO|待补|占位|示例文本|lorem|xxx/i

describe('题库结构', () => {
  it('每个分类都有中文名，且分类顺序与既有声明一致', () => {
    // CATEGORY_ORDER 派生自 CATEGORY_LABELS，「两表同序」已无从谈起。
    // 但这个顺序**本身是界面契约**：残局页按它分组（e2e 断言六个分类的
    // 标题都可见，但不依赖顺序——顺序只由这里的对象字面量决定）。
    // 钉死它，改顺序必须是显式决定，而不是对象字面量的手滑。
    expect(CATEGORY_ORDER).toEqual([
      'winInOne',
      'blockFive',
      'makeOpenFour',
      'doubleThreat',
      'vcf',
      'forcedWin',
    ])
    for (const category of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[category], category).toBeTruthy()
    }
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

  it('没有两道题是「同一块盘面 + 同一个目标」的重复题', () => {
    // 这条断言的来历：forced-deep 曾与 vcf-basic 盘面逐字相同，题面却声称
    // 「比上一题多了一手棋的准备」。当时的结构测试没有一个能抓住它——
    // 手数奇偶抓不到（两个盘面都合法），「不重名」也抓不到。
    // 判重按「盘面 + 落子方 + 目标谓词」整体比：同盘不同目标（一个考双重
    // 威胁、一个考强制取胜）是合法的教学设计，不算重复。
    const seen = new Map<string, string>()

    for (const puzzle of PUZZLES) {
      const key = JSON.stringify([puzzle.board, puzzle.player, puzzle.goal])

      expect(seen.has(key), `${puzzle.id} 与 ${seen.get(key)} 盘面、落子方、目标完全相同`).toBe(
        false,
      )
      seen.set(key, puzzle.id)
    }
  })
})
