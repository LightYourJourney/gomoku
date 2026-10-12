import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { opponentOf } from '../core/board'
import type { Point } from '../core/types'
import type { AiEngine } from '../ai/engine'
import type { Difficulty, SearchResponse } from '../ai/types'
import { ENGINE_VERSION } from '../ai/version'
import type { GameRecord } from '../persist/gameRecords'
import { replay } from '../core/game'
import { buildVerdict, cacheKey, type MoveVerdict } from '../analysis/analyze'
import { nextRequestId } from './requestCounter'

/**
 * 单手分析的时间预算。
 *
 * 一局几十手、每手一个请求，串行跑：预算给太长整体就拖沓，给太短结论
 * 全落成 heuristic。400ms 在入门~中级档一般能搜完；高档位结论的
 * 可靠度会如实降级为 heuristic，界面照常显示。
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

/** 一次「局面」请求的应答都到齐后才能拼出结论。 */
interface PendingVerdict {
  readonly moveIndex: number
  readonly played: Point
  readonly playedIsWinning: boolean
  /** 局面 i 的响应（引擎首选 + 评分）。 */
  position?: { move: Point; score: number; depth: number; nodes: number; confidence: 'exact' | 'heuristic' }
  /** 局面 i+1 的响应（对手视角评分；终局手不需要）。 */
  reply?: { score: number; depth: number; nodes: number; confidence: 'exact' | 'heuristic' }
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
    /** 等待请求的局面序号（0-based 局面 = moveIndex；终局手没有局面 N）。 */
    let queue: number[] = []
    let inflightIndex: number | null = null
    /**
     * 本次分析的标识，每次 `start` 递增。
     *
     * 光比 `inflightIndex` 不够：每个 run 的局面号都从 0 开始，上一局的
     * 迟到响应会被下一局当成自己的（局面号恰好相同），于是 B 的响应全被
     * 丢弃、分析永久卡死。响应必须连同 run 一起核对。
     */
    let runId = 0

    function reset() {
      pending.clear()
      queue = []
      inflightIndex = null
      runId++ // 让所有在飞响应作废
    }

    /** 一个局面请求完成后：填入挂起结论、可能直接拼出 verdict、推进队列。 */
    function onPositionResponse(index: number, response: SearchResponse) {
      const rec = record
      if (rec === null || engine === null) return

      // 无棋可走（满盘和棋的末局）：这一手没有「引擎首选」可比，
      // 拼不出结论，但**必须继续收尾**——直接 return 会让队列停在这里，
      // 面板永远停在「分析中 N-1 / N」。
      if (response.move === null) {
        pending.delete(index)
        // 上一手无法评估（没有「走完之后」的引擎判断）——直接跳过它，
        // 不给一个编出来的结论，总数也少一手，面板不会停在「N-1 / N」。
        if (pending.delete(index - 1)) {
          set({ total: Math.max(0, get().total - 1) })
        }
        finishIfDone()
        pump()
        return
      }

      // 这个局面是哪几手的「局面请求」？第 index 手（若 index < 总手数）。
      const entry = pending.get(index)

      if (entry !== undefined) {
        entry.position = {
          move: response.move,
          score: response.score,
          depth: response.depth,
          nodes: response.nodes,
          confidence: response.confidence,
        }
      }

      tryEmit(index)
      tryEmit(index - 1) // 局面 i 的响应同时是手 i-1 的 reply 半边——补上后重试拼装
      pump()
    }

    /**
     * 局面 i 也是「第 i-1 手的后续局面」：补上 reply 半边。
     *
     * `move === null`（满盘，无棋可走）时**不补**：这个局面没有引擎判断，
     * 强行拿 `score: 0` 当「走完这手之后的评分」会算出一个凭空的巨额亏损。
     */
    function fillReply(index: number, response: SearchResponse) {
      if (response.move === null) return

      const prev = pending.get(index - 1)
      if (prev !== undefined && !prev.playedIsWinning) {
        prev.reply = {
          score: response.score,
          depth: response.depth,
          nodes: response.nodes,
          confidence: response.confidence,
        }
      }
    }

