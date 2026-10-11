import { createBrowserAiEngine } from '../ai/browserEngine'
import { opponentOf } from '../core/board'
import { indexedDbGameRecords } from '../persist/gameRecords'
import { loadSession, saveSession } from '../persist/storage'
import { createGameStore } from './gameStore'

/**
 * 应用唯一的 AI 引擎实例。
 *
 * 导出它，供复盘页的分析管线复用**同一个 Worker**——分析与对局靠
 * `nextRequestId()` 的全局唯一号区分（见 `requestCounter.ts`），
 * 与「提示和落子共用引擎」是同一条设计。分析请求有 400ms 上限，
 * 不会长时间占住 Worker。
 */
export const appEngine = createBrowserAiEngine()

export const useGameStore = createGameStore(appEngine, {
  // 终局自动入库。返回 promise 让 store 能把「存上了 / 没存上」如实反映到界面。
  //
  // 终局后悔棋再终局时 `replacesSeq` 指向上次存的那条：先删旧再写新，
  // 同一局在棋谱库里始终只有一条。返回值是新的 seq，供下一次替换。
  onGameEnd: async (input) => {
    if (input.replacesSeq !== null) {
      await indexedDbGameRecords.delete(input.replacesSeq)
    }
    const { record, persisted } = await indexedDbGameRecords.put(input)
    // 没真正落库（隐私模式退了内存兜底）→ 抛错，让界面如实说「没能保存这局」，
    // 而不是显示「已存入」然后刷新就没了。
    if (!persisted) throw new Error('没能写入棋谱库')
    return record.seq
  },
})

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
