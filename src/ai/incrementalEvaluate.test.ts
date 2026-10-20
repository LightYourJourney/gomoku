import { describe, expect, it } from 'vitest'
import { createBoard, idx } from '../core/board'
import { findWinLine } from '../core/rules'
import { BLACK, BOARD_SIZE, CELL_COUNT, WHITE, type Board, type Player } from '../core/types'
import { boardFromLines, nearlyFullBoard } from '../test/board-fixtures'
import { evaluateBoard, SHAPE_VALUES, WIN_SCORE } from './evaluate'
import { createIncrementalEvaluator } from './incrementalEvaluate'

/**
 * 增量评估的一致性测试。
 *
 * 这套用例的判据只有一个：**对同一个棋盘，增量实现的读数必须与
 * `evaluateBoard()` 逐位相等**。不是「差不多」、不是「同量级」——
 * 增量评估一旦与全盘评估产生任何偏差，搜索就会在两条不同的尺子上比较局面，
 * 而那种错误在棋谱上完全看不出来。
 *
 * 所以这里的期望值分两类：
 * 1. 手写局面：用 `evaluateBoard` 本身做对照，并显式钉住几个已知棋型分值；
 * 2. 随机差分：大量合法手顺，每落一子、每撤销一步都比一次，双方视角都比。
 */

function place(board: Board, x: number, y: number, player: Player): Board {
  board[idx(x, y)] = player
  return board
}

/** 同时比较黑白两个视角——只比一个视角会漏掉「对手分数没更新」这类错误。 */
function expectMatchesFull(board: Board, evaluator: ReturnType<typeof createIncrementalEvaluator>): void {
  expect(evaluator.score(BLACK), '黑方视角与全盘评估不一致').toBe(evaluateBoard(board, BLACK))
  expect(evaluator.score(WHITE), '白方视角与全盘评估不一致').toBe(evaluateBoard(board, WHITE))
}

/** 可复现的伪随机数（mulberry32）。差分测试必须能在失败时按种子重放。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

interface Move {
  readonly index: number
  readonly player: Player
}

/**
 * 生成一串**合法**落子：黑白交替、只落空点、一旦成五立即停。
 *
 * 停下来的那一刻棋盘上确实有五连——那是真实对局会出现的终局面，
 * 增量评估对它也必须正确。之后的落子才会变成非法手顺，所以不再生成。
 */
function randomGame(seed: number, maxMoves: number): Move[] {
  const random = mulberry32(seed)
  const board = createBoard()
  const moves: Move[] = []
  let player: Player = BLACK

  for (let step = 0; step < maxMoves; step++) {
    const empty: number[] = []
    for (let i = 0; i < CELL_COUNT; i++) if (board[i] === 0) empty.push(i)
    if (empty.length === 0) break

    const index = empty[Math.floor(random() * empty.length)]!
    const x = index % BOARD_SIZE
    const y = Math.floor(index / BOARD_SIZE)
    board[index] = player
    moves.push({ index, player })

    if (findWinLine(board, { x, y }) !== null) break
    player = player === BLACK ? WHITE : BLACK
  }

  return moves
}

function describeMoves(moves: readonly Move[]): string {
  return moves
    .map((m) => `(${m.index % BOARD_SIZE},${Math.floor(m.index / BOARD_SIZE)})${m.player === BLACK ? 'B' : 'W'}`)
    .join(' ')
}

