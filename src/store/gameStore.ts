import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { opponentOf } from '../core/board'
import {
  applyMove,
  createGame,
  replay,
  resign as resignGame,
  resignerOf,
  undo,
  type GameState,
} from '../core/game'
import { BLACK, type Player, type Point } from '../core/types'
import type { AiEngine } from '../ai/engine'
import type {
  Confidence,
  Difficulty,
  MoveSuggestion,
  SearchReason,
  SearchResponse,
  Urgency,
} from '../ai/types'
import type { PersistedSession } from '../persist/storage'
import { nextRequestId } from './requestCounter'

export type GameMode = 'pve' | 'pvp'

export interface AiInfo {
  readonly depth: number
  readonly nodes: number
  readonly elapsedMs: number
  readonly score: number
  readonly confidence: Confidence
  readonly reason: SearchReason
  /**
   * AI 落在哪。默认层要把它写成「落点 H8」——
   * 任务书 §七 给玩家视图举的例就是「推荐落点：H8」。
   *
   * **类型是 `Point`，不是 `Point | null`**：引擎确实会在 `no_move`（棋盘已满）时
   * 返回 `move: null`，但 `requestAiMove` 在**写 `aiInfo` 之前**就把这一档挡掉了
   * （`aiThinking` 归零后直接返回，整个 `aiInfo` 保持原样）。所以这里永远拿得到坐标，
   * 面板不必编一个、也不必防一个不会发生的 null。钉住这条不变量的用例在
   * `gameStore.test.ts` 的「引擎给出 move: null……不写 aiInfo」——闸门一旦被删，
   * 那里会红，而不是等到界面上多出一个假坐标。
   *
   * **为什么存一份快照、而不是让面板去读 `game.lastMove`**：两者**会分叉**——
   * `playHuman` 不清 `aiInfo`，所以玩家一落子，`game.lastMove` 就是玩家那一手，
   * 而这份分析说的仍是 AI 的那一手；照着 `lastMove` 渲染，面板会给 AI 的分析
   * 贴上玩家的坐标。AI 欠着一手、玩家刚悔棋之类的时刻也一样。
   * 一个字段换掉这层耦合，值这个价。
   */
  readonly move: Point
}

