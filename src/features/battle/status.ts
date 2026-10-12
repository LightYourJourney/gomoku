import { opponentOf } from '../../core/board'
import type { GameState } from '../../core/game'
import { BLACK, type Player } from '../../core/types'
import type { GameMode } from '../../store/gameStore'

export type StatusTone = 'playing' | 'thinking' | 'result'

export interface GameStatusDescriptor {
  readonly tone: StatusTone
  readonly label: string
  /** 该状态对应的棋子颜色；和棋等无归属的情形为 null。 */
  readonly player: Player | null
}

export interface StatusInput {
  readonly game: GameState
  readonly mode: GameMode
  readonly humanColor: Player
  readonly aiThinking: boolean
}

const COLOR_NAMES: Record<Player, string> = { 1: '黑棋', 2: '白棋' }

/**
 * 某一方的称呼。**全页唯一的一处**——状态条与确认弹窗的后果描述都用它。
 *
 * 任务书的硬要求：本地双人下**不存在「你」**（同一块屏幕上坐着两个人，
 * 「你」指谁都是错的），所以人机模式的「你 / AI」与双人的「黑方 / 白方」
 * 必须来自同一个函数。两处各写一遍，迟早会在某一处漏掉这条。
 *
 * 放在这个模块里而不是组件文件里：它是**命名规则**，与「状态怎么说」是同一类东西，
 * 而且留在组件文件里会破坏 Fast Refresh（一个文件只导出组件）。
 */
export function playerName(player: Player, mode: GameMode, humanColor: Player): string {
  if (mode === 'pvp') return player === BLACK ? '黑方' : '白方'
  return player === humanColor ? '你' : 'AI'
}

function describeResult(input: StatusInput): GameStatusDescriptor | null {
  const { game, mode, humanColor } = input
  const winner = game.winner

  if (game.status === 'won' && winner !== null) {
    if (mode === 'pve') {
      return {
        tone: 'result',
        label: winner === humanColor ? '你赢了' : 'AI 获胜',
        player: winner,
      }
    }
    return { tone: 'result', label: `${COLOR_NAMES[winner]}获胜`, player: winner }
  }

  if (game.status === 'resigned' && winner !== null) {
    if (mode === 'pve') {
      return {
        tone: 'result',
        label: winner === humanColor ? '对方认输，你赢了' : '你认输了',
        player: winner,
      }
    }
    return {
      tone: 'result',
      label: `${COLOR_NAMES[opponentOf(winner)]}认输，${COLOR_NAMES[winner]}获胜`,
      player: winner,
    }
  }

  if (game.status === 'draw') {
    return { tone: 'result', label: '和棋', player: null }
  }

  return null
}

export function describeStatus(input: StatusInput): GameStatusDescriptor {
  const result = describeResult(input)
  if (result !== null) return result

  const { game, mode, humanColor, aiThinking } = input

  if (mode === 'pve') {
    if (game.current === humanColor) {
      return { tone: 'playing', label: '轮到你落子', player: humanColor }
    }
    return {
      tone: 'thinking',
      label: aiThinking ? 'AI 思考中…' : '轮到 AI',
      player: game.current,
    }
  }

  return { tone: 'playing', label: `轮到${COLOR_NAMES[game.current]}`, player: game.current }
}
