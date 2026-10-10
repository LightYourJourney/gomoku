import { describe, expect, it } from 'vitest'
import { BLACK, WHITE } from '../core/types'
import { parseBoardLines } from '../lib/board-lines'
import { solveMove } from './hints'
import { LESSONS } from './lessons'
import { CATEGORY_ORDER, PUZZLES } from './puzzles'
import type { Practice } from './types'
import { boardHasFive, checkPrecondition, judgeMove } from './verify'

/**
 * 跨全部内容的自检。
 *
 * 这是本阶段的**验收装置**：它把「答案经过验证」从一句承诺变成一条会红的测试。
 * 任何一道题无解、任何一道题的开局就已经分出胜负、任何一处手数奇偶对不上，
 * 都会在这里被点名。
 */

const ALL: ReadonlyArray<{ id: string; practice: Practice }> = [
  ...LESSONS.map((lesson) => ({ id: `lesson:${lesson.id}`, practice: lesson.practice })),
  ...PUZZLES.map((puzzle) => ({ id: `puzzle:${puzzle.id}`, practice: puzzle })),
]

/** 求解与判题都用真时钟——算杀要留预算。这些局面都秒解。 */
const NOW = Date.now

describe('内容自检 —— 可解性', () => {
  it('每一个练习/题目都至少有一个正确解', () => {
    const unsolvable = ALL.filter(({ practice }) => {
      const board = parseBoardLines(practice.board.lines)
      return solveMove(board, practice.player, practice.goal, NOW) === null
    }).map(({ id }) => id)

    expect(unsolvable).toEqual([])
  })

  it('解出来的着法必须通过判定器', () => {
    // 求解器与判定器同一把尺子，否则会出现「提示指的那一手被判错」。
    for (const { id, practice } of ALL) {
      const parsed = parseBoardLines(practice.board.lines)
      const move = solveMove(parsed, practice.player, practice.goal, NOW)

      expect(move, id).not.toBeNull()
      expect(judgeMove(parsed, practice.player, move!, practice.goal, NOW), id).toEqual({ ok: true })
    }
  })
})

describe('内容自检 —— 题面合法', () => {
  it('没有哪道题的开局就已经分出胜负', () => {
    for (const { id, practice } of ALL) {
      const parsed = parseBoardLines(practice.board.lines)

      expect(boardHasFive(parsed), id).toBe(false)
    }
  })

  it('每道题的题目本身都成立', () => {
    for (const { id, practice } of ALL) {
      const parsed = parseBoardLines(practice.board.lines)

      expect(checkPrecondition(parsed, practice.player, practice.goal), id).toEqual({ ok: true })
    }
  })

  it('落子方与手数奇偶一致', () => {
    // 黑先，所以黑子数要么等于白子数（轮到黑走），要么比白多一（轮到白走）。
    for (const { id, practice } of ALL) {
      const parsed = parseBoardLines(practice.board.lines)
      let black = 0
      let white = 0

      for (const cell of parsed) {
        if (cell === BLACK) black++
        else if (cell === WHITE) white++
      }

      expect(black - white, id).toBe(practice.player === BLACK ? 0 : 1)
    }
  })

  it('棋盘没有下满', () => {
    for (const { id, practice } of ALL) {
      const parsed = parseBoardLines(practice.board.lines)

      expect([...parsed].some((cell) => cell === 0), id).toBe(true)
    }
  })
})

describe('内容自检 —— 覆盖度', () => {
  it('题库至少 15 道', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(15)
  })

  it('六个分类都有题', () => {
    for (const category of CATEGORY_ORDER) {
      expect(PUZZLES.some((puzzle) => puzzle.category === category), category).toBe(true)
    }
  })

  it('每个目标类型都至少被一道题覆盖', () => {
    const kinds = new Set(ALL.map(({ practice }) => practice.goal.kind))

    expect([...kinds].sort()).toEqual(['blockFive', 'doubleThreat', 'forcedWin', 'makeShape', 'win'])
  })

  it('题目 id 唯一', () => {
    const ids = PUZZLES.map((puzzle) => puzzle.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})
