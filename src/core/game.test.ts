import { describe, expect, it } from 'vitest'
import { idx } from './board'
import { applyMove, createGame, replay, resign, undo, type GameState } from './game'
import { BOARD_SIZE, type Point } from './types'

/** 连续落子，任一手非法就直接失败（用于铺局面）。 */
function mustMove(state: GameState, ...points: readonly Point[]): GameState {
  let next = state
  for (const point of points) {
    const result = applyMove(next, point)
    if (!result.ok) {
      throw new Error(`预期 (${point.x}, ${point.y}) 可以落子，实际返回 ${result.error}`)
    }
    next = result.state
  }
  return next
}

/** 按 `(黑, 白, 黑, 白, …)` 交替展开手顺。 */
function interleave(black: readonly Point[], white: readonly Point[]): Point[] {
  const moves: Point[] = []
  for (let i = 0; i < white.length; i++) {
    moves.push(black[i]!, white[i]!)
  }
  for (let i = white.length; i < black.length; i++) {
    moves.push(black[i]!)
  }
  return moves
}

/**
 * 满盘和棋的手顺。
 *
 * 填充模式 `(x + 2y) % 4 < 2` 决定黑子：横、竖、两条对角线上的最长连续同色都只有 2，
 * 因此终局不含五连；黑子恰好 113 枚、白子 112 枚，与「黑先、轮流下满 225 格」的
 * 奇偶性完全吻合。又因为「无五连局面的任意子集仍无五连」，全部中间局面也都合法。
 */
function drawOrder(): Point[] {
  const black: Point[] = []
  const white: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      ;((x + 2 * y) % 4 < 2 ? black : white).push({ x, y })
    }
  }
  return interleave(black, white)
}

/**
 * 最后一手既成五、又把棋盘填满的手顺。
 *
 * 在 `drawOrder` 的基底上把第 0 行的 (2,0)、(3,0) 改成黑子（造出 x = 0..5 的六连），
 * 再把第 14 行的 (0,14)、(1,14) 改成白子，把黑白数量配回 113 / 112。
 * 只要把 (3,0) 留到最后一手，前面任何时刻第 0 行至多四连，其余方向仍然最长只有 2。
 */
function lastMoveWinsOnFullBoard(): Point[] {
  const flippedToBlack = new Set(['2,0', '3,0'])
  const flippedToWhite = new Set(['0,14', '1,14'])
  const black: Point[] = []
  const white: Point[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const key = `${x},${y}`
      const isBlack = flippedToBlack.has(key)
        ? true
        : flippedToWhite.has(key)
          ? false
          : (x + 2 * y) % 4 < 2
      ;(isBlack ? black : white).push({ x, y })
    }
  }

  const lastIndex = black.findIndex((p) => p.x === 3 && p.y === 0)
  if (lastIndex < 0) throw new Error('构造失败：找不到 (3,0)')
  const [finalMove] = black.splice(lastIndex, 1)

  return [...interleave(black, white), finalMove!]
}

describe('createGame', () => {
  it('默认黑先、空盘、对局进行中', () => {
    const state = createGame()

    expect(state.current).toBe(1)
    expect(state.firstPlayer).toBe(1)
    expect(state.status).toBe('playing')
    expect(state.winner).toBeNull()
    expect(state.winLine).toBeNull()
    expect(state.lastMove).toBeNull()
    expect(state.moves).toHaveLength(0)
    expect(state.board.every((cell) => cell === 0)).toBe(true)
  })

  it('可以指定白先', () => {
    const state = createGame(2)

    expect(state.current).toBe(2)
    expect(state.firstPlayer).toBe(2)
  })
})

