/**
 * 复盘「分差」口径的三项测量：`yarn bench:review-loss`。
 *
 * 背景：复盘的分差原先是 `max(0, score(i) − (−score(i+1)))`——落子前的局面 i（行棋方视角）
 * 与落子后的局面 i+1（对手视角）各搜一次。两次搜索深度相同，所以第二次等于从局面 i 多看了
 * 一层、且最后一手换了人下；而 `evaluateBoard` 不含行棋方，「谁下最后一手谁占便宜」的
 * 奇偶层效应就原样进了分差。现在的口径（`analysis/analyze.ts` 的 `horizonLoss`）比的是
 * 「走完实际着法之后」与「走完引擎首选之后」两个局面，同视角、同深度，偏差相消；
 * 两边评分不可比时不算。
 *
 * 这里用与复盘页相同的参数（初级档；预算给足，恒搜满深度）量三件事：
 *
 *   1. **旧公式的自洽性**：让引擎自己走自己的首选。按定义这时分差应为 0，
 *      `score(i) − (−score(i+1))` 实际偏了多少、偏向哪边。这是「为什么不用那个公式」的证据，
 *      量的是引擎的性质，不随复盘口径变化。只统计相邻两次搜索都是 `reason === 'search'` 的手：
 *      必胜 / 必防捷径返回的是另一种量纲的分数，混进来会夸大偏差。
 *   2. **亏损检出（随机着法）**：每个局面随机挑一个非首选的邻域空点当作玩家着法，
 *      用**生产函数** `buildVerdict` 出结论，数有亏损 / 零亏损 / 未算分差各多少手。
 *   3. **亏损检出（入门档自对弈）**：同上，但着法来自入门档引擎——更接近真实对局里
 *      「大部分手与引擎一致、少数手不同」的分布。
 *
 * 2、3 走的是完整的两级流程：一级是必防捷径的手沿应着续搜一层（`linesToFollow`），
 * 与 `analysisStore` 同一套规则；另报「靠续搜算出」「漏走五连」与一二级的量级差。
 *
 * 结果是**确定的**（固定开局、固定种子、预算给足所以不受时钟影响），与机器负载无关；
 * 引擎的搜索或评估变了，数字才会变。
 *
 * **档位与预算可换**（复盘分析预算实验，`docs/research/ANALYSIS_BUDGET_PLAN.md`）：
 *
 *   REVIEW_DIFFICULTY=medium REVIEW_BUDGET_MS=1000 REVIEW_OUT=/tmp/b.json yarn bench:review-loss
 *
 * 缺省是初级 + 给足的预算（与上面描述的一致）。给真实预算时另报每次复盘搜索的耗时分布与被时间截断的比例；
 * `REVIEW_OUT` 写出自对弈样本里每局的亏损榜（产品取前三，`buildSummary`），供不同组之间比对。
 *
 * 局限：分差仍然只是 2 层初级引擎的看法，不是真理。这里量的是口径**自洽不自洽、
 * 有多少手算得出来**，说明不了着法的真实好坏。
 *
 * 出处：`docs/research/REFACTORING_ASSESSMENT.md` §4.1、§13；现行基线记在
 * `docs/AI_ENGINE.md` 的「复盘分差的口径」。
 */
import { test } from 'vitest'
import { candidateMoves } from '../src/ai/candidates'
import { DIFFICULTY_PARAMS } from '../src/ai/difficulty'
import { searchBoard, searchOptionsFor } from '../src/ai/search'
import {
  buildSummary,
  buildVerdict,
  followUpState,
  followUpStates,
  linesToFollow,
  type AfterMove,
  type MoveVerdict,
  type Reached,
} from '../src/analysis/analyze'
import type { Difficulty } from '../src/ai/types'
import { writeFileSync } from 'node:fs'
import { samePoint } from '../src/core/board'
import { applyMove, replay, type GameState } from '../src/core/game'
import type { Point } from '../src/core/types'

/** 复盘档位：缺省与复盘页一致（初级，`ReviewScreen`）。 */
const DIFFICULTY = (process.env.REVIEW_DIFFICULTY ?? 'easy') as Difficulty
if (!(DIFFICULTY in DIFFICULTY_PARAMS)) throw new Error(`REVIEW_DIFFICULTY 不认识：${DIFFICULTY}`)
/** 缺省预算给足，让每次都搜满档位深度；给真实预算时量截断。 */
const BUDGET_MS = Number(process.env.REVIEW_BUDGET_MS ?? 60_000)
if (!Number.isFinite(BUDGET_MS) || BUDGET_MS <= 0) throw new Error(`REVIEW_BUDGET_MS 不合法：${process.env.REVIEW_BUDGET_MS}`)
const OPTIONS = searchOptionsFor(DIFFICULTY_PARAMS[DIFFICULTY], { budgetMs: BUDGET_MS })
const now = Date.now
console.log(`\n复盘档位 ${DIFFICULTY}、每次搜索预算 ${BUDGET_MS} ms`)