describe('基础局面', () => {
  it('空盘双方都是 0', () => {
    const evaluator = createIncrementalEvaluator(createBoard())
    expect(evaluator.score(BLACK)).toBe(0)
    expect(evaluator.score(WHITE)).toBe(0)
    expect(evaluator.depth).toBe(0)
  })

  it('单子不计分，落子后仍是 0', () => {
    const evaluator = createIncrementalEvaluator(createBoard())
    evaluator.place(idx(7, 7), BLACK)
    expect(evaluator.score(BLACK)).toBe(0)
    expect(evaluator.score(WHITE)).toBe(0)
  })

  it('两子连成二，仍不计分', () => {
    const board = createBoard()
    place(board, 7, 7, BLACK)
    place(board, 8, 7, BLACK)

    const evaluator = createIncrementalEvaluator(createBoard())
    evaluator.place(idx(7, 7), BLACK)
    evaluator.place(idx(8, 7), BLACK)

    expect(evaluator.score(BLACK)).toBe(0)
    expectMatchesFull(board, evaluator)
  })

  it('横向活三与全盘评估一致，且等于已知分值', () => {
    const board = createBoard()
    place(board, 3, 2, BLACK)
    place(board, 4, 2, BLACK)
    place(board, 5, 2, BLACK)

    const evaluator = createIncrementalEvaluator(createBoard())
    for (let x = 3; x <= 5; x++) evaluator.place(idx(x, 2), BLACK)

    expect(evaluator.score(BLACK)).toBe(SHAPE_VALUES.openThree)
    expectMatchesFull(board, evaluator)
  })

  it('纵向棋型与横向同分', () => {
    const board = createBoard()
    for (let y = 3; y <= 5; y++) place(board, 6, y, WHITE)

    const evaluator = createIncrementalEvaluator(createBoard())
    for (let y = 3; y <= 5; y++) evaluator.place(idx(6, y), WHITE)

    expectMatchesFull(board, evaluator)
    expect(evaluator.score(WHITE)).toBe(SHAPE_VALUES.openThree)
  })

  it('两条斜向都能被正确增量更新', () => {
    const board = createBoard()
    place(board, 3, 3, BLACK)
    place(board, 4, 4, BLACK)
    place(board, 5, 5, BLACK)

    place(board, 10, 4, WHITE)
    place(board, 9, 5, WHITE)
    place(board, 8, 6, WHITE)

    const evaluator = createIncrementalEvaluator(createBoard())
    for (const [x, y] of [
      [3, 3],
      [4, 4],
      [5, 5],
      [10, 4],
      [9, 5],
      [8, 6],
    ] as const) {
      evaluator.place(idx(x, y), board[idx(x, y)] as Player)
    }

    expectMatchesFull(board, evaluator)
  })

  it('贴着边界的棋型也被正确计算（边不是空位）', () => {
    const board = createBoard()
    place(board, 0, 0, BLACK)
    place(board, 0, 1, BLACK)
    place(board, 0, 2, BLACK)

    const evaluator = createIncrementalEvaluator(createBoard())
    for (let y = 0; y <= 2; y++) evaluator.place(idx(0, y), BLACK)

    expectMatchesFull(board, evaluator)
  })
})

describe('棋型边界', () => {
  it('眠三、冲四、活四都与全盘评估一致', () => {
    const cases: ReadonlyArray<readonly string[]> = [
      ['...............', '...............', '..WBBB.........'],
      ['...............', '...............', '..WBBBB........'],
      ['...............', '...............', '...BBBB........'],
      ['...............', '...............', '...BB.BB.......'],
      ['...............', '...............', '..BB.BBW.......'],
    ]

    for (const lines of cases) {
      const board = boardFromLines(lines)
      const evaluator = createIncrementalEvaluator(createBoard())
      for (let i = 0; i < CELL_COUNT; i++) {
        const cell = board[i]
        if (cell !== 0) evaluator.place(i, cell as Player)
      }
      expectMatchesFull(board, evaluator)
    }
  })

  it('多个成五点（活四）计一次，增量与全盘一致', () => {
    const board = boardFromLines(['...............', '...............', '...BBBB........'])
    const evaluator = createIncrementalEvaluator(createBoard())
    for (let x = 3; x <= 6; x++) evaluator.place(idx(x, 2), BLACK)

    expect(evaluator.score(BLACK)).toBe(SHAPE_VALUES.openFour)
    expectMatchesFull(board, evaluator)
  })

  it('成五返回 WIN_SCORE', () => {
    const board = boardFromLines(['...............', '...............', '...BBBBB.......'])
    const evaluator = createIncrementalEvaluator(createBoard())
    for (let x = 3; x <= 7; x++) evaluator.place(idx(x, 2), BLACK)

    expect(evaluator.score(BLACK)).toBeGreaterThanOrEqual(WIN_SCORE)
    expectMatchesFull(board, evaluator)
  })

  it('长连（六子）同样算成五', () => {
    const board = boardFromLines(['...............', '...............', '...BBBBBB......'])
    const evaluator = createIncrementalEvaluator(createBoard())
    for (let x = 3; x <= 8; x++) evaluator.place(idx(x, 2), BLACK)

    expect(evaluator.score(BLACK)).toBeGreaterThanOrEqual(WIN_SCORE)
    expectMatchesFull(board, evaluator)
  })

  it('双方棋型互相阻断时，黑白分数分别正确', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...BBBWWW......',
      '...............',
      '...............',
      '......BBBB.....',
    ])
    const evaluator = createIncrementalEvaluator(createBoard())
    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = board[i]
      if (cell !== 0) evaluator.place(i, cell as Player)
    }

    expectMatchesFull(board, evaluator)
    // 黑有活四，白那边的 WWW 被黑 BBB 堵住一头，权重不同——不能假设对称
    expect(evaluator.score(BLACK)).toBeGreaterThan(0)
  })

  it('落子同时改变攻防两侧的分数', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...BBB.........',
      '...WWW.........',
    ])
    const evaluator = createIncrementalEvaluator(board)

    const before = { black: evaluator.score(BLACK), white: evaluator.score(WHITE) }
    // (2,2) 既是黑活三的延伸点，也贴着白的活三
    evaluator.place(idx(2, 2), BLACK)
    board[idx(2, 2)] = BLACK

    expect(evaluator.score(BLACK)).not.toBe(before.black)
    expect(evaluator.score(WHITE)).not.toBe(before.white)
    expectMatchesFull(board, evaluator)
  })
})

