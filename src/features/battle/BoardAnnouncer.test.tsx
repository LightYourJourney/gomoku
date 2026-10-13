import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../../core/game'
import { applyMove, createGame, resign } from '../../core/game'
import { BLACK } from '../../core/types'
import { BoardAnnouncer } from './BoardAnnouncer'

function playMoves(points: readonly { x: number; y: number }[]): GameState {
  let state = createGame()
  for (const point of points) {
    const result = applyMove(state, point)
    if (!result.ok) throw new Error(`落子失败：${point.x},${point.y}`)
    state = result.state
  }
  return state
}

function renderAnnouncer(overrides: Partial<Parameters<typeof BoardAnnouncer>[0]> = {}) {
  return render(
    <BoardAnnouncer game={createGame()} aiThinking={false} mode="pve" humanColor={BLACK} {...overrides} />,
  )
}

describe('BoardAnnouncer', () => {
  it('是可被读屏播报的状态区', () => {
    renderAnnouncer()

    const region = screen.getByTestId('board-announcer')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('开局时说明棋盘是空的、轮到玩家', () => {
    renderAnnouncer()

    expect(screen.getByTestId('board-announcer')).toHaveTextContent('开局，棋盘是空的')
    expect(screen.getByTestId('board-announcer')).toHaveTextContent('轮到你落子')
  })

  it('AI 思考中要说出来——键盘玩家按 Enter 没反应时，这是唯一的原因来源', () => {
    renderAnnouncer({ aiThinking: true })

    expect(screen.getByTestId('board-announcer')).toHaveTextContent('AI 正在思考')
  })

  it('落子后播报最新一手的位置', () => {
    const first = applyMove(createGame(), { x: 7, y: 7 })
    if (!first.ok) throw new Error('落子失败')

    // 人执黑、黑棋刚落子 → 轮到白棋（AI），对玩家来说是「等待对手」
    renderAnnouncer({ game: first.state, humanColor: BLACK })

    expect(screen.getByTestId('board-announcer')).toHaveTextContent('最后一手在 H8')
    expect(screen.getByTestId('board-announcer')).toHaveTextContent('等待对手落子')
  })

  /**
   * 本地双人**按颜色播报**，不套用单人对 AI 的「你」视角
   * （任务书 §三 点名，且要求与可见状态条一致）。
   *
   * 这条用例原先断言的是「两方都算『轮到你』」——那是**故意的旧行为**，
   * 但它与状态条分叉，也与任务书的视角要求冲突。Phase 02 的验收自审时改正，
   * 断言换成更强的那一条：颜色要说出来。
   */
  it('本地双人按颜色播报，与状态条同一句话', () => {
    const first = applyMove(createGame(), { x: 7, y: 7 })
    if (!first.ok) throw new Error('落子失败')

    renderAnnouncer({ game: first.state, mode: 'pvp' })

    // 黑先落子之后轮到白棋
    expect(screen.getByTestId('board-announcer')).toHaveTextContent('轮到白棋')
    expect(screen.getByTestId('board-announcer')).not.toHaveTextContent('你')
  })

  it('认输终局播报结果，且用界面上的同一句话', () => {
    // 人执黑认输。播报说的是状态条上那句「你认输了」，
    // 不是另造一句「白棋获胜（对手认输）」——同一个屏幕两种说法像两件事。
    renderAnnouncer({ game: resign(createGame(), BLACK) })

    expect(screen.getByTestId('board-announcer')).toHaveTextContent('你认输了，共 0 手')
  })

  it('成五终局播报结果与手数', () => {
    const played = playMoves([
      { x: 0, y: 0 }, { x: 0, y: 1 },
      { x: 1, y: 0 }, { x: 1, y: 1 },
      { x: 2, y: 0 }, { x: 2, y: 1 },
      { x: 3, y: 0 }, { x: 3, y: 1 },
      { x: 4, y: 0 },
    ])

    renderAnnouncer({ game: played })

    expect(screen.getByTestId('board-announcer')).toHaveTextContent('你赢了，共 9 手')
  })

  it('和棋也播报手数', () => {
    renderAnnouncer({ game: { ...createGame(), status: 'draw' } })

    expect(screen.getByTestId('board-announcer')).toHaveTextContent('和棋，共 0 手')
  })
})
