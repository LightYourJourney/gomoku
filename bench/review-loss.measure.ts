/**
 * 复盘「分差」口径的两项测量：`yarn bench:review-loss`。
 *
 * 背景：`analysisStore` 对每一手发两次搜索——落子前的局面 i（行棋方视角）与落子后的
 * 局面 i+1（对手视角），再算 `loss = max(0, score(i) − (−score(i+1)))`。两次搜索深度相同，
 * 所以第二次等于从局面 i 多看了一层、且最后一手换了人下；而 `evaluateBoard` 不含行棋方，
 * 「谁下最后一手谁占便宜」的奇偶层效应就原样进了分差。
 *
 * 这里用与复盘页相同的参数（初级档；预算给足，恒搜满深度）量两件事：
 *
 *   1. **自洽性**：让引擎自己走自己的首选。按定义这时分差应为 0，
 *      实际的 `score(i) − (−score(i+1))` 偏了多少、偏向哪边。
 *   2. **亏损检出**：每个局面随机挑一个非首选的邻域空点当作玩家着法，比较两种口径——
 *        现行口径   = max(0, score(i) − (−score(i+1｜玩家着法)))
 *        同视界口径 = (−score(i+1｜引擎首选)) − (−score(i+1｜玩家着法))
 *      后者的两个分数同视角、同深度，奇偶层效应相消。
 *
 * 只统计各次搜索都是 `reason === 'search'` 的手：必胜 / 必防捷径返回的是另一种量纲的分数，
 * 那是 `AI_ENGINE.md` 已写明并已规避的问题，混进来会夸大偏差。
 *
 * 结果是**确定的**（固定开局、固定种子、预算给足所以不受时钟影响），与机器负载无关；
 * 引擎的搜索或评估变了，数字才会变。
 *
 * 局限：「同视界口径」仍然只是 2 层初级引擎的看法，不是真理。这里能说明的是
 * **现行口径相对同一引擎的自洽口径有没有方向固定的偏差**，说明不了着法的真实好坏。
 *
 * 出处与首次结果：`docs/research/REFACTORING_ASSESSMENT.md` §4.1、§13。
 */
import { test } from 'vitest'
import { candidateMoves } from '../src/ai/candidates'
import { DIFFICULTY_PARAMS } from '../src/ai/difficulty'
import { searchBoard, searchOptionsFor } from '../src/ai/search'
import { samePoint } from '../src/core/board'
import { applyMove, replay } from '../src/core/game'
import type { Point } from '../src/core/types'

/** 复盘页固定用初级档（`ReviewScreen`）；预算给足，让每次都搜满档位深度。 */
const OPTIONS = searchOptionsFor(DIFFICULTY_PARAMS.easy, { budgetMs: 60_000 })
const now = Date.now

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

test('自洽性：引擎走自己的首选时，现行口径的分差偏了多少', () => {
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
  console.log('\n=== 1. 自洽性：score(i) − (−score(i+1))，引擎走自己的首选（应为 0）===')
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

test('亏损检出：随机着法下，现行口径与同视界口径各报出多少亏损', () => {
  // 固定种子的线性同余：结果要能逐字复现，不能用 Math.random
  let seed = 20261117
  const random = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  let samples = 0
  let currentZero = 0
  let likeForLikePositive = 0
  let likeForLikeNotable = 0
  let hidden = 0
  let hiddenNotable = 0
  const understated: number[] = []

  for (const opening of OPENINGS) {
    let game = replay([...opening])
    for (let step = 0; step < 30 && game.status === 'playing'; step += 1) {
      const here = searchBoard(game.board, game.current, OPTIONS, now)
      const engineMove = here.move
      if (engineMove === null) break

      if (here.reason === 'search') {
        const others = candidateMoves(game.board).filter((point) => !samePoint(point, engineMove))
        const played = others[Math.floor(random() * others.length)]
        const afterPlayed = played === undefined ? undefined : applyMove(game, played)
        const afterEngine = applyMove(game, engineMove)
        if (
          afterPlayed?.ok === true &&
          afterEngine.ok &&
          afterPlayed.state.status === 'playing' &&
          afterEngine.state.status === 'playing'
        ) {
          const replyToPlayed = searchBoard(afterPlayed.state.board, afterPlayed.state.current, OPTIONS, now)
          const replyToEngine = searchBoard(afterEngine.state.board, afterEngine.state.current, OPTIONS, now)
          if (replyToPlayed.reason === 'search' && replyToEngine.reason === 'search') {
            const current = Math.max(0, here.score - -replyToPlayed.score)
            const likeForLike = -replyToEngine.score - -replyToPlayed.score
            samples += 1
            if (current === 0) currentZero += 1
            if (likeForLike > 0) likeForLikePositive += 1
            if (likeForLike >= NOTABLE) likeForLikeNotable += 1
            if (current === 0 && likeForLike > 0) hidden += 1
            if (current === 0 && likeForLike >= NOTABLE) hiddenNotable += 1
            understated.push(likeForLike - current)
          }
        }
      }

      const next = applyMove(game, engineMove)
      if (!next.ok) break
      game = next.state
    }
  }

  understated.sort((a, b) => a - b)
  console.log('\n=== 2. 亏损检出：玩家走随机的非首选着法 ===')
  console.log(`样本 ${samples} 手`)
  console.log(`现行口径报「零亏损」：${currentZero} 手`)
  console.log(`同视界口径有亏损：${likeForLikePositive} 手（其中 ≥ ${NOTABLE} 的 ${likeForLikeNotable} 手）`)
  console.log(`被现行口径掩盖（现行为 0、同视界为正）：${hidden} 手（其中 ≥ ${NOTABLE} 的 ${hiddenNotable} 手）`)
  console.log(`低估量（同视界 − 现行）的中位数：${quantile(understated, 0.5)}`)
})