    /** 两半都齐就 buildVerdict 并写入 verdicts。 */
    function tryEmit(index: number) {
      const rec = record
      const entry = pending.get(index)
      if (rec === null || entry === undefined) return

      const pos = entry.position
      if (pos === undefined) return

      if (entry.playedIsWinning) {
        emit(index, entry, pos)
        return
      }

      const reply = entry.reply
      if (reply === undefined) return

      // negamax：对手视角评分取负 = 我方走完这手后的评分
      emit(index, entry, pos)
    }

    function emit(index: number, entry: PendingVerdict, pos: NonNullable<PendingVerdict['position']>) {
      const verdict = buildVerdict({
        moveIndex: index,
        played: entry.played,
        engineMove: pos.move,
        engineScore: pos.score,
        playedScore: entry.playedIsWinning ? 0 : -(entry.reply?.score ?? 0), // 与上面的 playedScore 同一口径
        isWinningMove: entry.playedIsWinning,
        confidence: pos.confidence,
        engineDepth: pos.depth,
        engineNodes: pos.nodes,
      })

      const verdicts = new Map(get().verdicts)
      verdicts.set(index, verdict)

      pending.delete(index)

      set({ verdicts })

      finishIfDone()
    }

    /** 队列排空且没有再挂起的结论 → 写缓存、收尾。 */
    function finishIfDone() {
      const rec = record
      if (rec === null || !get().running) return
      if (queue.length > 0 || inflightIndex !== null) return
      if (pending.size > 0) return

      cache.set(
        cacheKey(rec.seq, difficulty, budgetMs),
        [...get().verdicts.values()].sort((a, b) => a.moveIndex - b.moveIndex),
      )
      set({ running: false })
    }

    function pump() {
      const rec = record
      if (rec === null || engine === null) return
      if (inflightIndex !== null) return
      if (queue.length === 0) return

      const index = queue.shift()!
      inflightIndex = index
      const run = runId

      // 分析不碰对局，但过期闸门照用：gameVersion 恒 0，配对走 moveIndex。
      void engine
        .search({
          requestId: nextRequestId(),
          gameVersion: 0,
          board: boardAt(index),
          player: index % 2 === 0 ? rec.firstPlayer : opponentOf(rec.firstPlayer),
          difficulty,
          budgetMs,
          purpose: 'analyze',
          moveIndex: index,
        })
        .then(
          (response) => {
            // 三道闸门：属于当前这一次分析（run）、是当前在飞的那一个、
            // 响应自带的手序号与局面版本对得上。任何一条不过就整体丢弃——
            // **不许动 inflightIndex**：那是当前 run 的状态，
            // 上一局的迟到响应没有资格改写它。
            if (run !== runId) return
            if (get().target === null || inflightIndex !== index) return
            if (response.moveIndex !== index || response.gameVersion !== 0) return

            inflightIndex = null
            fillReply(index, response)
            onPositionResponse(index, response)
          },
          (error: unknown) => {
            if (run !== runId) return
            inflightIndex = null
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
        const cached = cache.get(cacheKey(rec.seq, diff, budget))
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
        queue = []
        for (let i = 0; i < rec.moves.length; i++) {
          const entry = pending.get(i)
          if (entry === undefined) continue
          if (!entry.playedIsWinning) {
            // 手 i 需要：局面 i（引擎首选）+ 局面 i+1（后续评分）
            if (!queue.includes(i)) queue.push(i)
            if (!queue.includes(i + 1)) queue.push(i + 1)
          } else if (!queue.includes(i)) {
            // 终局手只需要局面 i
            queue.push(i)
          }
        }

        pump()
      },

      stop() {
        reset()
        set({ running: false, target: null })
      },
    }
  })
}