/** 复盘搜索（用 `OPTIONS` 的那些）的耗时与结束原因，给真实预算的那一轮报截断。 */
const searches: { readonly ms: number; readonly reason: string }[] = []
/** 复盘口径的一次搜索：记下耗时与原因。 */
function reviewSearch(board: GameState['board'], player: GameState['current']) {
  const startedAt = performance.now()
  const reply = searchBoard(board, player, OPTIONS, now)
  searches.push({ ms: Math.round(performance.now() - startedAt), reason: reply.reason })
  return reply
}

const OPENINGS: readonly (readonly Point[])[] = [
  [{ x: 7, y: 7 }, { x: 8, y: 8 }, { x: 7, y: 9 }],
  [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 9, y: 9 }],
  [{ x: 7, y: 7 }, { x: 6, y: 6 }, { x: 8, y: 6 }],
  [{ x: 7, y: 7 }, { x: 8, y: 7 }, { x: 6, y: 8 }],
  [{ x: 6, y: 7 }, { x: 8, y: 8 }, { x: 9, y: 6 }],
  [{ x: 7, y: 6 }, { x: 7, y: 8 }, { x: 5, y: 7 }],
]

/**
 * 「半子」：界面把 10,000 分换算成 1 子，不足 5,000 的一律说「分差很小（不足 1 子）」
 * （`analysis/analyze.ts`）。用同一条线区分「有亏损」与「界面会报出子数的亏损」。
 */
const NOTABLE = 5000

const quantile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!

test('旧公式的自洽性：引擎走自己的首选时，score(i) − (−score(i+1)) 偏了多少', () => {
  const deviations: number[] = []
  let shortcuts = 0

  for (const opening of OPENINGS) {
    let game = replay([...opening])
    for (let step = 0; step < 40 && game.status === 'playing'; step += 1) {
      const here = searchBoard(game.board, game.current, OPTIONS, now)
      if (here.move === null) break
      const next = applyMove(game, here.move)
      if (!next.ok) break
      if (next.state.status === 'playing') {
        const after = searchBoard(next.state.board, next.state.current, OPTIONS, now)
        if (here.reason === 'search' && after.reason === 'search') {
          deviations.push(here.score - -after.score)
        } else {
          shortcuts += 1
        }
      }
      game = next.state
    }
  }

  const magnitudes = deviations.map(Math.abs).sort((a, b) => a - b)
  console.log('\n=== 1. 旧公式的自洽性：score(i) − (−score(i+1))，引擎走自己的首选（应为 0）===')
  console.log(`样本 ${deviations.length} 手（另有 ${shortcuts} 手涉及捷径分，已排除）`)
  console.log(
    `符号：负 ${deviations.filter((d) => d < 0).length} / 零 ${deviations.filter((d) => d === 0).length}` +
      ` / 正 ${deviations.filter((d) => d > 0).length}`,
  )
  console.log(
    `|偏差|：中位 ${quantile(magnitudes, 0.5)} / P75 ${quantile(magnitudes, 0.75)}` +
      ` / P90 ${quantile(magnitudes, 0.9)} / 最大 ${magnitudes[magnitudes.length - 1]}`,
  )
  console.log(`|偏差| ≥ 10000 的：${magnitudes.filter((v) => v >= 10_000).length} 手`)
})

/** 轮到 `state.current` 走的局面，由这一方搜出来的结论。 */
function searchState(state: GameState): Reached {
  const reply = reviewSearch(state.board, state.current)
  return { score: reply.score, reason: reply.reason, move: reply.move }
}

/** 「走完这一手之后」的局面与对手搜出来的结论；`'ended'` = 这一手当场成五。 */
function searchAfter(game: GameState, move: Point): { after: Reached | 'ended' | null; state: GameState | null } {
  const next = applyMove(game, move)
  if (!next.ok) return { after: null, state: null }
  if (next.state.status === 'won') return { after: 'ended', state: null }
  return next.state.status === 'playing'
    ? { after: searchState(next.state), state: next.state }
    : { after: null, state: null }
}

