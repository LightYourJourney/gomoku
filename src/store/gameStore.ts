import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { buildBranchGame } from '../core/branch'
import {
  applyMove,
  createGame,
  moverAt,
  replay,
  resign as resignGame,
  resignerOf,
  undo,
  withResignation,
  type GameState,
} from '../core/game'
import { BLACK, type GameMode, type Player, type Point } from '../core/types'
import type { AiEngine } from '../ai/engine'
import { HINT_BUDGET_MS } from '../ai/difficulty'
import type {
  AiInfo,
  Confidence,
  Difficulty,
  MoveSuggestion,
  SearchResponse,
  Urgency,
} from '../ai/types'
import type { GameRecord } from '../persist/gameRecords'
import { recordContentKey, type RecordIdentity } from '../persist/recordIdentity'
import type { PersistedSession } from '../persist/storage'
import type { RecordSaveState } from '../lib/record-save'
import { nextRequestId } from './requestCounter'
import { AI_RESPONSE_TIMEOUT_MS, TIMEOUT_MESSAGE } from './searchDeadline'
import { createRecordNotifier, type GameEndCallback } from './recordNotifier'

/** 一次探索分支的来源。只保存回指所需的最小元数据，不复制原棋谱。 */
export interface BranchOrigin {
  readonly sourceSeq: number
  /** 来源棋谱的规范化内容身份；原棋谱被删除后仍可用于说明来源。 */
  readonly sourceContentKey: string
  /** 分支起点：原棋谱已显示的落子数。 */
  readonly cursor: number
  readonly sourceMoves: number
}

export interface BranchConfig {
  readonly mode: GameMode
  readonly humanColor: Player
  readonly difficulty: Difficulty
}

export interface BranchStartInput extends BranchConfig {
  readonly source: GameRecord
  readonly cursor: number
}

export type BranchStartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

export interface GameStore {
  readonly game: GameState
  readonly mode: GameMode
  /** 人机模式下玩家执哪一方 */
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly aiThinking: boolean
  readonly aiError: string | null
  /** 启动时旧存档迁移失败的具体原因；null 表示没有失败。 */
  readonly sessionError: string | null
  /**
   * 自动存档写不进 localStorage（配额满、隐私模式、被策略禁用）。
   * 与 `sessionError`（读失败）分开：一个说「上次没接回来」，一个说「这次存不下」。
   */
  readonly sessionSaveFailed: boolean
  readonly aiInfo: AiInfo | null
  /** 当前对局是否来自棋谱探索分支；null = 普通对局。 */
  readonly branch: BranchOrigin | null
  /** 当前在飞的 AI 请求；null 表示没有。用于作废过期响应。 */
  readonly pendingRequestId: number | null

  /**
   * AI 提示。
   *
   * 与落子请求走同一条引擎、同一套过期校验，但**提示响应只写这里，绝不落子**。
   * 局面一变（落子 / 悔棋 / 重开 / 认输）就清空——高亮必须跟着局面失效。
   */
  readonly hint: readonly MoveSuggestion[] | null
  readonly hintUrgency: Urgency | null
  /**
   * 这份提示是怎么来的（引擎给的那一类，原样记下）。
   *
   * 提示固定用 800 ms 的短预算，档位越高越可能搜不满。界面必须如实区分
   * 「搜完了若干层」与「一层都没搜完」——前者不是猜测，后者才要警示。
   */
  readonly hintConfidence: Confidence | null
  readonly hintThinking: boolean
  readonly hintError: string | null
  readonly pendingHintRequestId: number | null

  /**
   * 这一局的棋谱有没有存上。
   *
   * 界面据此如实显示「已存入棋谱库」或「没能保存这局」——**不许假装成功**：
   * 隐私模式、配额满都会让写入失败，玩家有权知道这局丢了。
   */
  readonly recordSaveState: RecordSaveState
  /** 这一局的棋谱存成了哪一条（seq）；null = 还没存或没存上。 */
  readonly recordedSeq: number | null

