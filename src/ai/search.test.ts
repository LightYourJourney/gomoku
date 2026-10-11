import { describe, expect, it } from 'vitest'
import { createBoard } from '../core/board'
import { BLACK, WHITE, type Board, type Player } from '../core/types'
import { boardFromLines, nearlyFullBoard } from '../test/board-fixtures'
import { chooseMove, searchBoard } from './search'
import type { Difficulty, SearchRequest, SearchResponse } from './types'

/** `purpose` 不在可覆盖之列：会被展开成 `RequestPurpose | undefined`，破坏必填性。 */
function ask(
  board: Board,
  player: Player,
  difficulty: Difficulty = 'easy',
  extra: Omit<Partial<SearchRequest>, 'purpose'> = {},
): SearchResponse {
  return chooseMove({
    requestId: 1,
    gameVersion: 0,
    board,
    player,
    difficulty,
    purpose: 'play',
    ...extra,
  })
}

describe('chooseMove —— 必胜与必防', () => {
  it('己方有四连时立即补成五', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...BBBB........',
    ])

    const result = ask(board, BLACK)

    expect(result.reason).toBe('win')
    expect([{ x: 2, y: 2 }, { x: 7, y: 2 }]).toContainEqual(result.move)
  })

  it('对手有四连时立即堵住', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '..BWWWW........',
    ])

    const result = ask(board, BLACK)

    expect(result.reason).toBe('block')
    expect(result.move).toEqual({ x: 7, y: 2 })
  })

  it('能赢的时候不会去防守', () => {
    // 黑棋自己有四连，白棋也有四连；黑棋应当直接取胜。
    const board = boardFromLines([
      '...............',
      '...BBBB........',
      '...............',
      '..W.WWWW.......',
    ])

    const result = ask(board, BLACK)

    expect(result.reason).toBe('win')
    expect([{ x: 2, y: 1 }, { x: 7, y: 1 }]).toContainEqual(result.move)
  })

  it('白棋同样会补成五', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...WWWW........',
    ])

    const result = ask(board, WHITE)

    expect(result.reason).toBe('win')
    expect([{ x: 2, y: 2 }, { x: 7, y: 2 }]).toContainEqual(result.move)
  })
})

describe('chooseMove —— 战术判断', () => {
  it('对手活三时必须应对', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....WWW.......',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      'B..............',
    ])

    const result = ask(board, BLACK)

    expect([{ x: 4, y: 7 }, { x: 8, y: 7 }]).toContainEqual(result.move)
  })

  it('不会放过自己成四的机会', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BBB.......',
      '.....WW........',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
    ])

    const result = ask(board, BLACK)

    expect([{ x: 4, y: 7 }, { x: 8, y: 7 }]).toContainEqual(result.move)
  })
})

describe('chooseMove —— 开局与边界', () => {
  it('空盘时下天元', () => {
    const result = ask(createBoard(), BLACK)

    expect(result.move).toEqual({ x: 7, y: 7 })
    expect(result.reason).toBe('opening')
  })

  it('满盘时没有可走的着法', () => {
    const board = createBoard()
    board.fill(1)

    const result = ask(board, BLACK)

    expect(result.move).toBeNull()
    expect(result.reason).toBe('no_move')
  })

  it('返回的着法一定落在空位上', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE)

    expect(result.move).not.toBeNull()
    expect(board[result.move!.y * 15 + result.move!.x]).toBe(0)
  })
})

describe('chooseMove —— 时间预算', () => {
  it('预算极小时仍然返回一个合法着法，并标记为超时回退', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE, 'expert', { budgetMs: 0 })

    expect(result.move).not.toBeNull()
    expect(result.reason).toBe('timeout')
    expect(result.confidence).toBe('heuristic')
    expect(board[result.move!.y * 15 + result.move!.x]).toBe(0)
  })

  it('预算充足时给出精确结论', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE, 'easy', { budgetMs: 5000 })

    expect(result.reason).toBe('search')
    expect(result.confidence).toBe('exact')
    expect(result.depth).toBeGreaterThan(0)
  })

  it('记录搜索耗时与节点数', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, WHITE)

    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(result.nodes).toBeGreaterThan(0)
  })
})