describe('状态与撤销', () => {
  it('连续落子后逐步撤销，每一步都回到当时的分值', () => {
    const board = createBoard()
    const evaluator = createIncrementalEvaluator(board)
    const checkpoints: { black: number; white: number }[] = []

    const moves: Move[] = [
      { index: idx(7, 7), player: BLACK },
      { index: idx(8, 8), player: WHITE },
      { index: idx(6, 7), player: BLACK },
      { index: idx(6, 6), player: WHITE },
      { index: idx(5, 7), player: BLACK },
    ]

    for (const move of moves) {
      checkpoints.push({ black: evaluator.score(BLACK), white: evaluator.score(WHITE) })
      evaluator.place(move.index, move.player)
      board[move.index] = move.player
      expectMatchesFull(board, evaluator)
    }

    while (checkpoints.length > 0) {
      evaluator.undo()
      board[moves[checkpoints.length - 1]!.index] = 0
      const expected = checkpoints.pop()!
      expect(evaluator.score(BLACK)).toBe(expected.black)
      expect(evaluator.score(WHITE)).toBe(expected.white)
      expectMatchesFull(board, evaluator)
    }

    expect(evaluator.depth).toBe(0)
    expect(evaluator.score(BLACK)).toBe(0)
  })

  it('同一位置在不同分支上落不同颜色，互不污染', () => {
    const board = createBoard()
    place(board, 6, 6, BLACK)
    place(board, 7, 7, BLACK)
    place(board, 8, 8, BLACK)

    const evaluator = createIncrementalEvaluator(board)

    evaluator.place(idx(9, 9), BLACK)
    board[idx(9, 9)] = BLACK
    expectMatchesFull(board, evaluator)
    evaluator.undo()

    evaluator.place(idx(9, 9), WHITE)
    board[idx(9, 9)] = WHITE
    expectMatchesFull(board, evaluator)
    evaluator.undo()
    board[idx(9, 9)] = 0

    expectMatchesFull(board, evaluator)
  })

  it('多层嵌套撤销后分值没有漂移', () => {
    const board = createBoard()
    const evaluator = createIncrementalEvaluator(board)

    for (let round = 0; round < 20; round++) {
      const applied: number[] = []
      for (let i = 0; i < 5; i++) {
        const index = idx((round * 3 + i) % BOARD_SIZE, Math.floor((round * 7 + i) / BOARD_SIZE))
        if (board[index] !== 0) continue
        evaluator.place(index, i % 2 === 0 ? BLACK : WHITE)
        board[index] = i % 2 === 0 ? BLACK : WHITE
        applied.push(index)
        expectMatchesFull(board, evaluator)
      }
      for (let i = applied.length - 1; i >= 0; i--) {
        evaluator.undo()
        board[applied[i]!] = 0
        expectMatchesFull(board, evaluator)
      }
    }

    expect(evaluator.depth).toBe(0)
    expect(evaluator.score(BLACK)).toBe(0)
    expect(evaluator.score(WHITE)).toBe(0)
  })

  it('不修改传入的棋盘', () => {
    const board = boardFromLines(['...............', '...............', '...BBB.........'])
    const frozen = Array.from(board)

    const evaluator = createIncrementalEvaluator(board)
    evaluator.place(idx(6, 2), BLACK)
    evaluator.undo()

    expect(Array.from(board)).toEqual(frozen)
  })

  it('撤销到空盘与直接读空盘一致', () => {
    const evaluator = createIncrementalEvaluator(createBoard())
    evaluator.place(idx(7, 7), BLACK)
    evaluator.place(idx(7, 8), WHITE)
    evaluator.undo()
    evaluator.undo()

    const fresh = createIncrementalEvaluator(createBoard())
    expect(evaluator.score(BLACK)).toBe(fresh.score(BLACK))
    expect(evaluator.score(WHITE)).toBe(fresh.score(WHITE))
  })

  it('在已占用的点落子会报错，而不是悄悄覆盖', () => {
    const evaluator = createIncrementalEvaluator(createBoard())
    evaluator.place(idx(7, 7), BLACK)
    expect(() => evaluator.place(idx(7, 7), WHITE)).toThrow()
  })

  it('没有落子就撤销会报错', () => {
    const evaluator = createIncrementalEvaluator(createBoard())
    expect(() => evaluator.undo()).toThrow()
  })
})