  newGame(options?: { mode?: GameMode; humanColor?: Player; difficulty?: Difficulty }): void
  /** 从棋谱前缀接管一局探索。校验失败时不修改当前对局。 */
  startBranch(input: BranchStartInput): BranchStartResult
  /**
   * 从本地存档恢复。传 null 表示没有存档，保持当前状态。
   *
   * `resumeAi: false` 用于分享预览：恢复局面只为让返回应用后状态一致，
   * 但**打开分享链接本身不能触发 AI 落子/入库，也不打开棋谱库**（恢复终局时
   * 不查「这局在不在库里」）。离开分享页时显式续走。
   */
  restore(
    session: PersistedSession | null,
    options?: { readonly resumeAi?: boolean },
  ): void
  setSessionError(message: string | null): void
  setSessionSaveFailed(failed: boolean): void
  /**
   * 中止在飞的 AI 落子（进入分享预览时）。旧响应由 requestId 闸门丢弃；
   * 离开分享页后由 `requestAiMove` 显式续走。
   */
  suspendAi(): void
  /** AI 失败后重试。不在 AI 回合时是空操作。 */
  retryAiMove(): void
  setMode(mode: GameMode): void
  setHumanColor(color: Player): void
  setDifficulty(difficulty: Difficulty): void
  playHuman(point: Point): void
  undoMove(): void
  resign(): void
  requestAiMove(): void
  applyAiResponse(response: SearchResponse): void
  dismissAiError(): void
  requestHint(): void
  applyHintResponse(response: SearchResponse): void
  clearHint(): void
}

/** 局面一变就要把提示整体清掉。 */
const HINT_CLEARED = {
  hint: null,
  hintUrgency: null,
  hintConfidence: null,
  hintThinking: false,
  hintError: null,
  pendingHintRequestId: null,
} as const

/** 开新局、分支接管、恢复存档都要清掉的临时状态。 */
const TRANSIENT_RESET = {
  aiThinking: false,
  aiError: null,
  sessionError: null,
  aiInfo: null,
  pendingRequestId: null,
  ...HINT_CLEARED,
} as const

/**
 * 悔一手应当撤销几手。
 *
 * 人机模式下，悔棋的意图是「收回我刚才那一手」：AI 已经应过手就连它一起撤，
 * 这样主动权才回到玩家手里；AI 还没应手就只撤自己那一手。
 */
export function undoPlies(state: Pick<GameStore, 'game' | 'mode' | 'humanColor'>): number {
  const { game, mode, humanColor } = state
  if (game.moves.length === 0) return 0

  if (mode === 'pvp') return 1

  const lastMover = moverAt(game.moves.length - 1, game.firstPlayer)
  return lastMover === humanColor ? 1 : Math.min(2, game.moves.length)
}

/**
 * 玩家此刻能不能落子。
 *
 * store 的 playHuman 与棋盘的可交互状态都必须用它，不要各写一遍——
 * 这是一条安全相关的判断，散成多处迟早会不一致。
 */
export function canHumanPlay(
  state: Pick<GameStore, 'game' | 'mode' | 'humanColor' | 'aiThinking'>,
): boolean {
  if (state.game.status !== 'playing') return false
  if (state.mode === 'pvp') return true

  return !state.aiThinking && state.game.current === state.humanColor
}

/**
 * 这一局是谁在认输。
 *
 * 人机模式下「认输」是**玩家**认输——即使此刻轮到 AI 走，认的也是玩家自己。
 * 本地双人没有「玩家」这一方：按钮是轮到谁走时谁点的，所以认的是 `game.current`。
 * 这里曾经一律用 `humanColor`，而它在双人模式下既不可见也不可改，是上一次人机模式
 * 留下的残留值——结果是「点认输，屏幕上刚在下棋的那个人被判赢了」。
 *
 * **导出是因为确认弹窗要算「认输之后谁获胜」**：它得说清后果，而后果必须与这里
 * 判的是同一个人。UI 侧自己再推一遍（比如用 `game.current`）就是第二套判据——
 * Phase 02 的验收自审里正是这么错的：轮到 AI 时弹窗写成「记为你获胜」，
 * 而按下去实际发生的是「你认输了」。**同一件事只有这一个出处。**
 */
