import { createBrowserAiEngine } from '../ai/browserEngine'
import { resignerOf, type GameState } from '../core/game'
import type { Difficulty } from '../ai/types'
import type { Player } from '../core/types'
import { indexedDbGameRecords, saveGameReplacing } from '../persist/gameRecords'
import { recordContentKey } from '../persist/recordIdentity'
import { loadSessionResult, saveSession } from '../persist/storage'
import { createGameStore, type BranchOrigin, type GameMode } from './gameStore'

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
  // 替换语义（同一局只留一条）与「先写后删」的顺序都在 saveGameReplacing 里。
  onGameEnd: async (input) => {
    const { record, persisted } = await saveGameReplacing(input, input.replacesSeq, {
      allowContentMatch: input.branchSourceSeq === null,
    })
    // 没真正落库（隐私模式退了内存兜底）→ 抛错，让界面如实说「没能保存这局」，
    // 而不是显示「已存入」然后刷新就没了。
    if (!persisted) throw new Error('没能写入棋谱库')
    return record.seq
  },
  // 恢复一局已结束的存档时回答「这局在不在库里」；存储降级时返回 null，不猜。
  findSavedGame: async (input) => {
    const { records, degraded } = await indexedDbGameRecords.list()
    if (degraded) return null
    const key = recordContentKey(input)
    return records.some((record) => recordContentKey(record) === key)
  },
})

/**
 * 上一次真正落盘的存档载荷。
 *
 * `subscribe` 没有 selector，任何 state 变化（`aiThinking`、`aiHint`、
 * `recordSaveState`、`aiInfo`…）都会把回调跑一遍。落子一手会连着触发好几次，
 * 每次都 `JSON.stringify` 整条手顺并**同步**写 localStorage。
 *
 * 存档里只有这四项，所以只在它们**真的**变了的时候才写——`game` 是不可变的，
 * 引用比较就够。这既省掉了多余序列化，也省掉了 localStorage 的同步写。
 */
type SessionSnapshot = {
  game: GameState
  mode: GameMode
  humanColor: Player
  difficulty: Difficulty
  branch: BranchOrigin | null
}

let lastSaved: SessionSnapshot | null = null

function snapshotOf(state: SessionSnapshot): SessionSnapshot {
  return {
    game: state.game,
    mode: state.mode,
    humanColor: state.humanColor,
    difficulty: state.difficulty,
    branch: state.branch,
  }
}

function persistSession(state: SessionSnapshot): void {
  const { game, mode, humanColor, difficulty, branch } = state

  if (
    lastSaved !== null &&
    lastSaved.game === game &&
    lastSaved.mode === mode &&
    lastSaved.humanColor === humanColor &&
    lastSaved.difficulty === difficulty &&
    lastSaved.branch === branch
  ) {
    return
  }
  lastSaved = snapshotOf(state)

  // 写失败必须能被看见：存储满/被禁用时不提示，用户会以为刷新后还在。
  const saved = saveSession({
    moves: game.moves,
    firstPlayer: game.firstPlayer,
    mode,
    humanColor,
    difficulty,
    resignedBy: resignerOf(game),
    branch,
  })
  useGameStore.getState().setSessionSaveFailed(!saved)
}

/**
 * 应用启动时调用一次。
 *
 * 恢复上次对局要赶在 React 挂载之前：刷新时如果正轮到 AI，恢复动作会立刻发起新的
 * 搜索，界面一挂载就能显示「AI 思考中」，而不是先闪一下空盘再补上。
 *
 * `resumeAi: false` 是分享预览通道：恢复局面（返回应用后状态一致），但不让
 * 打开链接这个动作替用户落子。离开分享页时 `App` 再显式续走。
 */
export function bootstrapStore(options: { readonly resumeAi?: boolean } = {}): void {
  const loaded = loadSessionResult()
  useGameStore.getState().restore(loaded.session, { resumeAi: options.resumeAi })
  if (loaded.error !== null) useGameStore.getState().setSessionError(loaded.error)

  // 先把“已经落盘/恢复”的快照记下来：此后只有存档字段真的变化才写。
  // 否则启动后的第一次无关状态变化（例如进入分享页的 suspendAi）也会写一次
  // localStorage，违背“预览阶段不调用写入 API”。
  lastSaved = snapshotOf(useGameStore.getState())

  useGameStore.subscribe(persistSession)
}