describe('随机差分', () => {
  const SEQUENCES = 20
  const MAX_MOVES = 30

  it('逐手落子后双方视角都与全盘评估一致', () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      const moves = randomGame(seed, MAX_MOVES)
      const board = createBoard()
      const evaluator = createIncrementalEvaluator(createBoard())

      for (const move of moves) {
        evaluator.place(move.index, move.player)
        board[move.index] = move.player

        const black = evaluateBoard(board, BLACK)
        const white = evaluateBoard(board, WHITE)
        if (evaluator.score(BLACK) !== black || evaluator.score(WHITE) !== white) {
          throw new Error(
            `种子 ${seed} 在第 ${moves.indexOf(move) + 1} 手不一致\n` +
              `手顺：${describeMoves(moves.slice(0, moves.indexOf(move) + 1))}\n` +
              `黑：增量 ${evaluator.score(BLACK)} / 全盘 ${black}\n` +
              `白：增量 ${evaluator.score(WHITE)} / 全盘 ${white}`,
          )
        }
      }
    }
  })

  it('随机穿插撤销后仍与全盘评估一致', () => {
    for (let seed = 101; seed <= 110; seed++) {
      const random = mulberry32(seed)
      const board = createBoard()
      const evaluator = createIncrementalEvaluator(createBoard())
      const history: Move[] = []

      for (let step = 0; step < 120; step++) {
        const shouldUndo = history.length > 0 && random() < 0.4

        if (shouldUndo) {
          const last = history.pop()!
          evaluator.undo()
          board[last.index] = 0
        } else {
          const empty: number[] = []
          for (let i = 0; i < CELL_COUNT; i++) if (board[i] === 0) empty.push(i)
          if (empty.length === 0) break
          const index = empty[Math.floor(random() * empty.length)]!
          const player: Player = history.length % 2 === 0 ? BLACK : WHITE
          evaluator.place(index, player)
          board[index] = player
          history.push({ index, player })
        }

        const black = evaluateBoard(board, BLACK)
        const white = evaluateBoard(board, WHITE)
        if (evaluator.score(BLACK) !== black || evaluator.score(WHITE) !== white) {
          throw new Error(
            `种子 ${seed} 在第 ${step + 1} 步不一致\n` +
              `剩余手顺：${describeMoves(history)}\n` +
              `黑：增量 ${evaluator.score(BLACK)} / 全盘 ${black}\n` +
              `白：增量 ${evaluator.score(WHITE)} / 全盘 ${white}`,
          )
        }
      }
    }
  })

  it('接近满盘的棋盘同样一致', () => {
    const board = nearlyFullBoard()
    const evaluator = createIncrementalEvaluator(createBoard())
    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = board[i]
      if (cell !== 0) evaluator.place(i, cell as Player)
    }
    expectMatchesFull(board, evaluator)
  })

  it('对局结束后仍可表示的棋盘也一致（含五连）', () => {
    // 30 手的随机局面几乎不会出现五连，这里放到 80 手找终局面
    let checked = 0
    for (let seed = 1; seed <= 60 && checked < 5; seed++) {
      const moves = randomGame(seed, 80)
      const board = createBoard()
      const evaluator = createIncrementalEvaluator(createBoard())
      for (const move of moves) {
        board[move.index] = move.player
        evaluator.place(move.index, move.player)
      }
      const last = moves[moves.length - 1]
      const hasFive =
        last !== undefined &&
        findWinLine(board, { x: last.index % BOARD_SIZE, y: Math.floor(last.index / BOARD_SIZE) }) !== null
      if (!hasFive) continue
      checked++
      expectMatchesFull(board, evaluator)
    }
    expect(checked, '随机序列里没有出现任何成五终局，这条用例实际上没测到东西').toBeGreaterThan(0)
  })
})
