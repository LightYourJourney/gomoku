import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { applyMove, createGame, resign } from '../../core/game'
import type { GameState } from '../../core/game'
import { BLACK, WHITE, type Point } from '../../core/types'
import { MatchBar } from './MatchBar'

/** 落几手，做出一个「进行中、该谁走是确定的」局面。 */
function played(points: readonly Point[]): GameState {
  let state = createGame()
  for (const point of points) {
    const result = applyMove(state, point)
    if (!result.ok) throw new Error(`落子失败：${point.x},${point.y}`)
    state = result.state
  }
  return state
}

function setup(overrides: Partial<Parameters<typeof MatchBar>[0]> = {}) {
  const props = {
    game: createGame(),
    mode: 'pve' as const,
    humanColor: BLACK,
    difficulty: 'easy' as const,
    aiThinking: false,
    ...overrides,
  }

  return render(<MatchBar {...props} />)
}

function side(player: 1 | 2): HTMLElement {
  return screen.getByTestId(`match-side-${player}`)
}

describe('MatchBar —— 双方信息', () => {
  it('人机模式：玩家执黑时，黑在左、AI 在右并带出难度', () => {
    setup({ humanColor: BLACK, difficulty: 'medium' })

    expect(side(BLACK)).toHaveTextContent('你')
    expect(side(BLACK)).toHaveTextContent('黑')
    expect(side(WHITE)).toHaveTextContent('AI')
    expect(side(WHITE)).toHaveTextContent('中级')
  })

  it('人机模式：玩家执白时左右跟着换，而不是固定把玩家放左边', () => {
    setup({ humanColor: WHITE, difficulty: 'expert' })

    // 左黑右白是固定的空间映射，换的是「谁在这一侧」
    expect(side(BLACK)).toHaveTextContent('AI')
    expect(side(BLACK)).toHaveTextContent('专家')
    expect(side(WHITE)).toHaveTextContent('你')
    expect(side(WHITE)).toHaveTextContent('白')
  })

  /**
   * 任务书点名的一条：**本地双人时不能沿用单人对 AI 的「你」视角**。
   * 同一块屏幕上坐着两个人，「你」指谁都是错的。
   */
  it('本地双人：说黑方白方，不说「你」', () => {
    setup({ mode: 'pvp' })

    expect(side(BLACK)).toHaveTextContent('黑方')
    expect(side(WHITE)).toHaveTextContent('白方')
    expect(side(BLACK)).not.toHaveTextContent('你')
    expect(side(WHITE)).not.toHaveTextContent('你')
  })

  it('本地双人：不带 AI 难度——那一局里没有 AI', () => {
    setup({ mode: 'pvp', difficulty: 'expert' })

    expect(screen.queryByText('专家')).not.toBeInTheDocument()
  })
})

describe('MatchBar —— 当前回合', () => {
  it('轮到黑棋时只有黑方一侧被标成行动方', () => {
    setup()

    expect(side(BLACK)).toHaveAttribute('data-active', 'true')
    expect(side(WHITE)).not.toHaveAttribute('data-active')
  })

  it('轮到白棋时反过来', () => {
    setup({ game: played([{ x: 7, y: 7 }]) })

    expect(side(WHITE)).toHaveAttribute('data-active', 'true')
    expect(side(BLACK)).not.toHaveAttribute('data-active')
  })

  it('行动方用的是 accent-soft —— 与顶栏导航选中项同一套语义', () => {
    setup()

    const classes = side(BLACK).className.split(/\s+/)
    expect(classes).toContain('bg-accent-soft')
    expect(classes).toContain('text-accent')
    // surface-2 表达的是「次级表面 / 悬停底色」，不是「当前」
    expect(classes).not.toContain('bg-surface-2')
  })

  it('终局之后两侧都不再是行动方', () => {
    setup({ game: resign(played([{ x: 7, y: 7 }]), BLACK) })

    expect(side(BLACK)).not.toHaveAttribute('data-active')
    expect(side(WHITE)).not.toHaveAttribute('data-active')
  })
})

describe('MatchBar —— 状态与手数', () => {
  it('状态文案来自 describeStatus，人机模式说「轮到你落子」', () => {
    setup()

    expect(screen.getByTestId('status-pill')).toHaveTextContent('轮到你落子')
  })

  it('AI 在思考时药丸转圈', () => {
    const { container } = setup({ game: played([{ x: 7, y: 7 }]), aiThinking: true })

    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  /**
   * F-UI-06：「轮到 AI」但没在思考时**不转圈**——那种时候真实情况是
   * 引擎欠着一手或出了错，转圈的语义「正在进行」是假话。
   */
  it('只是轮到 AI、没在思考时不转圈', () => {
    const { container } = setup({ game: played([{ x: 7, y: 7 }]), aiThinking: false })

    expect(screen.getByTestId('status-pill')).toHaveTextContent('轮到 AI')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('终局显示结果', () => {
    setup({ game: resign(played([{ x: 7, y: 7 }]), BLACK) })

    expect(screen.getByTestId('status-pill')).toHaveTextContent('你认输了')
  })

  it('手数跟着走', () => {
    setup({ game: played([{ x: 7, y: 7 }, { x: 8, y: 8 }, { x: 6, y: 6 }]) })

    expect(screen.getByTestId('match-moves')).toHaveTextContent('3 手')
  })

  it('状态药丸仍然是唯一那一个 status-pill（e2e 与探针都锚在它上面）', () => {
    setup()

    expect(within(screen.getByLabelText('对局状态')).getAllByTestId('status-pill')).toHaveLength(1)
  })
})