const describeSide = (after: AfterMove | 'ended' | null, follow?: AfterMove | null): string => {
  const first = after === null ? '无' : after === 'ended' ? '终局' : after.reason
  return follow === undefined ? first : `${first}→${follow === null ? '无' : follow.reason}`
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * 沿一局棋逐手统计**生产口径**（`linesToFollow` + `buildVerdict`，与复盘页同一套函数）给出的结论。
 *
 * `pick` 决定「玩家」这一手走哪；`advance` 决定对局沿谁的着法往下走。
 * 只统计着法与引擎首选不同、且不是终局手的手——其余的分差按定义为 0。
 */
function tally(
  label: string,
  pick: (game: GameState, engineMove: Point) => Point | undefined,
  advance: 'engine' | 'played',
): void {
  const count = {
    moves: 0,
    same: 0,
    winning: 0,
    different: 0,
    positive: 0,
    notable: 0,
    zero: 0,
    uncomputed: 0,
    byFollow: 0,
    followSearches: 0,
  }
  /** 旧口径 `max(0, score(i) − (−score(i+1)))` 在同一批手上报出多少个零，留作对照。 */
  let legacyZero = 0
  const uncomputedBy = new Map<string, number>()
  /** 引擎首选当场成五、实际着法没走的手：它们的分差（`null` = 没算出来）。 */
  const missedFive: (number | null)[] = []
  /**
   * 一二级的量级差。**选样写死**：一级两边都是 `search` 的手（生产上它们不续搜），
   * 另外让两边各续搜一层，两边二级也都是 `search` 时记「二级分差 − 一级分差」（不钳 0）。
   * 只为统计，不进结论。
   */
  const levelGap: number[] = []
  /** 每局的结论（只收着法不同的手），给自对弈样本算亏损榜。 */
  const verdictsByGame: MoveVerdict[][] = []
  searches.length = 0

  for (const opening of OPENINGS) {
    const verdicts: MoveVerdict[] = []
    verdictsByGame.push(verdicts)
    let game = replay([...opening])
    for (let step = 0; step < 40 && game.status === 'playing'; step += 1) {
      const here = reviewSearch(game.board, game.current)
      const engineMove = here.move
      if (engineMove === null) break
      const played = pick(game, engineMove)
      if (played === undefined) break
      const playedNext = applyMove(game, played)
      if (!playedNext.ok) break
      count.moves += 1

      if (playedNext.state.status === 'won') {
        count.winning += 1
      } else if (samePoint(played, engineMove)) {
        count.same += 1
      } else {
        count.different += 1
        // 这一支里实际着法已经确定没有成五
        const playedState = playedNext.state.status === 'playing' ? playedNext.state : null
        const afterPlayed = playedState === null ? null : searchState(playedState)
        const engineLine = searchAfter(game, engineMove)
        const afterEngine = engineLine.after

        const lines = linesToFollow(afterPlayed, afterEngine)
        const states = followUpStates(
          { state: playedState, after: afterPlayed },
          { state: engineLine.state, after: afterEngine },
        )
        const followPlayed = states.played === null ? null : searchState(states.played)
        const followEngine = states.engine === null ? null : searchState(states.engine)
        count.followSearches += (followPlayed === null ? 0 : 1) + (followEngine === null ? 0 : 1)

        const verdict = buildVerdict({
          moveIndex: game.moves.length,
          played,
          engineMove,
          isWinningMove: false,
          afterPlayed,
          afterEngine,
          follow: { played: followPlayed, engine: followEngine },
          reason: here.reason,
          engineDepth: here.depth,
          engineNodes: here.nodes,
        })
        verdicts.push(verdict)
        const followed = lines.played || lines.engine
        if (verdict.loss === null) {
          count.uncomputed += 1
          const key =
            `实际着法之后 ${describeSide(afterPlayed, followed ? followPlayed : undefined)}` +
            ` / 引擎首选之后 ${describeSide(afterEngine, followed ? followEngine : undefined)}`
          uncomputedBy.set(key, (uncomputedBy.get(key) ?? 0) + 1)
        } else {
          if (followed) count.byFollow += 1
          if (verdict.loss === 0) {
            count.zero += 1
          } else {
            count.positive += 1
            if (verdict.loss >= NOTABLE) count.notable += 1
          }
        }
        if (afterEngine === 'ended') missedFive.push(verdict.loss)
        if (afterPlayed !== null && here.score - -afterPlayed.score <= 0) {
          legacyZero += 1
        }

        if (
          afterPlayed?.reason === 'search' &&
          afterEngine !== null &&
          afterEngine !== 'ended' &&
          afterEngine.reason === 'search'
        ) {
          const p2State = followUpState(playedState, afterPlayed)
          const e2State = followUpState(engineLine.state, afterEngine)
          const p2 = p2State === null ? null : searchState(p2State)
          const e2 = e2State === null ? null : searchState(e2State)
          if (p2?.reason === 'search' && e2?.reason === 'search') {
            levelGap.push(e2.score - p2.score - (-afterEngine.score - -afterPlayed.score))
          }
        }
      }

      const next = advance === 'engine' ? applyMove(game, engineMove) : playedNext
      if (!next.ok) break
      game = next.state
    }
  }

  console.log(`\n=== ${label} ===`)
  console.log(
    `共 ${count.moves} 手：与引擎一致 ${count.same}、终局手 ${count.winning}、着法不同 ${count.different}`,
  )
  console.log(
    `着法不同的 ${count.different} 手里：有亏损 ${count.positive}（其中 ≥ ${NOTABLE} 的 ${count.notable}）` +
      `、零亏损 ${count.zero}、未算分差 ${count.uncomputed}`,
  )
  console.log(`其中靠续搜算出的 ${count.byFollow} 手；多发的续搜 ${count.followSearches} 次`)
  for (const [key, n] of [...uncomputedBy].sort((a, b) => b[1] - a[1])) {
    console.log(`  未算：${key} —— ${n} 手`)
  }
  const missedLosses = missedFive.filter((loss): loss is number => loss !== null)
  console.log(
    `漏走五连（引擎首选当场成五）${missedFive.length} 手：算出 ${missedLosses.length} 手` +
      (missedLosses.length > 0 ? `，分差 ${Math.min(...missedLosses)}–${Math.max(...missedLosses)}` : ''),
  )
  console.log(
    `一二级量级差（一级两边都是 search 的 ${levelGap.length} 手，二级分差 − 一级分差）：` +
      `负 ${levelGap.filter((v) => v < 0).length} / 零 ${levelGap.filter((v) => v === 0).length}` +
      ` / 正 ${levelGap.filter((v) => v > 0).length}；中位 ${median(levelGap) ?? '—'}`,
  )
  console.log(`对照：旧口径在这 ${count.different} 手上报「零亏损」${legacyZero} 手`)

  // 复盘搜索的耗时与截断：分母只算走到搜索那一步的（search / timeout），必胜 / 必防等捷径不算。
  const searched = searches.filter((s) => s.reason === 'search' || s.reason === 'timeout')
  const times = searches.map((s) => s.ms).sort((a, b) => a - b)
  const timeouts = searched.filter((s) => s.reason === 'timeout').length
  console.log(
    `复盘搜索 ${searches.length} 次：耗时中位 ${quantile(times, 0.5)} ms、P90 ${quantile(times, 0.9)} ms、最大 ${times.at(-1)} ms；` +
      `被时间截断 ${timeouts} / ${searched.length}（捷径 ${searches.length - searched.length} 次不计）`,
  )

  if (advance === 'played') {
    const tops = verdictsByGame.map((verdicts) =>
      buildSummary(verdicts).topLosses.map((v) => ({ moveIndex: v.moveIndex, loss: v.loss })),
    )
    tops.forEach((top, i) => console.log(`  第 ${i + 1} 局亏损榜：${top.map((t) => `#${t.moveIndex}(${t.loss})`).join('、') || '—'}`))
    const out = process.env.REVIEW_OUT
    if (out !== undefined) {
      writeFileSync(out, JSON.stringify({ difficulty: DIFFICULTY, budgetMs: BUDGET_MS, tops, uncomputed: count.uncomputed, different: count.different }, null, 2))
      console.log(`  亏损榜写到 ${out}`)
    }
  }
}

test('亏损检出：随机着法，生产口径给出多少亏损、多少未算', () => {
  // 固定种子的线性同余：结果要能逐字复现，不能用 Math.random
  let seed = 20261117
  const random = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  tally(
    '2. 亏损检出：玩家走随机的非首选着法（对局沿引擎首选推进）',
    (game, engineMove) => {
      const others = candidateMoves(game.board).filter((point) => !samePoint(point, engineMove))
      return others[Math.floor(random() * others.length)]
    },
    'engine',
  )
})

test('亏损检出：入门档自对弈，由初级档复盘', () => {
  const beginner = searchOptionsFor(DIFFICULTY_PARAMS.beginner, { budgetMs: 60_000 })

  tally(
    '3. 亏损检出：入门档自对弈，由初级档复盘（更接近真实对局的分布）',
    (game) => searchBoard(game.board, game.current, beginner, now).move ?? undefined,
    'played',
  )
})
