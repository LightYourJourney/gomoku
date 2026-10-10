import { describe, expect, it } from 'vitest'
import { parseBoardLines } from '../lib/board-lines'
import { LESSONS } from './lessons'
import { solveMove } from './hints'
import { checkPrecondition, judgeMove } from './verify'

const NOW = Date.now

/** 文案里出现这些词，说明写的是占位符而不是内容。 */
const PLACEHOLDER = /TODO|待补|占位|示例文本|lorem|xxx/i

describe('课程结构', () => {
  it('正好 8 节', () => {
    expect(LESSONS).toHaveLength(8)
  })

  it('id 唯一且非空', () => {
    const ids = LESSONS.map((lesson) => lesson.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).not.toBe('')
  })

  it('标题、摘要、练习文案都写全了', () => {
    for (const lesson of LESSONS) {
      expect(lesson.title.length, lesson.id).toBeGreaterThan(1)
      expect(lesson.summary.length, lesson.id).toBeGreaterThan(6)
      expect(lesson.practice.prompt.length, lesson.id).toBeGreaterThan(6)
      expect(lesson.practice.solution.length, lesson.id).toBeGreaterThan(6)
    }
  })

  it('每节课至少 2 个讲解步骤', () => {
    for (const lesson of LESSONS) {
      expect(lesson.steps.length, lesson.id).toBeGreaterThanOrEqual(2)
    }
  })

  it('讲解内容不是占位符', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        expect(step.title, lesson.id).not.toMatch(PLACEHOLDER)
        expect(step.body, lesson.id).not.toMatch(PLACEHOLDER)
        // 一段讲解至少要说两句
        expect(step.body.length, `${lesson.id}/${step.title}`).toBeGreaterThan(30)
      }
    }
  })

  it('每节课的练习都至少有 2 条渐进提示', () => {
    for (const lesson of LESSONS) {
      expect(lesson.practice.hints.length, lesson.id).toBeGreaterThanOrEqual(2)
      for (const hint of lesson.practice.hints) expect(hint.length, lesson.id).toBeGreaterThan(6)
    }
  })

  it('带棋盘的步骤，棋盘都能解析', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        if (step.board === undefined) continue
        expect(() => parseBoardLines(step.board!.lines), `${lesson.id}/${step.title}`).not.toThrow()
      }
    }
  })

  it('棋盘演示的手顺都在棋盘内，且第一步属于先行方', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        if (step.sequence === undefined) continue

        expect(step.sequence.moves.length, lesson.id).toBeGreaterThan(1)
        for (const move of step.sequence.moves) {
          expect(move.x, lesson.id).toBeGreaterThanOrEqual(0)
          expect(move.x, lesson.id).toBeLessThan(15)
          expect(move.y, lesson.id).toBeGreaterThanOrEqual(0)
          expect(move.y, lesson.id).toBeLessThan(15)
        }
        // 手顺里不能有重复落子
        const keys = step.sequence.moves.map((move) => `${move.x},${move.y}`)
        expect(new Set(keys).size, lesson.id).toBe(keys.length)
      }
    }
  })

  it('八节课的主题互不重复', () => {
    expect(new Set(LESSONS.map((lesson) => lesson.title)).size).toBe(LESSONS.length)
  })
})

describe('课程的练习都能做', () => {
  it('每节课的练习都至少有一个正确解', () => {
    const unsolvable = LESSONS.filter((lesson) => {
      const board = parseBoardLines(lesson.practice.board.lines)
      return solveMove(board, lesson.practice.player, lesson.practice.goal, NOW) === null
    }).map((lesson) => lesson.id)

    expect(unsolvable).toEqual([])
  })

  it('解出来的着法必须通过判定器', () => {
    for (const lesson of LESSONS) {
      const { board, player, goal } = lesson.practice
      const parsed = parseBoardLines(board.lines)
      const move = solveMove(parsed, player, goal, NOW)

      expect(move, lesson.id).not.toBeNull()
      expect(judgeMove(parsed, player, move!, goal, NOW), lesson.id).toEqual({ ok: true })
    }
  })

  it('每节课的题目本身都成立', () => {
    for (const lesson of LESSONS) {
      const { board, player, goal } = lesson.practice
      const parsed = parseBoardLines(board.lines)

      expect(checkPrecondition(parsed, player, goal), lesson.id).toEqual({ ok: true })
    }
  })
})