describe('applyMove —— 基本行为', () => {
  it('落子写入棋盘、记入手顺并切换手番', () => {
    const result = applyMove(createGame(), { x: 7, y: 7 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.board[idx(7, 7)]).toBe(1)
    expect(result.state.moves).toEqual([{ x: 7, y: 7 }])
    expect(result.state.lastMove).toEqual({ x: 7, y: 7 })
    expect(result.state.current).toBe(2)
  })

  it('手数递增即局面版本递增', () => {
    const state = mustMove(createGame(), { x: 7, y: 7 }, { x: 8, y: 8 })
    expect(state.version).toBe(2)
  })

  it('不修改传入的状态', () => {
    const before = createGame()
    const result = applyMove(before, { x: 7, y: 7 })

    expect(result.ok).toBe(true)
    expect(before.board[idx(7, 7)]).toBe(0)
    expect(before.moves).toHaveLength(0)
    expect(before.current).toBe(1)
    expect(before.version).toBe(0)
  })

  it('已占用的位置返回 occupied 且状态不变', () => {
    const state = mustMove(createGame(), { x: 7, y: 7 })

    expect(applyMove(state, { x: 7, y: 7 })).toEqual({ ok: false, error: 'occupied' })
  })

  it('越界坐标返回 out_of_bounds', () => {
    const state = createGame()

    expect(applyMove(state, { x: -1, y: 0 })).toEqual({ ok: false, error: 'out_of_bounds' })
    expect(applyMove(state, { x: 0, y: BOARD_SIZE })).toEqual({ ok: false, error: 'out_of_bounds' })
  })
})

describe('applyMove —— 胜负与和棋', () => {
  it('第五手连成五子时判胜，并给出整条连线', () => {
    const state = mustMove(
      createGame(),
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 7, y: 7 },
    )

    expect(state.status).toBe('won')
    expect(state.winner).toBe(1)
    expect(state.winLine).toEqual([
      { x: 3, y: 7 },
      { x: 4, y: 7 },
      { x: 5, y: 7 },
      { x: 6, y: 7 },
      { x: 7, y: 7 },
    ])
  })

  it('白棋第五手连成五子时 winner 为白', () => {
    const state = mustMove(
      createGame(),
      { x: 0, y: 0 },
      { x: 3, y: 8 },
      { x: 1, y: 0 },
      { x: 4, y: 8 },
      { x: 2, y: 0 },
      { x: 5, y: 8 },
      { x: 3, y: 0 },
      { x: 6, y: 8 },
      { x: 10, y: 10 },
      { x: 7, y: 8 },
    )

    expect(state.status).toBe('won')
    expect(state.winner).toBe(2)
  })

  it('长连同样判胜', () => {
    const state = mustMove(
      createGame(),
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 8, y: 7 },
      { x: 8, y: 8 },
      { x: 7, y: 7 },
    )

    expect(state.status).toBe('won')
    expect(state.winLine).toHaveLength(6)
  })

  it('终局后不能继续落子', () => {
    const state = mustMove(
      createGame(),
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 7, y: 7 },
    )

    expect(applyMove(state, { x: 10, y: 10 })).toEqual({ ok: false, error: 'game_over' })
  })

  it('棋盘填满且无人成五时判和棋', () => {
    const moves = drawOrder()
    expect(moves).toHaveLength(225)

    const state = replay(moves)

    expect(state.status).toBe('draw')
    expect(state.winner).toBeNull()
    expect(state.winLine).toBeNull()
    expect(state.moves).toHaveLength(225)
  })

  it('最后一手同时填满棋盘并成五时判胜，而不是和棋', () => {
    const moves = lastMoveWinsOnFullBoard()
    expect(moves).toHaveLength(225)
    expect(moves[224]).toEqual({ x: 3, y: 0 })

    const before = replay(moves.slice(0, 224))
    expect(before.status).toBe('playing')
    expect(before.board.every((cell) => cell !== 0)).toBe(false)

    const state = replay(moves)

    expect(state.status).toBe('won')
    expect(state.winner).toBe(1)
    expect(state.winLine).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ])
  })

  it('和棋之后同样不能落子', () => {
    const state = replay(drawOrder())
    expect(applyMove(state, { x: 0, y: 0 })).toEqual({ ok: false, error: 'game_over' })
  })
})

