import { describe, expect, it } from 'vitest'
import { analyzePoint, hasDoubleThreat } from '../ai/patterns'
import { pointFromIdx } from '../core/board'
import { findWinLine } from '../core/rules'
import { BLACK, WHITE, type Point } from '../core/types'
import { parseBoardLines } from '../lib/board-lines'
import { formatPoint } from '../lib/coords'
import { solveMove } from './hints'
import { LESSONS } from './lessons'
import { CATEGORY_ORDER, PUZZLES } from './puzzles'
import type { Practice } from './types'
import { applyToBoard, boardHasFive, checkPrecondition, judgeMove } from './verify'

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

/** 判定器在这个局面上判对的**全部**空点（逐点枚举，不走求解器）。 */
function acceptedPoints(practice: Practice): Point[] {
  const parsed = parseBoardLines(practice.board.lines)
  const accepted: Point[] = []
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i] !== 0) continue
    const point = pointFromIdx(i)
    if (judgeMove(parsed, practice.player, point, practice.goal, NOW).ok) accepted.push(point)
  }
  return accepted
}

/**
 * 双重威胁题判对的点必须**真的是双重威胁**。
 *
 * `judgeMove` 的 doubleThreat 分支对单线活四也判对（活四本身就是胜势）。
 * 题面若留了「在某一条线上补出活四」的口子，学习者在那里落子会被判对，
 * 而解法说明讲的却是「交叉点上一手两个威胁」——判对与说明各说各话。
 * 所以每个判对点都要么直接成五，要么 `hasDoubleThreat` 成立。
 * 这里只断言性质，不写任何题目的答案坐标。
 */
describe('内容自检 —— 双重威胁题没有单线活四的旁解', () => {
  const doubles = ALL.filter(({ practice }) => practice.goal.kind === 'doubleThreat')

  it('至少有一道双重威胁题（防止过滤条件失效后整组空转）', () => {
    expect(doubles.length).toBeGreaterThan(0)
  })

  it.each(doubles)('$id：每个判对点都是真正的双重威胁', ({ practice }) => {
    const parsed = parseBoardLines(practice.board.lines)
    const accepted = acceptedPoints(practice)
    expect(accepted.length).toBeGreaterThan(0)

    const stray = accepted.filter((point) => {
      const after = applyToBoard(parsed, point, practice.player)
      if (findWinLine(after, point) !== null) return false
      return !hasDoubleThreat(analyzePoint(after, point, practice.player))
    })
    expect(stray.map(formatPoint)).toEqual([])
  })
})

/**
 * 「双四」两道题的解法说明写的是「交叉点」，那判对的就只能是交叉点。
 *
 * 这两道题的横线原先是 `....BBB.W`：BBB 左侧两格都空，补在左端就是活四，
 * 被 doubleThreat 分支的 `openFour > 0` 判对——与说明不符。
 * 交叉点 (7,7) 是横线 x=4..6 与竖线 y=4..6 共用的那一格，取自题面本身。
 */
describe('内容自检 —— 双四题只有交叉点一个解', () => {
  const INTERSECTION = { x: 7, y: 7 }
  const targets = ALL.filter(({ id }) => id === 'lesson:double' || id === 'puzzle:double-four')

  it('两道题都在', () => {
    expect(targets.map(({ id }) => id).sort()).toEqual(['lesson:double', 'puzzle:double-four'])
  })

  it.each(targets)('$id：判对的点恰好是交叉点', ({ practice }) => {
    expect(acceptedPoints(practice)).toEqual([INTERSECTION])
  })
})

/**
 * 每节课至少有一页讲解。
 *
 * 独立验收时指出来的：`LessonView` 用的是 `steps[step]!`，而 `lastStep = steps.length - 1`——
 * **0 步的课**会让「回到讲解」把 `undefined` 交给 `StepView`。今天八节课都不是 0 步，
 * 所以只是理论可达；但内容是可增删的，加一条守卫把它变成**响亮的失败**，
 * 比留一个「以后可能会崩」的角落便宜。
 */
describe('课程内容的形状', () => {
  it('每节课都至少有一页讲解', () => {
    for (const lesson of LESSONS) {
      expect(lesson.steps.length, `${lesson.id} 一页讲解都没有`).toBeGreaterThanOrEqual(1)
    }
  })
})
