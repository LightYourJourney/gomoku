import type { GameState } from '../../core/game'
import { formatPoint } from '../../lib/coords'
import { describeStatus } from './status'

export interface BoardAnnouncerProps {
  readonly game: GameState
  readonly aiThinking: boolean
  readonly mode: 'pve' | 'pvp'
  readonly humanColor: 1 | 2
}

/**
 * 状态播报（`aria-live`）。
 *
 * 为什么不住在 `Board` 里：棋盘只知道「可不可交互」这一个布尔，
 * 说不出**为什么**不能落子——是 AI 在思考、还是没轮到你、还是对局已经结束。
 * 键盘用户按 Enter 没反应却听不到原因，就会以为界面坏了。这些信息
 * `BattleScreen` 本来就握着。
 */
export function BoardAnnouncer({ game, aiThinking, mode, humanColor }: BoardAnnouncerProps) {
  return (
    <div role="status" aria-live="polite" data-testid="board-announcer" className="sr-only">
      {describe(game, aiThinking, mode, humanColor)}
    </div>
  )
}

function describe(
  game: GameState,
  aiThinking: boolean,
  mode: 'pve' | 'pvp',
  humanColor: 1 | 2,
): string {
  // 终局复用可见状态条的措辞：同一个屏幕上，「你认输了」和「白棋获胜」
  // 两种说法各说各的会让人以为说的是两件事。
  if (game.status !== 'playing') {
    return `${describeStatus({ game, mode, humanColor, aiThinking }).label}，共 ${game.moves.length} 手`;
  }

  const last = game.lastMove === null ? '开局，棋盘是空的' : `最后一手在 ${formatPoint(game.lastMove)}`
  if (aiThinking) return `${last}。AI 正在思考，请稍候`

  const mine = mode === 'pvp' || game.current === humanColor
  return `${last}。${mine ? '轮到你落子' : '等待对手落子'}`
}