describe('undo', () => {
  it('默认撤销一手并恢复手番', () => {
    const state = mustMove(createGame(), { x: 7, y: 7 }, { x: 8, y: 8 })
    const back = undo(state)

    expect(back.moves).toEqual([{ x: 7, y: 7 }])
    expect(back.current).toBe(2)
    expect(back.board[idx(8, 8)]).toBe(0)
    expect(back.board[idx(7, 7)]).toBe(1)
    expect(back.lastMove).toEqual({ x: 7, y: 7 })
  })

  it('可以一次撤销多手', () => {
    const state = mustMove(createGame(), { x: 7, y: 7 }, { x: 8, y: 8 }, { x: 9, y: 9 })
    const back = undo(state, 2)

    expect(back.moves).toEqual([{ x: 7, y: 7 }])
    expect(back.current).toBe(2)
    expect(back.version).toBe(1)
  })

  it('撤销到空盘时 lastMove 归零', () => {
    const state = mustMove(createGame(), { x: 7, y: 7 })
    const back = undo(state)

    expect(back.moves).toHaveLength(0)
    expect(back.lastMove).toBeNull()
    expect(back.current).toBe(1)
  })

  it('撤销手数超过已有手数时回到空盘，而不是报错', () => {
    const state = mustMove(createGame(), { x: 7, y: 7 }, { x: 8, y: 8 })
    const back = undo(state, 99)

    expect(back.moves).toHaveLength(0)
    expect(back.status).toBe('playing')
  })

  it('可以从已结束的对局撤销回进行中，并清除胜负信息', () => {
    const won = mustMove(
      createGame(),
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 7, y: 7 },
    )
    const back = undo(won)

    expect(back.status).toBe('playing')
    expect(back.winner).toBeNull()
    expect(back.winLine).toBeNull()
    expect(back.current).toBe(1)
  })

  it('可以撤销和棋局面', () => {
    const drawn = replay(drawOrder())
    const back = undo(drawn, 2)

    expect(back.status).toBe('playing')
    expect(back.moves).toHaveLength(223)
    // 已下 223 手，接下来是第 224 手，轮白棋。
    expect(back.current).toBe(2)
  })

  it('空盘撤销不报错且状态不变', () => {
    const empty = createGame()
    const back = undo(empty)

    expect(back.moves).toHaveLength(0)
    expect(back.status).toBe('playing')
  })

  it('白先的对局撤销后手番仍然是白', () => {
    const state = mustMove(createGame(2), { x: 7, y: 7 })
    expect(undo(state).current).toBe(2)
  })
})

describe('resign', () => {
  it('认输后判对方获胜', () => {
    const state = resign(createGame(), 1)

    expect(state.status).toBe('resigned')
    expect(state.winner).toBe(2)
    expect(state.moves).toHaveLength(0)
  })

  it('已结束的对局再认输不改变结果', () => {
    const won = mustMove(
      createGame(),
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 7, y: 7 },
    )
    const after = resign(won, 1)

    expect(after.status).toBe('won')
    expect(after.winner).toBe(1)
  })

  it('认输后不能落子', () => {
    const state = resign(createGame(), 1)
    expect(applyMove(state, { x: 7, y: 7 })).toEqual({ ok: false, error: 'game_over' })
  })
})

describe('replay', () => {
  it('从手顺重建的结果与逐步落子完全一致', () => {
    const moves: Point[] = [
      { x: 7, y: 7 },
      { x: 7, y: 8 },
      { x: 8, y: 8 },
      { x: 6, y: 6 },
      { x: 9, y: 9 },
    ]
    const stepped = mustMove(createGame(), ...moves)
    const rebuilt = replay(moves)

    expect(rebuilt.board).toEqual(stepped.board)
    expect(rebuilt.moves).toEqual(stepped.moves)
    expect(rebuilt.current).toBe(stepped.current)
    expect(rebuilt.status).toBe(stepped.status)
    expect(rebuilt.winner).toBe(stepped.winner)
    expect(rebuilt.lastMove).toEqual(stepped.lastMove)
    expect(rebuilt.version).toBe(stepped.version)
  })

  it('忽略胜负已分之后的多余手顺', () => {
    const moves = [
      { x: 3, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
      { x: 7, y: 7 },
      { x: 10, y: 10 },
    ]
    const state = replay(moves)

    expect(state.status).toBe('won')
    expect(state.board[idx(10, 10)]).toBe(0)
  })

  it('空手顺得到与 createGame 相同的局面', () => {
    const state = replay([])
    expect(state.board).toEqual(createGame().board)
    expect(state.status).toBe('playing')
    expect(state.current).toBe(1)
  })
})
