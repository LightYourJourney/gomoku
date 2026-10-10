import { describe, expect, it } from 'vitest'
import { findForcedWin } from '../ai/threat'
import { createBoard } from '../core/board'
import { BLACK } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import { goalHint, solveMove } from './hints'
import type { PuzzleGoal, ShapeKind } from './types'
import { judgeMove } from './verify'

/** 求解里算杀要留预算，测试里的局面都秒解。 */
const NOW = Date.now

const BLACK_FOUR = boardFromLines([
  '...............',
  '...............',
  '...............',
  '...BBBB........',
])

const WHITE_FOUR = boardFromLines([
  '...............',
  '...............',
  '...............',
  '..BWWWW........',
])

const OPEN_THREE = boardFromLines([
  '...............',
  '...............',
  '...............',
  '...............',
  '...BBB.........',
])

const DOUBLE_FOUR = boardFromLines([
  '...............',
  '...............',
  '.......W.......',
  '...............',
  '.......B.......',
  '.......B.......',
  '.......B.......',
  '....BBB.W......',
  '.......W.......',
])

const ALL_GOALS: readonly PuzzleGoal[] = [
  { kind: 'win' },
  { kind: 'blockFive' },
  { kind: 'makeShape', shape: 'openTwo' },
  { kind: 'makeShape', shape: 'openThree' },
  { kind: 'makeShape', shape: 'openFour' },
  { kind: 'doubleThreat' },
  { kind: 'forcedWin', maxPlies: 5 },
]

describe('solveMove', () => {
  it('能解出「一手取胜」的题', () => {
    const move = solveMove(BLACK_FOUR, BLACK, { kind: 'win' }, NOW)

    expect([{ x: 2, y: 3 }, { x: 7, y: 3 }]).toContainEqual(move)
  })

  it('能解出「挡住成五点」的题', () => {
    expect(solveMove(WHITE_FOUR, BLACK, { kind: 'blockFive' }, NOW)).toEqual({ x: 7, y: 3 })
  })

  it('能解出「构造活四」的题', () => {
    const move = solveMove(OPEN_THREE, BLACK, { kind: 'makeShape', shape: 'openFour' }, NOW)

    expect([{ x: 2, y: 4 }, { x: 6, y: 4 }]).toContainEqual(move)
  })

  it('能解出「双重威胁」的题', () => {
    expect(solveMove(DOUBLE_FOUR, BLACK, { kind: 'doubleThreat' }, NOW)).toEqual({ x: 7, y: 7 })
  })

  it('无解的局面返回 null', () => {
    expect(solveMove(createBoard(), BLACK, { kind: 'win' }, NOW)).toBeNull()
    expect(solveMove(createBoard(), BLACK, { kind: 'blockFive' }, NOW)).toBeNull()
  })

  it('解出来的着法一定通过判定器', () => {
    // 「答案经过验证」的最小保证：求解器与判定器不能各说各话，
    // 否则会出现「提示指的那一手被判错」。
    const cases: ReadonlyArray<readonly [typeof BLACK_FOUR, PuzzleGoal]> = [
      [BLACK_FOUR, { kind: 'win' }],
      [WHITE_FOUR, { kind: 'blockFive' }],
      [OPEN_THREE, { kind: 'makeShape', shape: 'openFour' }],
      [DOUBLE_FOUR, { kind: 'doubleThreat' }],
      [OPEN_THREE, { kind: 'forcedWin', maxPlies: 5 }],
    ]

    for (const [board, goal] of cases) {
      const move = solveMove(board, BLACK, goal, NOW)

      expect(move, goal.kind).not.toBeNull()
      expect(judgeMove(board, BLACK, move!, goal, NOW), goal.kind).toEqual({ ok: true })
    }
  })

  it('强制取胜的题直接用算杀的首着，而不是逐个候选去试', () => {
    // 逐个候选去试的话，每个候选都要跑一遍算杀，一道题能卡上好几秒。
    // 这里不拿耗时做断言——真实时钟会随机器快慢 flaky，而注入时钟正是为了
    // 避免这一点。改成正面比对：算杀给出的首着必须就是求解结果。
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '..BBBB.........',
      '..W............',
      '..W............',
    ])

    const first = findForcedWin(board, BLACK, {
      maxPlies: 5,
      allowThrees: false,
      deadline: Number.POSITIVE_INFINITY,
      now: () => 0,
    }).move

    expect(first).not.toBeNull()
    expect(solveMove(board, BLACK, { kind: 'forcedWin', maxPlies: 5 }, NOW)).toEqual(first)
  })

  it('不改传入的棋盘', () => {
    const before = Uint8Array.from(BLACK_FOUR)

    solveMove(BLACK_FOUR, BLACK, { kind: 'win' }, NOW)

    expect(BLACK_FOUR).toEqual(before)
  })
})

describe('goalHint', () => {
  it('每种目标都有一句中文说明', () => {
    for (const goal of ALL_GOALS) {
      const hint = goalHint(goal)

      expect(hint, goal.kind).not.toBe('')
      expect(hint.length).toBeGreaterThan(8)
    }
  })

  it('做出棋型的目标，说明里点名是哪种棋型', () => {
    const shapes: readonly ShapeKind[] = ['openTwo', 'openThree', 'openFour']
    const hints = shapes.map((shape) => goalHint({ kind: 'makeShape', shape }))

    expect(hints[0]).not.toBe(hints[1])
    expect(hints[1]).not.toBe(hints[2])
    expect(hints[2]).toContain('活四')
  })

  it('揭示的是目标，不是坐标', () => {
    // 第二级提示把目标说清楚就够了，具体点位是第三级的事。
    // 文案里出现 A1..O15 这类棋谱记号就说明越级了。
    for (const goal of ALL_GOALS) {
      expect(goalHint(goal), goal.kind).not.toMatch(/[A-O](1[0-5]|[1-9])\b/)
    }
  })

  it('强制取胜的说明里带上手数', () => {
    expect(goalHint({ kind: 'forcedWin', maxPlies: 5 })).toContain('5')
  })
})