describe('searchBoard —— 置换表与注入时钟', () => {
  // 中盘局面：多个方向都有应手，不同着法次序容易走到同一局面（换位）
  const MIDGAME = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '......WB.......',
    '.....BWB.......',
    '......BW.......',
    '.......B.......',
  ])

  const options = {
    width: 10,
    maxDepth: 4,
    budgetMs: 60_000,
    transposition: true,
    threatPlies: 0,
    threatThrees: false,
    attack: 1,
    defense: 1,
  }
  const clock = (): number => 0

  it('开启置换表后节点数少于关闭时', () => {
    const withTable = searchBoard(MIDGAME, WHITE, options, clock)
    const withoutTable = searchBoard(MIDGAME, WHITE, { ...options, transposition: false }, clock)

    expect(withTable.nodes).toBeLessThan(withoutTable.nodes)
  })

  it('置换表确实产生过命中', () => {
    // 没有这一条，上面的节点数对比可能只是两个相等的数在互相比较
    const result = searchBoard(MIDGAME, WHITE, options, clock)

    expect(result.ttHits).toBeGreaterThan(0)
  })

  it('开启置换表不改变必胜局面的结论', () => {
    // 用有唯一正确着法的局面：黑棋四连，两端都能成五，随便选一端都是胜
    const mustWin = boardFromLines(['...............', '...............', '...BBBB........'])
    const winOptions = {
      width: 10,
      maxDepth: 4,
      budgetMs: 60_000,
      transposition: true,
      threatPlies: 0,
      threatThrees: false,
      attack: 1,
      defense: 1,
    }

    const withTable = searchBoard(mustWin, BLACK, winOptions, clock)
    const withoutTable = searchBoard(mustWin, BLACK, { ...winOptions, transposition: false }, clock)

    expect(withTable.score).toBe(withoutTable.score)
    expect([{ x: 2, y: 2 }, { x: 7, y: 2 }]).toContainEqual(withTable.move)
  })

  it('必胜分值不随搜索深度漂移', () => {
    // canWinNow 返回 WIN_SCORE - ply，若直接存表就会带上「本次迭代目标深度」，
    // 同一局面在不同 maxDepth 下会拿到不同分值。
    const mustWin = boardFromLines(['...............', '...............', '...BBBB........'])
    const base = {
      width: 10,
      budgetMs: 60_000,
      transposition: true,
      threatPlies: 0,
      threatThrees: false,
      attack: 1,
      defense: 1,
    }

    const shallow = searchBoard(mustWin, BLACK, { ...base, maxDepth: 2 }, clock)
    const deep = searchBoard(mustWin, BLACK, { ...base, maxDepth: 5 }, clock)

    expect(shallow.score).toBe(deep.score)
  })

  it('注入的时钟走到预算耗尽时返回超时回退，并给出合法着法', () => {
    let ticks = 0
    // 第一次调用给起点，之后每次直接跳过预算
    const expiringClock = (): number => {
      ticks++
      return ticks === 1 ? 0 : 10_000
    }

    const result = searchBoard(MIDGAME, WHITE, { ...options, budgetMs: 100 }, expiringClock)

    expect(result.reason).toBe('timeout')
    expect(result.move).not.toBeNull()
    expect(MIDGAME[result.move!.y * 15 + result.move!.x]).toBe(0)
  })
})

