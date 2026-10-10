import { describe, expect, it } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK } from '../core/types'
import { boardFromLines } from '../test/board-fixtures'
import type { PuzzleGoal } from './types'
import { applyToBoard, boardHasFive, checkPrecondition, judgeMove } from './verify'

/** 判题用的是真时钟（算杀要留预算），但测试里的局面都秒解。 */
const NOW = Date.now

/** 黑棋四连，两端都能成五。 */
const BLACK_FOUR = boardFromLines([
  '...............',
  '...............',
  '...............',
  '...BBBB........',
])

/** 白棋四连，黑棋必须先堵。 */
const WHITE_FOUR = boardFromLines([
  '...............',
  '...............',
  '...............',
  '..BWWWW........',
])

/** 黑棋活三：补上任何一端都成两端开口的四。 */
const OPEN_THREE = boardFromLines([
  '...............',
  '...............',
  '...............',
  '...BBB.........',
])

describe('judgeMove —— 一手取胜', () => {
  const goal: PuzzleGoal = { kind: 'win' }

  it('补成五连判对', () => {
    expect(judgeMove(BLACK_FOUR, BLACK, { x: 2, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })

  it('两端都能成五时，两边都判对', () => {
    // 这条钉住「多解」：判定是局面谓词，不是坐标表。
    expect(judgeMove(BLACK_FOUR, BLACK, { x: 2, y: 3 }, goal, NOW)).toEqual({ ok: true })
    expect(judgeMove(BLACK_FOUR, BLACK, { x: 7, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })

  it('没有连成五判错', () => {
    const verdict = judgeMove(OPEN_THREE, BLACK, { x: 3, y: 5 }, goal, NOW)

    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/五/)
  })

  it('落在已占用的点上报非法，而不是静默判错', () => {
    const verdict = judgeMove(BLACK_FOUR, BLACK, { x: 4, y: 3 }, goal, NOW)

    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/不能落子/)
  })

  it('落在棋盘外也报非法', () => {
    expect(judgeMove(createBoard(), BLACK, { x: 15, y: 0 }, goal, NOW).ok).toBe(false)
  })
})

describe('judgeMove —— 挡住对手的成五点', () => {
  const goal: PuzzleGoal = { kind: 'blockFive' }

  it('堵住唯一的成五点判对', () => {
    expect(judgeMove(WHITE_FOUR, BLACK, { x: 7, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })

  it('没堵住时，理由里点名对手的成五点', () => {
    const verdict = judgeMove(WHITE_FOUR, BLACK, { x: 10, y: 10 }, goal, NOW)

    expect(verdict.ok).toBe(false)
    // 只说「不对」等于没教——理由必须说清对手下一手会走到哪里。
    expect(verdict.ok === false && verdict.reason).toMatch(/H12/)
  })

  it('自己这一手就能赢时，不堵也算对', () => {
    const both = boardFromLines([
      '...............',
      '...............',
      '...BBBB........',
      '...............',
      '...WWWW........',
    ])

    // 黑棋补成五，白棋那边也有四连——先赢的说了算。
    expect(judgeMove(both, BLACK, { x: 2, y: 2 }, goal, NOW)).toEqual({ ok: true })
  })
})

describe('judgeMove —— 做出指定棋型', () => {
  it('做出活四判对', () => {
    const goal: PuzzleGoal = { kind: 'makeShape', shape: 'openFour' }

    expect(judgeMove(OPEN_THREE, BLACK, { x: 2, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })

  it('只做出冲四时判错，理由里写清做出的是冲四', () => {
    // 白棋堵住活三的一端，补另一端就只能做出冲四。
    // (2,3) 被白子堵住，补 (6,3) 只能做出右端一个成五点的冲四。
    const blocked = boardFromLines([
      '...............',
      '...............',
      '...............',
      '..WBBB.........',
    ])
    const goal: PuzzleGoal = { kind: 'makeShape', shape: 'openFour' }

    const verdict = judgeMove(blocked, BLACK, { x: 6, y: 3 }, goal, NOW)

    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/冲四/)
    expect(verdict.ok === false && verdict.reason).toMatch(/活四/)
  })

  it('目标是活三时，做出活四也算对（已经更强）', () => {
    const goal: PuzzleGoal = { kind: 'makeShape', shape: 'openThree' }

    expect(judgeMove(OPEN_THREE, BLACK, { x: 2, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })

  it('目标是活三时，只做出眠三判错', () => {
    // (1,3) 被白子堵住，补 (2,3) 做出的是左端封死的眠三。
    const blocked = boardFromLines([
      '...............',
      '...............',
      '...............',
      '.W.BB..........',
    ])
    const goal: PuzzleGoal = { kind: 'makeShape', shape: 'openThree' }

    const verdict = judgeMove(blocked, BLACK, { x: 2, y: 3 }, goal, NOW)

    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/眠三/)
  })

  it('目标是活二时，做出活二判对', () => {
    const board = boardFromLines(['...............', '...............', '...............', '...B...........'])
    const goal: PuzzleGoal = { kind: 'makeShape', shape: 'openTwo' }

    expect(judgeMove(board, BLACK, { x: 4, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })
})

describe('judgeMove —— 双重威胁', () => {
  const goal: PuzzleGoal = { kind: 'doubleThreat' }
  const AT = { x: 7, y: 7 }

  it('双四判对', () => {
    // (7,2) 的白子是**故意**放的：没有它，黑棋在 (7,3) 补一手就直接成活四，
    // 那也是一种过关方式，但会让「双四」这道题多出一个不是双四的解。
    const board = boardFromLines([
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

    expect(judgeMove(board, BLACK, AT, goal, NOW)).toEqual({ ok: true })
  })

  it('四三判对', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
      '.......B.......',
      '...............',
      '....BBB.W......',
    ])

    expect(judgeMove(board, BLACK, AT, goal, NOW)).toEqual({ ok: true })
  })

  it('双活三判对', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
      '.......B.......',
      '...............',
      '....BB.........',
    ])

    expect(judgeMove(board, BLACK, AT, goal, NOW)).toEqual({ ok: true })
  })

  it('只有一个冲四判错', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '....BBB.W......',
    ])

    expect(judgeMove(board, BLACK, AT, goal, NOW).ok).toBe(false)
  })

  it('做出一个活四不算双重威胁，但已经必胜，判对', () => {
    // 「构造活四」和「构造双四」是两类题；活四只在一个方向上，
    // 不该混进双重威胁。但它确实是胜势，为它判错只会让学习者困惑。
    expect(judgeMove(OPEN_THREE, BLACK, { x: 2, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })
})

describe('judgeMove —— 强制取胜', () => {
  const goal: PuzzleGoal = { kind: 'forcedWin', maxPlies: 5 }

  /** 黑棋活三补一端成活四，三步取胜——这是最短的一条强制取胜路线。 */
  const LIVE_THREE = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '...BBB.........',
  ])

  /** 黑棋 (4,7)(5,7)(6,7)，白棋堵住了右端：补左端是活四，补右端只是冲四。 */
  const BLOCKED_ONE_END = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '....BBB.W......',
  ])

  it('走出算杀证明得了的那一手判对', () => {
    expect(judgeMove(LIVE_THREE, BLACK, { x: 2, y: 4 }, goal, NOW)).toEqual({ ok: true })
  })

  it('走出一个冲四、对手堵掉就没事了，判错', () => {
    // 这条是本模块最重要的一条断言。曾经的做法是把**走子后**的盘面交给
    // `findForcedWin` 判，而那个函数假定「传进来的盘面轮到攻方走」——玩家落子
    // 之后轮到的是对手，于是判定白送攻方一手，把输棋判成赢棋。实测：黑走 (7,7)
    // 只做成一个冲四，白在 (3,7) 堵掉之后黑棋 9 手内都没有杀，旧写法却返回
    // plies:1。
    const verdict = judgeMove(BLOCKED_ONE_END, BLACK, { x: 7, y: 7 }, goal, NOW)

    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/防住|强制/)
  })

  it('一步成五也满足强制取胜', () => {
    expect(judgeMove(BLACK_FOUR, BLACK, { x: 2, y: 3 }, goal, NOW)).toEqual({ ok: true })
  })
})

describe('checkPrecondition —— 题目本身成不成立', () => {
  it('「挡住成五点」的题，局面里必须真的有成五点', () => {
    expect(checkPrecondition(WHITE_FOUR, BLACK, { kind: 'blockFive' })).toEqual({ ok: true })

    const noThreat = checkPrecondition(createBoard(), BLACK, { kind: 'blockFive' })
    expect(noThreat.ok).toBe(false)
    expect(noThreat.ok === false && noThreat.reason).toMatch(/没有成五点/)
  })

  it('强制取胜的题，maxPlies 至少是 3', () => {
    // 一手取胜该用 win 表达；hardcode 成 forcedWin 会让判定走空。
    expect(checkPrecondition(createBoard(), BLACK, { kind: 'forcedWin', maxPlies: 1 }).ok).toBe(false)
    expect(checkPrecondition(createBoard(), BLACK, { kind: 'forcedWin', maxPlies: 3 }).ok).toBe(true)
  })

  it('其余目标在任何局面下都成立', () => {
    expect(checkPrecondition(createBoard(), BLACK, { kind: 'win' })).toEqual({ ok: true })
    expect(checkPrecondition(createBoard(), BLACK, { kind: 'doubleThreat' })).toEqual({ ok: true })
  })
})

describe('applyToBoard / boardHasFive', () => {
  it('applyToBoard 不改传入的棋盘', () => {
    const before = Uint8Array.from(BLACK_FOUR)

    applyToBoard(BLACK_FOUR, { x: 2, y: 3 }, BLACK)

    expect(BLACK_FOUR).toEqual(before)
  })

  it('boardHasFive 能发现盘上已经存在的五连', () => {
    expect(boardHasFive(createBoard())).toBe(false)
    expect(boardHasFive(boardFromLines(['...BBBBB.......']))).toBe(true)
    expect(boardHasFive(boardFromLines(['...WWWWW.......']))).toBe(true)
  })

  it('boardHasFive 查的是全盘，不只看最后一手周围', () => {
    const board = boardFromLines([
      '...BBBBB.......',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '......W........',
    ])

    expect(boardHasFive(board)).toBe(true)
  })
})