export function resignerFor(
  state: Pick<GameStore, 'mode' | 'humanColor' | 'game'>,
): Player {
  return state.mode === 'pve' ? state.humanColor : state.game.current
}

export function canUndo(state: Pick<GameStore, 'game' | 'mode' | 'humanColor'>): boolean {
  const plies = undoPlies(state)
  if (plies === 0) return false
  if (state.mode === 'pvp') return true

  // 撤销之后必须轮回玩家，否则这一手本来就没什么可悔的
  //（例如玩家执白、盘上只有 AI 的开局子）。
  const remaining = state.game.moves.length - plies
  return moverAt(remaining, state.game.firstPlayer) === state.humanColor
}

/**
 * 人机模式下是否轮到 AI 走。
 *
 * 与 `canHumanPlay` 互补，界面判断「AI 是不是卡住了」也必须用它，
 * 不要另写一份——这条谓词一旦分叉，两边对「该谁走」的理解就会不一致。
 */
export function shouldAiMove(
  state: Pick<GameStore, 'game' | 'mode' | 'humanColor'>,
): boolean {
  return (
    state.mode === 'pve' &&
    state.game.status === 'playing' &&
    state.game.current !== state.humanColor
  )
}

export interface GameStoreOptions {
  /**
   * 对局**从进行中变成终局**时回调一次（五连 / 和棋 / 认输）。
   *
   * `newGame` 与 `restore` 不触发——重开一局、刷新恢复都不是「结束了一局」，
   * 触发的话同一局会被重复入库。
   */
  readonly onGameEnd?: GameEndCallback
  /**
   * 「这局在不在棋谱库」的查询，供恢复一局**已经结束**的存档时说明状态。
   *
   * 返回 `null` 表示查不了（存储降级/不可用）——那时保持 `idle`，不猜。
   * 恢复本身不会入库，所以答案只可能是「在」或「不在」。
   */
  readonly findSavedGame?: (input: RecordIdentity) => Promise<boolean | null>
}