export interface GameStore {
  readonly game: GameState
  readonly mode: GameMode
  /** 人机模式下玩家执哪一方 */
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly aiThinking: boolean
  readonly aiError: string | null
  readonly aiInfo: AiInfo | null
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
   * 这份提示有多可信。
   *
   * 提示固定用 800 ms 的短预算，档位越高越可能搜不完而回退到启发式。
   * 界面必须如实区分——把「没搜完的猜测」说成「精确结论」就是在骗玩家。
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
  /** 从本地存档恢复。传 null 表示没有存档，保持当前状态。 */
  restore(session: PersistedSession | null): void
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

/**
 * 提示能用的时间预算。
 *
 * 比正式走子短得多：玩家求提示是在等一个建议，不是在等一场深算。
 * 它同样只读，不会挤占落子请求的预算。
 */
export const HINT_BUDGET_MS = 800

/** 终局入库的进度，供对局结束时的界面显示。 */
export type RecordSaveState = 'idle' | 'saving' | 'saved' | 'failed'

/** 局面一变就要把提示整体清掉。 */
const HINT_CLEARED = {
  hint: null,
  hintUrgency: null,
  hintConfidence: null,
  hintThinking: false,
  hintError: null,
  pendingHintRequestId: null,
} as const

/** 第 index 手（0-based）由谁落子。 */
export function moverAt(index: number, firstPlayer: Player): Player {
  return index % 2 === 0 ? firstPlayer : opponentOf(firstPlayer)
}

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

/**
 * 一局结束时交给外部的信息。形状即棋谱库的入库输入（不含 `winner`——
 * 它由存储层用 `replay` 推导，不信任调用方）。
 */
export interface GameEndInput {
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  readonly mode: GameMode
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly resignedBy: Player | null
  /**
   * 这一条要替换掉的棋谱 seq，`null` 表示新的一条。
   *
   * 终局悔棋是既有行为（回到进行中、可以接着下）。同一局因此可能终局两次，
   * 第二次带着上一次存下的 seq——存储层据此替换，而不是留下两条同一局。
   */
  readonly replacesSeq: number | null
}

export interface GameStoreOptions {
  /**
   * 对局**从进行中变成终局**时回调一次（五连 / 和棋 / 认输）。
   *
   * `newGame` 与 `restore` 不触发——重开一局、刷新恢复都不是「结束了一局」，
   * 触发的话同一局会被重复入库。
   */
  readonly onGameEnd?: (input: GameEndInput) => void | Promise<number | void>
}

export function createGameStore(
  engine: AiEngine,
  options: GameStoreOptions = {},
): UseBoundStore<StoreApi<GameStore>> {
  /**
   * 只在「进行中 → 终局」这一跃迁上回调。落子路径有三条（玩家、AI、认输），
   * 都汇到这里判定，避免各处各写一遍「是不是刚结束」。
   *
   * **入库是串行的，而且要带着配对链接。** 原来的写法从 `before.recordedSeq`
   * 取「这一局上次存成的 seq」，而那个字段要等 promise 兑现才写——于是
   * 「终局 → 悔棋 → 再终局」如果发生在上一次写入还没回来的时候，第二次拿到的
   * `replacesSeq` 是 `null`，存储层的内容匹配又对不上（手顺不同），
   * 同一局在棋谱库里留下两条。
   *
   * 现在改成：把写入排成一条链，`replacesSeq` 在**轮到它执行时**才读
   * （`lastSeq` 那时已经是上一次的结果），并且配一道只增不减的闸门，
   * 保证迟到的结果不会把新的状态覆盖回去。这与 `analysisStore` 的 `runId` 同一手法。
   */
  function makeNotifier(set: (partial: Partial<GameStore>) => void) {
    /** 上一次成功入库的 seq。`null` 表示这一局还没存过。 */
    let lastSeq: number | null = null
    /** 还没跑完的入库次数。0 表示队列空闲。 */
    let pending = 0
    /** 入库链的尾巴。 */
    let tail: Promise<void> = Promise.resolve()
    /**
     * 现在是第几局。`reset()` 时自增——这就是上面说的那道闸门。
     *
     * 少了它，`reset()` 只是把 `lastSeq` 置空，**在飞的那次写入并不知情**：
     * 「终局 → 立刻重开」时它兑现后照样写回，新局于是被标成「已存入」、
     * `recordedSeq` 拿到上一局的 seq；新局下完再把它当 `replacesSeq` 交出去，
     * 而存储层拿到它就**无条件删掉那一条**（`gameRecords.ts:188`）——
     * 上一局的棋谱直接没了，比原本要修的「多一条」更重。
     */
    let generation = 0

    async function runSave(build: () => GameEndInput, gen: number): Promise<void> {
      try {
        // `build()` 在**轮到它执行时**才求值——那时 `lastSeq` 已经是上一次的结果了。
        // 排队时就求值等于回到原来那个 bug（第二次终局拿到 null）。
        const result = options.onGameEnd?.(build())

        // **同步**返回 undefined（连 promise 都没返回）＝这个回调什么也没做。
        // `f9d8061` 之前的那版在这里直接 return、`recordSaveState` 保持 idle；
        // 这里把上面那句 `saving` 退回去，等效。注意与「promise 兑现为 undefined」
        // 区分开——后者是「存过了、只是没拿到 seq」，仍然算 saved（有测试钉着）。
        if (result === undefined) {
          if (gen !== generation) return
          set({ recordSaveState: 'idle' })
          return
        }

        const seq = await result

        // 这一局已经翻篇了（开了新局 / 恢复了存档）：**什么状态都不许写**。
        // `lastSeq` 尤其不能写——它现在属于新局。
        if (gen !== generation) return

        if (typeof seq === 'number') lastSeq = seq
        set({ recordSaveState: 'saved', recordedSeq: lastSeq })
      } catch {
        if (gen !== generation) return
        // 失败要如实说，而且**不动 `lastSeq`**——这一局还是没进库
        set({ recordSaveState: 'failed' })
      }
    }

    return {
      notifyGameEnd(before: GameStore, after: GameState): void {
        if (before.game.status !== 'playing' || after.status === 'playing') return
        // 没装配回调时什么状态都不该动（`recordSaveState` 保持 idle）
        if (options.onGameEnd === undefined) return

        const base = {
          moves: after.moves,
          firstPlayer: after.firstPlayer,
          mode: before.mode,
          humanColor: before.humanColor,
          difficulty: before.difficulty,
          resignedBy: resignerOf(after),
        }

        // 存储是异步的，界面需要知道最终成没成
        set({ recordSaveState: 'saving' })

        pending++
        // 局号在**发起时**记下，不在执行时读：排队期间可能已经开了新局，
        // 那时读到的会是新局号，这次写入就认不出自己已经过期了。
        const gen = generation
        const step = (): Promise<void> =>
          runSave(() => ({ ...base, replacesSeq: lastSeq }), gen).then(() => {
            pending--
          })

        if (pending === 1) {
          // 队列本来空着：**立刻跑**。`runSave` 是 async 函数，函数体会同步执行到
          // 第一个 await，所以 `onGameEnd` 仍然是同步被调用的——这是既有行为，
          // 有测试钉着，不该因为要排队就顺手改掉。
          tail = step()
          return
        }

        tail = tail.then(step)
      },

      /**
       * 开新局 / 恢复存档时调用：上一局的入库链接与这一局无关。
       *
       * 自增局号，让在飞的那次写入兑现时认得出「我已经不是当前这一局了」。
       * `pending` 与 `tail` **不动**：那几次写入本身还是要落库的（玩家确实把那一局
       * 下完了），只是不许再写回状态。
       */
      reset(): void {
        generation++
        lastSeq = null
      },
    }
  }

  return create<GameStore>()((set, get) => {
    const notifier = makeNotifier(set)
    const notifyGameEnd = notifier.notifyGameEnd

    return {
      game: createGame(),
      mode: 'pve',
      humanColor: BLACK,
      difficulty: 'easy',
      aiThinking: false,
      aiError: null,
      aiInfo: null,
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
          aiThinking: false,
          aiError: null,
          aiInfo: null,
          pendingRequestId: null,
          recordSaveState: 'idle',
          recordedSeq: null,
          ...HINT_CLEARED,
        })

        get().requestAiMove()
      },

      restore(session) {
        if (session === null) return

        // replay 会忽略非法手顺，因此损坏的存档最坏也只是退回若干手，不会崩。
        // 胜负与和棋都能从手顺还原，认输不能——所以它单独存、单独补。
        const replayed = replay(session.moves, session.firstPlayer)

        // 存档里没有「这一局入库了没有」的信息，所以恢复之后当作没存过。
        // 后果：终局 → 刷新 → 悔棋 → 换个走法再终局，棋谱库里会多一条
        // （老的那条手顺不同，内容匹配对不上）。**这是有意的**——要修就得把
        // seq 也持久化进存档（`PersistedSession`）并升 schema 版本，
        // 那会让所有存档作废，代价比一条重复棋谱大。见 FINDINGS 的 F-25。
        notifier.reset()
        set({
          game:
            session.resignedBy === null ? replayed : resignGame(replayed, session.resignedBy),
          mode: session.mode,
          humanColor: session.humanColor,
          difficulty: session.difficulty,
          aiThinking: false,
          aiError: null,
          aiInfo: null,
          pendingRequestId: null,
          ...HINT_CLEARED,
        })

        // 存档时若正轮到 AI（刷新页面时它还在思考），恢复后要接着把这局走完。
        get().requestAiMove()
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
            (response) => get().applyAiResponse(response),
            (error: unknown) => {
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
            (response) => get().applyHintResponse(response),
            (error: unknown) => {
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
}
