import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { opponentOf, samePoint } from '../core/board'
import type { Point } from '../core/types'
import type { AiEngine } from '../ai/engine'
import type { Difficulty, SearchReason, SearchResponse } from '../ai/types'
import { ENGINE_VERSION } from '../ai/version'
import type { GameRecord } from '../persist/gameRecords'
import { recordContentKey } from '../persist/recordIdentity'
import { applyMove, replay, type GameState } from '../core/game'
import { buildVerdict, cacheKey, type AfterMove, type MoveVerdict } from '../analysis/analyze'
import { nextRequestId } from './requestCounter'

/**
 * 单手分析的时间预算。
 *
 * 一局几十手、每手一到两个请求，串行跑：预算给太长整体就拖沓，给太短后续局面
 * 搜不满——那样的手不算分差（见 `analysis/analyze.ts` 的 `horizonLoss`）。
 * 400ms 在入门~中级档一般能搜满；高档位会有更多手落进「未算分差」。
 */
export const ANALYSIS_BUDGET_MS = 400

interface AnalysisTarget {
  readonly seq: number
  readonly difficulty: Difficulty
  readonly budgetMs: number
  readonly engineVersion: string
}

export interface AnalysisStore {
  readonly target: AnalysisTarget | null
  /** 已完成的单手结论，按 moveIndex。 */
  readonly verdicts: ReadonlyMap<number, MoveVerdict>
  /** 需要分析的总手数。 */
  readonly total: number
  readonly running: boolean
  readonly error: string | null

  start(input: { record: GameRecord; engine: AiEngine; difficulty: Difficulty; budgetMs: number }): void
  stop(): void
}

/**
 * 一个要发给引擎的请求。
 *
 * - `position`：局面 i（走了 i 手之后）。它的响应既是「第 i 手的引擎首选」，
 *   也是「第 i−1 手走完之后」的评分，相邻两手共享。
 * - `alternative`：第 i 手的**对照**——走完引擎首选之后的局面。只有着法与引擎
 *   首选不同的手才需要它；分差比的就是它与局面 i+1（同视界，见 `horizonLoss`）。
 */
type Job =
  | { readonly kind: 'position'; readonly index: number }
  | { readonly kind: 'alternative'; readonly index: number; readonly state: GameState }

/** 需要的应答都到齐后才能拼出结论。 */
interface PendingVerdict {
  readonly moveIndex: number
  readonly played: Point
  readonly playedIsWinning: boolean
  /** 局面 i 的响应（引擎首选）。 */
  position?: {
    move: Point
    depth: number
    nodes: number
    /** 引擎给出首选着法时走的路径，原样带进结论供界面分类。 */
    reason: SearchReason
    /**
     * 这一手要不要比「两种走法之后」的评分：着法与引擎首选不同、且不是终局手。
     * **只在局面响应到达时判一次**——排对照与等对照用的必须是同一个答案，
     * 两处各判各的，一旦不一致就是「排了没人等」或「等一个没排的」（后者会卡在「分析中」）。
     */
    compare: boolean
  }
  /** 走完实际着法之后：局面 i+1 的响应（对手视角；终局手与着法相同的手不需要）。 */
  reply?: AfterMove
  /**
   * 走完引擎首选之后（对手视角）。**四态，别把两个「没有」混成一个**：
   * `undefined` = 还没判定或请求还没回来（继续等）；`null` = 已判定不可比
   * （引擎首选落不下去）；`'ended'` = 引擎首选当场成五；其余是对照请求的响应。
   */
  alternative?: AfterMove | 'ended' | null
}

