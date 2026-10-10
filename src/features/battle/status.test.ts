import { describe, expect, it } from 'vitest'
import { applyMove, createGame, resign, type GameState } from '../../core/game'
import { BLACK, WHITE, type Point } from '../../core/types'
import { describeStatus, type StatusInput } from './status'

function play(state: GameState, ...points: readonly Point[]): GameState {
  let next = state
  for (const point of points) {
    const outcome = applyMove(next, point)
    if (!outcome.ok) throw new Error(`落子失败：${outcome.error}`)
    next = outcome.state
  }
  return next
}

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    game: createGame(),
    mode: 'pve',
    humanColor: BLACK,
    aiThinking: false,
    ...overrides,
  }
}

const WINNING: readonly Point[] = [
  { x: 3, y: 7 },
  { x: 3, y: 8 },
  { x: 4, y: 7 },
  { x: 4, y: 8 },
  { x: 5, y: 7 },
  { x: 5, y: 8 },
  { x: 6, y: 7 },
  { x: 6, y: 8 },
  { x: 7, y: 7 },
]

describe('describeStatus —— 进行中', () => {
  it('人机模式下轮到玩家时提示落子', () => {
    expect(describeStatus(input())).toEqual({
      tone: 'playing',
      label: '轮到你落子',
      player: BLACK,
    })
  })

  it('人机模式下轮到 AI 且正在思考', () => {
    const status = describeStatus(input({ game: play(createGame(), { x: 7, y: 7 }), aiThinking: true }))

    expect(status.tone).toBe('thinking')
    expect(status.label).toBe('AI 思考中…')
    expect(status.player).toBe(WHITE)
  })

  it('轮到 AI 但尚未开始思考时也提示在等 AI', () => {
    const status = describeStatus(input({ game: play(createGame(), { x: 7, y: 7 }) }))

    expect(status.tone).toBe('thinking')
    expect(status.player).toBe(WHITE)
  })

  it('本地双人模式按颜色提示手番', () => {
    expect(describeStatus(input({ mode: 'pvp' })).label).toBe('轮到黑棋')

    const afterOne = play(createGame(), { x: 7, y: 7 })
    expect(describeStatus(input({ mode: 'pvp', game: afterOne })).label).toBe('轮到白棋')
  })
})

describe('describeStatus —— 终局', () => {
  it('人机模式下玩家取胜', () => {
    const game = play(createGame(), ...WINNING)

    expect(describeStatus(input({ game }))).toEqual({
      tone: 'result',
      label: '你赢了',
      player: BLACK,
    })
  })

  it('人机模式下玩家执白取胜同样算「你赢了」', () => {
    // 白先时，WINNING 里第 1、3、5、7、9 手归白棋，正好连成 y = 7 的五连。
    const game = play(createGame(WHITE), ...WINNING)

    expect(game.winner).toBe(WHITE)
    expect(describeStatus(input({ game, humanColor: WHITE })).label).toBe('你赢了')
  })

  it('本地双人模式按颜色报胜方', () => {
    const game = play(createGame(), ...WINNING)

    expect(describeStatus(input({ game, mode: 'pvp' })).label).toBe('黑棋获胜')
  })

  it('人机模式下玩家认输', () => {
    const game = resign(createGame(), BLACK)

    expect(describeStatus(input({ game }))).toEqual({
      tone: 'result',
      label: '你认输了',
      player: WHITE,
    })
  })

  it('本地双人模式报出认输方与获胜方', () => {
    const game = resign(createGame(), WHITE)

    expect(describeStatus(input({ game, mode: 'pvp' })).label).toBe('白棋认输，黑棋获胜')
  })

  it('和棋没有归属方', () => {
    const game: GameState = { ...createGame(), status: 'draw' }

    expect(describeStatus(input({ game }))).toEqual({
      tone: 'result',
      label: '和棋',
      player: null,
    })
  })
})