describe('searchBoard —— 提示用的候选与紧急度', () => {
  const clock = (): number => 0
  const base = {
    width: 10,
    maxDepth: 2,
    budgetMs: 60_000,
    transposition: true,
    threatPlies: 0,
    threatThrees: false,
    attack: 1,
    defense: 1,
    diagnostics: true,
  }

  const MIDGAME = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '......WB.......',
    '.....BWB.......',
    '......BW.......',
    '.......B.......',
  ])

  it('给出候选，按推荐度降序', () => {
    const result = searchBoard(MIDGAME, WHITE, base, clock)

    expect(result.candidates.length).toBeGreaterThan(0)
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1]!.score).toBeGreaterThanOrEqual(result.candidates[i]!.score)
    }
  })

  it('候选最多三个', () => {
    expect(searchBoard(MIDGAME, WHITE, base, clock).candidates.length).toBeLessThanOrEqual(3)
  })

  it('候选全部落在空位上，且带攻防棋型标注', () => {
    const result = searchBoard(MIDGAME, WHITE, base, clock)

    for (const candidate of result.candidates) {
      expect(MIDGAME[candidate.move.y * 15 + candidate.move.x]).toBe(0)
      expect(typeof candidate.attack).toBe('string')
      expect(typeof candidate.defense).toBe('string')
    }
  })

  it('能立刻成五时紧急度为 win', () => {
    const mustWin = boardFromLines(['...............', '...............', '...BBBB........'])

    expect(searchBoard(mustWin, BLACK, base, clock).urgency).toBe('win')
  })

  it('对手下一手能成五时紧急度为 mustBlock', () => {
    const mustBlock = boardFromLines(['...............', '...............', '..BWWWW........'])

    expect(searchBoard(mustBlock, BLACK, base, clock).urgency).toBe('mustBlock')
  })

  it('双方都无立即威胁时紧急度为 normal', () => {
    const quiet = boardFromLines(['...............', '...............', '...............', '...B.W.........', '...............', '...............', '...............', '...............', '...............', '...............', '...............', '...............', '...............', '...............', '...............'])

    expect(searchBoard(quiet, BLACK, base, clock).urgency).toBe('normal')
  })

  it('purpose 为 play 时不付诊断的钱：候选为空、紧急度为 normal', () => {
    const result = ask(MIDGAME, WHITE)

    expect(result.candidates).toEqual([])
    expect(result.urgency).toBe('normal')
  })

  it('purpose 为 hint 时填上候选与紧急度', () => {
    // 用无立即威胁的安静局面，好让紧急度断言不依赖具体棋型的细节。
    const quiet = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...B.W.........',
    ])

    const result = chooseMove({
      requestId: 1,
      gameVersion: 0,
      board: quiet,
      player: BLACK,
      difficulty: 'easy',
      purpose: 'hint',
    })

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.urgency).toBe('normal')
  })

  it('必防时头号候选就是那个堵点', () => {
    // 候选只按**静态棋型**排序，不走搜索结果。这条用例守的就是这个排序够不够用：
    // 白棋四连时，堵点对白方来说是成五点，防守分吃满，必须排第一。
    const mustBlock = boardFromLines(['...............', '...............', '..BWWWW........'])

    const result = searchBoard(mustBlock, BLACK, base, clock)

    expect(result.urgency).toBe('mustBlock')
    expect(result.candidates[0]!.move).toEqual({ x: 7, y: 2 })
    expect(result.candidates[0]!.defense).toBe('five')
  })

  it('能立即取胜时头号候选就是制胜点', () => {
    const mustWin = boardFromLines(['...............', '...............', '...BBBB........'])

    const result = searchBoard(mustWin, BLACK, base, clock)

    expect(result.urgency).toBe('win')
    expect([{ x: 2, y: 2 }, { x: 7, y: 2 }]).toContainEqual(result.candidates[0]!.move)
    expect(result.candidates[0]!.attack).toBe('five')
  })

  it('对手有多个成五点时候选覆盖其中不止一个', () => {
    // 五个白子里有两个成五点（两端），只给一个的话玩家会以为只有一条路。
    const twoWays = boardFromLines(['...............', '...............', '..WWWWW........'])

    const result = searchBoard(twoWays, BLACK, base, clock)
    const moves = result.candidates.map((candidate) => `${candidate.move.x},${candidate.move.y}`)

    expect(result.urgency).toBe('mustBlock')
    expect(moves).toContain('1,2')
    expect(moves).toContain('7,2')
  })

  it('接近满盘时候选数量随空位减少，且不崩', () => {
    const almostFull = nearlyFullBoard()

    const result = searchBoard(almostFull, WHITE, base, clock)

    // 先钉住这个局面真的进了搜索。之前用的「相邻行黑白交替」填充里，主对角线
    // 全是一色、黑棋早已连成十四子，引擎走的是必防捷径——那条用例在捷径下
    // 同样通过，等于什么都没测。
    expect(result.reason).toBe('search')

    expect(result.candidates.length).toBeLessThanOrEqual(3)
    for (const candidate of result.candidates) {
      expect(almostFull[candidate.move.y * 15 + candidate.move.x]).toBe(0)
    }
  })
})