export function createGameStore(
  engine: AiEngine,
  options: GameStoreOptions = {},
): UseBoundStore<StoreApi<GameStore>> {
  // `restore` 也有一个叫 `options` 的参数（resumeAi），别让两者互相遮蔽。
  const deps = options
  const store = create<GameStore>()((set, get) => {
    const notifier = createRecordNotifier(options.onGameEnd, set)
    const notifyGameEnd = notifier.notifyGameEnd

    return {
      game: createGame(),
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
      aiThinking: false,
      aiError: null,
      sessionError: null,
      sessionSaveFailed: false,
      aiInfo: null,
      branch: null,
      pendingRequestId: null,
      recordSaveState: 'idle',
      recordedSeq: null,
      ...HINT_CLEARED,

      newGame(options = {}) {
        const current = get()
        notifier.reset()
        set({
          game: createGame(),
          mode: options.mode ?? current.mode,
          humanColor: options.humanColor ?? current.humanColor,
          difficulty: options.difficulty ?? current.difficulty,
          branch: null,
          recordSaveState: 'idle',
          recordedSeq: null,
          ...TRANSIENT_RESET,
        })

        get().requestAiMove()
      },

      startBranch(input) {
        const built = buildBranchGame(
          { moves: input.source.moves, firstPlayer: input.source.firstPlayer },
          input.cursor,
        )
        if (!built.ok) return built

        const { source } = input
        notifier.reset()
        set({
          game: built.game,
          mode: input.mode,
          humanColor: input.humanColor,
          difficulty: input.difficulty,
          branch: {
            sourceSeq: source.seq,
            sourceContentKey: recordContentKey(source),
            cursor: input.cursor,
            sourceMoves: source.moves.length,
          },
          recordSaveState: 'idle',
          recordedSeq: null,
          ...TRANSIENT_RESET,
        })

        // 若玩家执白且分支起点轮到黑棋，进入对战后 AI 必须立刻接上。
        get().requestAiMove()
        return { ok: true }
      },

      restore(session, options = {}) {
        if (session === null) return

        // replay 会忽略非法手顺，因此损坏的存档最坏也只是退回若干手，不会崩。
        // 胜负与和棋都能从手顺还原，认输不能——所以它单独存、单独补。
        const replayed = replay(session.moves, session.firstPlayer)

        // 存档里没有「这一局入库了没有」的信息，所以恢复之后当作没存过。
        // 后果：终局 → 刷新 → 悔棋 → 换个走法再终局，棋谱库里会多一条
        // （老的那条手顺不同，内容匹配对不上）。**这是有意的**——要修就得把
        // seq 也持久化进存档（`PersistedSession`）并升 schema 版本，
        // 那会让所有存档作废，代价比一条重复棋谱大。见 FINDINGS 的 F-25。
        //
        // 入库链接由下一行的 `notifier.reset()` 切断（清 `lastSeq`、自增局号）。
        // 但两个**展示用**字段不在 `TRANSIENT_RESET` 里：不清的话，恢复出的
        // 终局会沿用上一局的「已存入」状态。
        notifier.reset()
        set({
          game: withResignation(replayed, session.resignedBy),
          mode: session.mode,
          humanColor: session.humanColor,
          difficulty: session.difficulty,
          branch: session.branch ?? null,
          recordSaveState: 'idle',
          recordedSeq: null,
          ...TRANSIENT_RESET,
        })

        /*
         * 恢复出的终局要能回答「这局在不在棋谱库」。恢复本身不入库，所以不能在
         * `idle` 上撒谎说「已存入」，也不能什么都不说——按内容身份查一次库即可。
         * 只在状态没变（用户没在这期间开新局/落子）时写回；查不了就保持 idle。
         */
        const restored = get()
        // 分享预览通道（`resumeAi: false`）同样不查：查库要打开 IndexedDB（库不存在时
        // 会新建，`list()` 还会补写内存兜底的记录），而预览阶段承诺不碰任何写入 API
        // （`docs/sharing/SECURITY_MODEL.md` §3）。这时保持 idle——「查不了就不说」。
        const preview = options.resumeAi === false
        if (restored.game.status !== 'playing' && !preview && deps.findSavedGame !== undefined) {
          // 用对局对象本身做配对，不用 version：version 等于手数，0 手认输局与刚开的
          // 新局 version 都是 0。对局状态不可变，任何开新局/落子/悔棋都换一个新对象。
          const restoredGame = restored.game
          void deps
            .findSavedGame({
              moves: restored.game.moves,
              firstPlayer: restored.game.firstPlayer,
              mode: restored.mode,
              humanColor: restored.humanColor,
              difficulty: restored.difficulty,
              resignedBy: resignerOf(restored.game),
            })
            .then((found) => {
              const now = get()
              if (found === null || now.game !== restoredGame || now.recordSaveState !== 'idle') return
              set({ recordSaveState: found ? 'saved' : 'absent' })
            })
            .catch(() => {})
        }

        // 存档时若正轮到 AI（刷新页面时它还在思考），恢复后要接着把这局走完。
        // 分享预览关掉这道续走：打开链接不得改变本地对局。
        if (options.resumeAi !== false) get().requestAiMove()
      },

      setMode(mode) {
        get().newGame({ mode })
      },

      setHumanColor(humanColor) {
        get().newGame({ humanColor })
      },

      setDifficulty(difficulty) {
        set({ difficulty })
      },

      playHuman(point) {
        const current = get()
        if (!canHumanPlay(current)) return

        const outcome = applyMove(current.game, point)
        if (!outcome.ok) return

        // 提示是按旧局面算的，落子之后就不再适用了。
        set({ game: outcome.state, aiError: null, ...HINT_CLEARED })
        notifyGameEnd(current, outcome.state)
        get().requestAiMove()
      },

      undoMove() {
        const current = get()
        // 与按钮的禁用条件共用同一条判据：人机执白、盘上只有 AI 开局子时，
        // 直调也要拒绝，不能撤掉 AI 那一手再让它重想。
        if (!canUndo(current)) return
        const plies = undoPlies(current)
        if (plies === 0) return

        set({
          game: undo(current.game, plies),
          aiThinking: false,
          aiError: null,
          aiInfo: null,
          pendingRequestId: null,
          ...HINT_CLEARED,
        })

        get().requestAiMove()
      },

      resign() {
        const current = get()
        if (current.game.status !== 'playing') return

        const resigned = resignGame(current.game, resignerFor(current))
        set({
          game: resigned,
          aiThinking: false,
          aiInfo: null,
          pendingRequestId: null,
          ...HINT_CLEARED,
        })
        notifyGameEnd(current, resigned)
      },

      requestAiMove() {
        const current = get()
        if (!shouldAiMove(current) || current.aiThinking) return

        const requestId = nextRequestId()
        const { game } = current

        set({ aiThinking: true, aiError: null, pendingRequestId: requestId })

        /*
         * 兜底超时：正常路径一定会结算（响应或错误）。
         * 但 Worker 若静默死亡（脚本加载失败后不再发任何事件、或内部死循环），
         * 这个 Promise 永远不结算，界面就会一直停在「AI 思考中」——不是崩溃，
         * 却和卡死没有区别。预算最大 2600ms，15 秒足够覆盖最慢的机器。
         * 超时把请求号置空，订阅随即取消那个请求；万一旧响应仍到达，也会被
         * `requestId` 闸门丢弃，不会迟到一个落子。
         */
        const timer = setTimeout(() => {
          if (get().pendingRequestId !== requestId) return
          set({
            aiThinking: false,
            pendingRequestId: null,
            aiError: TIMEOUT_MESSAGE,
          })
        }, AI_RESPONSE_TIMEOUT_MS)

        void engine
          .search({
            requestId,
            gameVersion: game.version,
            board: game.board,
            player: game.current,
            difficulty: current.difficulty,
            purpose: 'play',
          })
          .then(
            (response) => {
              clearTimeout(timer)
              get().applyAiResponse(response)
            },
            (error: unknown) => {
              clearTimeout(timer)
              // 已经被取代的旧请求失败了也无所谓，不要拿它去打断当前对局。
              if (get().pendingRequestId !== requestId) return
              set({
                aiThinking: false,
                pendingRequestId: null,
                aiError: error instanceof Error ? error.message : String(error),
              })
            },
          )
      },

      setSessionError(message) {
        set({ sessionError: message })
      },

      setSessionSaveFailed(failed) {
        // 只在状态翻转时写一次：这个 action 由存档订阅回调调用，而写状态本身
        // 又会触发订阅——不加闸门就是每次落子都多建一个数组、多一次渲染。
        if (get().sessionSaveFailed !== failed) set({ sessionSaveFailed: failed })
      },

      suspendAi() {
        set({ aiThinking: false, aiError: null, pendingRequestId: null })
      },

      retryAiMove() {
        // 失败已经把 aiThinking 复位了；这里只需清掉错误再走一次正常流程。
        // requestAiMove 自己会判断该不该走，因此不在 AI 回合时这里是空操作。
        set({ aiError: null })
        get().requestAiMove()
      },

      applyAiResponse(response) {
        const current = get()

        // 两道闸门：请求号必须是当前在飞的那一个，棋局版本必须与请求发出时一致。
        if (response.requestId !== current.pendingRequestId) return
        if (response.gameVersion !== current.game.version) {
          set({ aiThinking: false, pendingRequestId: null })
          return
        }

        if (response.move === null) {
          set({ aiThinking: false, pendingRequestId: null })
          return
        }

        const outcome = applyMove(current.game, response.move)
        if (!outcome.ok) {
          set({
            aiThinking: false,
            pendingRequestId: null,
            aiError: 'AI 返回了不合法的着法，已忽略',
          })
          return
        }

        set({
          game: outcome.state,
          aiThinking: false,
          pendingRequestId: null,
          aiInfo: {
            depth: response.depth,
            nodes: response.nodes,
            elapsedMs: response.elapsedMs,
            score: response.score,
            confidence: response.confidence,
            reason: response.reason,
            move: response.move,
          },
        })
        notifyGameEnd(current, outcome.state)
      },

      dismissAiError() {
        set({ aiError: null })
      },

      requestHint() {
        const current = get()
        // 提示是给**玩家**看的，所以要过和落子完全一样的门槛——共用 canHumanPlay，
        // 不要在这里另写一套。少判「当前手番是不是人类」就会在 AI 报错卡住时
        // （aiThinking 已复位、手番仍是 AI）以 AI 的视角发出提示请求。
        if (!canHumanPlay(current)) return
        if (current.hintThinking) return

        const requestId = nextRequestId()
        const { game } = current

        set({ hintThinking: true, hintError: null, pendingHintRequestId: requestId })

        // 与落子请求同一条兜底（理由见 `requestAiMove`）：Worker 静默死亡时，
        // 不复位的话「求提示」会一直停在思考中，而思考中又拒绝再求。
        const timer = setTimeout(() => {
          if (get().pendingHintRequestId !== requestId) return
          set({
            hintThinking: false,
            pendingHintRequestId: null,
            hintError: TIMEOUT_MESSAGE,
          })
        }, AI_RESPONSE_TIMEOUT_MS)

        void engine
          .search({
            requestId,
            gameVersion: game.version,
            board: game.board,
            player: game.current,
            difficulty: current.difficulty,
            budgetMs: HINT_BUDGET_MS,
            purpose: 'hint',
          })
          .then(
            (response) => {
              clearTimeout(timer)
              get().applyHintResponse(response)
            },
            (error: unknown) => {
              clearTimeout(timer)
              if (get().pendingHintRequestId !== requestId) return
              set({
                hintThinking: false,
                pendingHintRequestId: null,
                hintError: error instanceof Error ? error.message : String(error),
              })
            },
          )
      },

      applyHintResponse(response) {
        const current = get()

        if (response.requestId !== current.pendingHintRequestId) return
        if (response.gameVersion !== current.game.version) {
          set({ hintThinking: false, pendingHintRequestId: null })
          return
        }

        // 只写提示状态。这里**没有** applyMove，提示永远不改变棋局。
        set({
          hint: response.candidates,
          hintUrgency: response.urgency,
          hintConfidence: response.confidence,
          hintThinking: false,
          pendingHintRequestId: null,
          hintError: null,
        })
      },

      clearHint() {
        set(HINT_CLEARED)
      },
    }
  })

  /*
   * 放弃的请求一律取消，Worker 不再白算。作废路径有十来条（悔棋、新局、认输、恢复、
   * 挂起 AI、换模式、落子清提示、超时……），它们的共同点是把请求号从某个 id 改走——
   * 所以只在这一处订阅，不在每条路径上手写。订阅在 `set` 之后同步触发，此时状态已经
   * 不认那个请求了，被取消的 Promise 的拒绝分支一定被各自的闸门挡下。
   * 正常结算时请求号也会变走：那时引擎的待决表里已经没有它，`cancel` 是空操作。
   */
  store.subscribe((state, previous) => {
    if (previous.pendingRequestId !== null && state.pendingRequestId !== previous.pendingRequestId) {
      engine.cancel(previous.pendingRequestId)
    }
    if (
      previous.pendingHintRequestId !== null &&
      state.pendingHintRequestId !== previous.pendingHintRequestId
    ) {
      engine.cancel(previous.pendingHintRequestId)
    }
  })
  return store
}
