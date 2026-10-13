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

  /*
   * 本地双人**沿用状态条那句话**（「轮到黑棋」/「轮到白棋」）。
   *
   * 这里原先一律说「轮到你落子」——同一块屏幕上坐着两个人，这话指谁都是错的，
   * 而且它与状态条各说各的：眼睛看到「轮到黑棋」，耳朵听到「轮到你落子」，
   * 而任务书 §三 明确要求两者一致。终局那一支早就是这么做的（复用
   * `describeStatus`），中盘这一支是漏网的。
   */
  if (mode === 'pvp') {
    return `${last}。${describeStatus({ game, mode, humanColor, aiThinking }).label}`
  }

  const mine = game.current === humanColor
  return `${last}。${mine ? '轮到你落子' : '等待对手落子'}`
}
