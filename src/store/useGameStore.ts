import { createBrowserAiEngine } from '../ai/browserEngine'
import { opponentOf } from '../core/board'
import { loadSession, saveSession } from '../persist/storage'
import { createGameStore } from './gameStore'

export const useGameStore = createGameStore(createBrowserAiEngine())

/**
 * 应用启动时调用一次。
 *
 * 恢复上次对局要赶在 React 挂载之前：刷新时如果正轮到 AI，恢复动作会立刻发起新的
 * 搜索，界面一挂载就能显示「AI 思考中」，而不是先闪一下空盘再补上。
 */
export function bootstrapStore(): void {
  useGameStore.getState().restore(loadSession())

  useGameStore.subscribe((state) => {
    const { game } = state

    saveSession({
      moves: game.moves,
      firstPlayer: game.firstPlayer,
      mode: state.mode,
      humanColor: state.humanColor,
      difficulty: state.difficulty,
      // 手顺能还原出胜负与和棋，唯独还原不出认输，所以由 winner 反推认输方。
      resignedBy:
        game.status === 'resigned' && game.winner !== null ? opponentOf(game.winner) : null,
    })
  })
}