export function createAnalysisStore(): UseBoundStore<StoreApi<AnalysisStore>> {
  return create<AnalysisStore>()((set, get) => {
    /** 会话内缓存：cacheKey → 完整 verdict 列表。store 实例存活期间有效。 */
    const cache = new Map<string, readonly MoveVerdict[]>()

    let engine: AiEngine | null = null
    let record: GameRecord | null = null
    let difficulty: Difficulty = 'easy'
    let budgetMs = ANALYSIS_BUDGET_MS

    /** 待拼装的结论，按 moveIndex。 */
    const pending = new Map<number, PendingVerdict>()
    /** 等待发出的请求（局面号 0-based = moveIndex；终局手没有局面 N）。 */
    let queue: Job[] = []
    let inflight: Job | null = null
    /**
     * 本次分析的标识，每次 `start` 递增。
     *
     * 光比 `inflight` 不够：每个 run 的局面号都从 0 开始，上一局的
     * 迟到响应会被下一局当成自己的（局面号恰好相同），于是 B 的响应全被
     * 丢弃、分析永久卡死。响应必须连同 run 一起核对。
     */
    let runId = 0

    function reset() {
      pending.clear()
      queue = []
      inflight = null
      runId++ // 让所有在飞响应作废
    }

    /** 一个局面请求完成后：填入挂起结论、判定要不要对照、可能直接拼出 verdict。 */
    function onPositionResponse(index: number, response: SearchResponse) {
      // 无棋可走（满盘和棋的末局）：这一手没有「引擎首选」可比，拼不出结论。
      if (response.move === null) {
        pending.delete(index)
        // 上一手无法评估（没有「走完之后」的引擎判断）——直接跳过它，
        // 不给一个编出来的结论，总数也少一手，面板不会停在「N-1 / N」。
        if (pending.delete(index - 1)) {
          set({ total: Math.max(0, get().total - 1) })
        }
        return
      }

      // 这个局面是哪几手的「局面请求」？第 index 手（若 index < 总手数）。
      const entry = pending.get(index)

      if (entry !== undefined) {
        const compare = !entry.playedIsWinning && !samePoint(entry.played, response.move)
        entry.position = {
          move: response.move,
          depth: response.depth,
          nodes: response.nodes,
          reason: response.reason,
          compare,
        }
        if (compare) planAlternative(index, entry, response.move)
      }

      tryEmit(index)
      tryEmit(index - 1) // 局面 i 的响应同时是手 i-1 的 reply 半边——补上后重试拼装
    }

    /**
     * 着法与引擎首选不同：需要「走完引擎首选之后」的评分来比。
     *
     * 三种结局只有最后一种发请求：引擎首选落不下去（真实引擎不可达——那就没法比，
     * 不为它另开错误路径）；引擎首选当场成五（棋下完了，没有可搜的局面）；
     * 其余把对照**插到队首**，让结论按手序依次出来，进度不会最后才一起跳。
     */
    function planAlternative(index: number, entry: PendingVerdict, engineMove: Point) {
      const rec = record
      // 走到这里时 record 必然在（响应已过三道闸门）；万一不在，也按「没法比」记，
      // 不留一个永远等不到的 undefined。
      const outcome =
        rec === null ? null : applyMove(replay(rec.moves.slice(0, index), rec.firstPlayer), engineMove)
      if (outcome === null || !outcome.ok) {
        entry.alternative = null
      } else if (outcome.state.status === 'won') {
        entry.alternative = 'ended'
      } else {
        queue.unshift({ kind: 'alternative', index, state: outcome.state })
      }
    }

    /** 对照请求完成：记下评分。`move === null`（满盘）时 reason 是 `no_move`，自然不可比。 */
    function onAlternativeResponse(index: number, response: SearchResponse) {
      const entry = pending.get(index)
      if (entry === undefined) return

      entry.alternative = { score: response.score, reason: response.reason }
      tryEmit(index)
    }

    /**
     * 局面 i 也是「第 i-1 手的后续局面」：补上 reply 半边。
     *
     * `move === null`（满盘，无棋可走）时**不补**：这个局面没有引擎判断，
     * 那一手由 `onPositionResponse` 整个跳过。
     */
    function fillReply(index: number, response: SearchResponse) {
      if (response.move === null) return

      const prev = pending.get(index - 1)
      if (prev !== undefined && !prev.playedIsWinning) {
        prev.reply = { score: response.score, reason: response.reason }
      }
    }

    /** 需要的几半都齐了就 buildVerdict 并写入 verdicts。 */
    function tryEmit(index: number) {
      const entry = pending.get(index)
      if (entry === undefined) return

      const pos = entry.position
      if (pos === undefined) return

      // 终局手与着法相同的手不需要任何后续评分——局面响应一到就出结论。
      // 其余的要等两种走法之后的评分都就位（对照的「不可比」也算就位）。
      if (pos.compare && (entry.reply === undefined || entry.alternative === undefined)) return

      const verdict = buildVerdict({
        moveIndex: index,
        played: entry.played,
        engineMove: pos.move,
        isWinningMove: entry.playedIsWinning,
        afterPlayed: entry.reply ?? null,
        afterEngine: entry.alternative ?? null,
        reason: pos.reason,
        engineDepth: pos.depth,
        engineNodes: pos.nodes,
      })

      const verdicts = new Map(get().verdicts)
      verdicts.set(index, verdict)

      pending.delete(index)

      set({ verdicts })
    }

    /** 队列排空且没有再挂起的结论 → 写缓存、收尾。 */
    function finishIfDone() {
      const rec = record
      if (rec === null || !get().running) return
      if (queue.length > 0 || inflight !== null) return
      if (pending.size > 0) return

      cache.set(
        cacheKey(recordContentKey(rec), difficulty, budgetMs),
        [...get().verdicts.values()].sort((a, b) => a.moveIndex - b.moveIndex),
      )
      set({ running: false })
    }

    function pump() {
      const rec = record
      if (rec === null || engine === null) return
      if (inflight !== null) return

      const job = queue.shift()
      if (job === undefined) return
      inflight = job
      const run = runId
      const { index } = job

      // 分析不碰对局，但过期闸门照用：gameVersion 恒 0，配对走 moveIndex。
      void engine
        .search({
          requestId: nextRequestId(),
          gameVersion: 0,
          board: job.kind === 'position' ? boardAt(index) : job.state.board,
          player:
            job.kind === 'position'
              ? index % 2 === 0
                ? rec.firstPlayer
                : opponentOf(rec.firstPlayer)
              : job.state.current,
          difficulty,
          budgetMs,
          purpose: 'analyze',
          moveIndex: index,
        })
        .then(
          (response) => {
            // 三道闸门：属于当前这一次分析（run）、是当前在飞的那一个、
            // 响应自带的手序号与局面版本对得上。
            //
            // **前两道**不过就整体丢弃，而且**不许动 `inflight`**——那是当前
            // run 的状态，上一局的迟到响应没有资格改写它。第三道**不在此列**，
            // 理由见下：那一道判的不是「这一轮是不是我的」。
            if (run !== runId) return
            if (get().target === null || inflight !== job) return

            // 第三道闸门：响应自带的手序号/局面版本对不上。真实引擎下不可达
            // （`chooseMove` 原样回显 request 的 moveIndex），但**不能像前两道
            // 那样直接 return**：前两道是「这一轮已经不是我的了」，什么都不该动；
            // 这一道是「这一轮是我的，但这条响应是坏的」——直接 return 会让
            // `inflight` 永远占着、队列再也不 pump，面板停在「分析中 N-1 / N」。
            // 以错误收尾是唯一如实的选择：既不能拿坏数据凑结论，也不能假装还在跑。
            if (response.moveIndex !== index || response.gameVersion !== 0) {
              inflight = null
              set({ running: false, error: '分析响应与请求对不上，这一轮已中止' })
              reset()
              return
            }

            inflight = null
            if (job.kind === 'position') {
              fillReply(index, response)
              onPositionResponse(index, response)
            } else {
              onAlternativeResponse(index, response)
            }
            // **每条响应处理完都要判一次收尾**，不能只在「出了结论」时判：
            // 着法相同的手在自己的局面响应到达时就出了结论，最后一个局面回来时
            // 可能已经没有任何一手在等它——只靠出结论来触发，面板会永远停在「分析中」。
            finishIfDone()
            pump()
          },
          (error: unknown) => {
            if (run !== runId) return
            inflight = null
            if (get().target === null) return
            set({
              running: false,
              error: error instanceof Error ? error.message : String(error),
            })
            reset()
          },
        )
    }

    /** 局面 index 的棋盘：从头 replay 前 index 手。 */
    function boardAt(index: number) {
      const rec = record
      if (rec === null) throw new Error('没有打开的棋谱')
      return replay(rec.moves.slice(0, index), rec.firstPlayer).board
    }

    return {
      target: null,
      verdicts: new Map(),
      total: 0,
      running: false,
      error: null,

      start({ record: rec, engine: eng, difficulty: diff, budgetMs: budget }) {
        engine = eng
        record = rec
        difficulty = diff
        budgetMs = budget

        reset()
        set({
          target: {
            seq: rec.seq,
            difficulty: diff,
            budgetMs: budget,
            engineVersion: ENGINE_VERSION,
          },
          verdicts: new Map(),
          total: rec.moves.length,
          running: true,
          error: null,
        })

        // 没有可分析的手（开了就认输）：立刻收尾，不要停在「分析中」。
        if (rec.moves.length === 0) {
          set({ running: false })
          return
        }

        // 缓存命中：零请求直接填充
        const cached = cache.get(cacheKey(recordContentKey(rec), diff, budget))
        if (cached !== undefined) {
          const verdicts = new Map<number, MoveVerdict>()
          for (const verdict of cached) verdicts.set(verdict.moveIndex, verdict)
          set({ verdicts, running: false })
          return
        }

        // 每手一个挂起结论；终局手（成五）不需要后续局面。
        // 判定：该手落下后对局立即结束（replay 到 index+1 手 status !== 'playing'）。
        for (let i = 0; i < rec.moves.length; i++) {
          const after = replay(rec.moves.slice(0, i + 1), rec.firstPlayer)
          pending.set(i, {
            moveIndex: i,
            played: rec.moves[i]!,
            playedIsWinning: after.status === 'won',
          })
        }

        // 每个局面入队一次。局面总数 = 手数 + 1（局面 0..N，N = 手数）：
        // 非终局的最后一手也需要「局面 N」来算后续评分——
        // 终局手（成五）是唯一没有后续局面的特例。
        // 对照请求不在这里排：要等局面的响应回来才知道哪几手需要（`planAlternative`）。
        const positions: number[] = []
        for (let i = 0; i < rec.moves.length; i++) {
          const entry = pending.get(i)
          if (entry === undefined) continue
          if (!entry.playedIsWinning) {
            // 手 i 需要：局面 i（引擎首选）+ 局面 i+1（后续评分）
            if (!positions.includes(i)) positions.push(i)
            if (!positions.includes(i + 1)) positions.push(i + 1)
          } else if (!positions.includes(i)) {
            // 终局手只需要局面 i
            positions.push(i)
          }
        }
        queue = positions.map((index) => ({ kind: 'position', index }))

        pump()
      },

      stop() {
        reset()
        /*
         * `error` 一并清掉：它属于**那一次尝试**，`target` 一走就没有谁
         * 还能为它负责。留着它，下一局的分析面板会顶着上一局的失败，
         * 显示「这次分析没跑完：<上一局的错>」加一颗「重新分析」。
         */
        set({ running: false, target: null, error: null })
      },
    }
  })
}

