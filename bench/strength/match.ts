import { applyMove } from '../../src/core/game'
import { BLACK, type Player } from '../../src/core/types'
import { openingState, type MatchOpening } from './openings'
import type {
  Engine,
  EngineMove,
  GameOutcomeKind,
  GameRecord,
  PairedGameSet,
  PlayedMove,
} from './types'

/**
 * 一局 = 从固定开局出发，双方交替调用**各自的**引擎，直到分出胜负或触到上限。
 *
 * 这里只做编排：合法性、成五、和棋全部由 `core/game.ts` 判定，评测器不重新
 * 实现任何一条五子棋规则。
 */

export interface PlayGameOptions {
  readonly black: Engine
  readonly white: Engine
  readonly opening: MatchOpening
  /** 手数上限。达到它**不算和棋**，结局记为 `move-limit`。 */
  readonly maxMoves: number
  /** 整个实验的墙钟截止点（`now()` 的刻度）。超过后剩余对局记为 `aborted`。 */
  readonly deadline?: number
  /** 注入时钟，便于测试超时分类。默认 `Date.now`。 */
  readonly now?: () => number
}

function emptyRecord(
  options: PlayGameOptions,
  outcome: GameOutcomeKind,
  moves: readonly PlayedMove[],
  extra: {
    error?: string
    failAtMove?: number
    winner?: Player | null
    elapsedMs: number
  },
): GameRecord {
  return {
    opening: options.opening.id,
    black: options.black.id,
    white: options.white.id,
    outcome,
    winner: extra.winner ?? null,
    moves,
    error: extra.error ?? null,
    failAtMove: extra.failAtMove ?? null,
    elapsedMs: extra.elapsedMs,
  }
}

/** 引擎是否偷偷改了我们交给它的棋盘。 */
function mutated(before: Uint8Array, after: Uint8Array): boolean {
  if (before.length !== after.length) return true
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return true
  }
  return false
}

export function playGame(options: PlayGameOptions): GameRecord {
  const now = options.now ?? Date.now
  const startedAt = now()
  let state = openingState(options.opening)
  const moves: PlayedMove[] = []

  while (state.status === 'playing' && state.moves.length < options.maxMoves) {
    if (options.deadline !== undefined && now() > options.deadline) {
      return emptyRecord(options, 'aborted', moves, {
        error: 'experiment deadline exceeded',
        failAtMove: moves.length,
        elapsedMs: now() - startedAt,
      })
    }

    const engine = state.current === BLACK ? options.black : options.white
    // 交给引擎的是**副本**：既是防御（引擎写坏输入不会污染对局），也是检测手段
    // ——调用后把副本与真实棋盘比对，能发现「引擎修改了输入」。
    const input = state.board.slice()
    let result: EngineMove

    try {
      result = engine.choose(input, state.current, { moveIndex: state.moves.length })
    } catch (error) {
      return emptyRecord(options, 'engine-error', moves, {
        error: `${engine.id}: ${error instanceof Error ? error.message : String(error)}`,
        failAtMove: moves.length,
        elapsedMs: now() - startedAt,
      })
    }

    if (mutated(input, state.board)) {
      return emptyRecord(options, 'engine-error', moves, {
        error: `${engine.id}: 修改了传入的棋盘`,
        failAtMove: moves.length,
        elapsedMs: now() - startedAt,
      })
    }

    if (result.move === null) {
      return emptyRecord(options, 'no-move', moves, {
        error: `${engine.id}: 盘面未满却返回 null（reason=${result.reason}）`,
        failAtMove: moves.length,
        elapsedMs: now() - startedAt,
      })
    }

    const applied = applyMove(state, result.move)
    if (!applied.ok) {
      // 非法着法是最严重的引擎缺陷：完整局面与手顺都留在记录里，便于复现。
      return emptyRecord(options, 'illegal-move', moves, {
        error: `${engine.id}: ${applied.error} @ (${result.move.x},${result.move.y})`,
        failAtMove: moves.length,
        elapsedMs: now() - startedAt,
      })
    }

    moves.push({
      point: result.move,
      player: state.current,
      engine: engine.id,
      metrics: {
        depth: result.depth,
        nodes: result.nodes,
        ttHits: result.ttHits,
        reason: result.reason,
        elapsedMs: result.elapsedMs,
      },
    })

    state = applied.state
  }

  const elapsedMs = now() - startedAt

  if (state.status === 'won') {
    const outcome: GameOutcomeKind = state.winner === BLACK ? 'black-win' : 'white-win'
    return emptyRecord(options, outcome, moves, { winner: state.winner, elapsedMs })
  }
  if (state.status === 'draw') {
    return emptyRecord(options, 'draw', moves, { elapsedMs })
  }

  // 走到这里说明触到了手数上限。**它不是和棋**——实验没跑完，单独归类。
  return emptyRecord(options, 'move-limit', moves, {
    error: `达到手数上限 ${options.maxMoves}，局面仍未结束`,
    elapsedMs,
  })
}

/**
 * 配对赛：同一个开局下，A 执黑一局、B 执黑一局。
 *
 * 成对是**公平性的核心**：五子棋先手优势明显，只让 A 执黑、B 执白再比较胜率，
 * 测到的是「谁执黑」而不是「谁更强」。配对之后每个开局贡献两局，
 * 双方执黑、执白的机会完全对称。
 */
export function playPaired(
  opening: MatchOpening,
  a: Engine,
  b: Engine,
  options: { maxMoves: number; deadline?: number; now?: () => number },
): PairedGameSet {
  const aBlack = playGame({ black: a, white: b, opening, ...options })
  const bBlack = playGame({ black: b, white: a, opening, ...options })

  return { opening: opening.id, aBlack, bBlack }
}

export interface ExperimentOptions {
  readonly openings: readonly MatchOpening[]
  readonly maxMoves: number
  /** 同一开局重复几次。重复之间存在相关性，统计时以「开局」为单位重采样。 */
  readonly repeats?: number
  readonly abortAfterMs?: number
  readonly now?: () => number
}

export function runExperiment(
  a: Engine,
  b: Engine,
  options: ExperimentOptions,
): PairedGameSet[] {
  const now = options.now ?? Date.now
  const repeats = Math.max(1, options.repeats ?? 1)
  const deadline = options.abortAfterMs === undefined ? undefined : now() + options.abortAfterMs
  const sets: PairedGameSet[] = []

  for (const opening of options.openings) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      sets.push(playPaired(opening, a, b, { maxMoves: options.maxMoves, deadline, now }))
    }
  }

  return sets
}