describe('searchBoard —— 贪心兜底按难度权重取舍', () => {
  // 预算为 0 且时钟不动，迭代加深一层都搜不完，着法必然来自贪心兜底。
  const clock = (): number => 0
  const base = {
    width: 10,
    maxDepth: 4,
    budgetMs: 0,
    transposition: false,
    threatPlies: 0,
    threatThrees: false,
    attack: 1,
    defense: 1,
  }

  // 黑棋一条活二（第 3 行），白棋一条活三（第 10 行），两组着法互不重叠。
  const ATTACK_POINTS = [{ x: 2, y: 3 }, { x: 5, y: 3 }]
  const DEFENSE_POINTS = [{ x: 4, y: 10 }, { x: 8, y: 10 }]
  const SPLIT = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...BB..........',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '.....WWW.......',
  ])

  it('进攻权重高时去扩自己的活二', () => {
    const result = searchBoard(SPLIT, BLACK, { ...base, attack: 1, defense: 0 }, clock)

    expect(ATTACK_POINTS).toContainEqual(result.move)
  })

  it('防守权重高时去堵白棋的活三', () => {
    const result = searchBoard(SPLIT, BLACK, { ...base, attack: 0, defense: 1 }, clock)

    expect(DEFENSE_POINTS).toContainEqual(result.move)
  })

  it('两档权重真的不同，而不是都走同一手', () => {
    // 上一版把权重写死成 easy（1 / 1），于是 beginner 的 defense = 0.6 成了死配置。
    // 这条钉住「权重确实传进来了」：两个极端必须给出不同的着法。
    const attacking = searchBoard(SPLIT, BLACK, { ...base, attack: 1, defense: 0 }, clock)
    const defending = searchBoard(SPLIT, BLACK, { ...base, attack: 0, defense: 1 }, clock)

    expect(attacking.move).not.toEqual(defending.move)
  })
})

describe('chooseMove —— 难度差异', () => {
  it('入门与初级都能应对对手的活三', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....WWW.......',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      'B..............',
    ])

    for (const difficulty of ['beginner', 'easy'] as const) {
      const result = ask(board, BLACK, difficulty)
      expect([{ x: 4, y: 7 }, { x: 8, y: 7 }]).toContainEqual(result.move)
    }
  })

  it('请求原样带回 requestId 与 gameVersion，供主线程作废过期结果', () => {
    const board = boardFromLines(['...............', '...............', '...............', '...............', '...............', '...............', '...............', '.....BWB.......'])

    const result = ask(board, WHITE, 'easy', { requestId: 42, gameVersion: 7 })

    expect(result.requestId).toBe(42)
    expect(result.gameVersion).toBe(7)
  })
})

describe('analyze 用途', () => {
  it("purpose: 'analyze' 的请求走完整搜索并原样回传 moveIndex", () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])

    const result = ask(board, BLACK, 'easy', { purpose: 'analyze', moveIndex: 5 })

    expect(result.moveIndex).toBe(5)
    expect(result.move).not.toBeNull()
    expect(result.confidence).toBe('exact')
  })
})
