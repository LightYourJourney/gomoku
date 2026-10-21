import { mkdirSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { test } from 'vitest'
import { idx } from '../../src/core/board'
import { DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_PARAMS } from '../../src/ai/difficulty'
import { boardFromLines } from '../../src/test/board-fixtures'
import { createLocalEngine } from './local'
import { POSITIONS } from './positions'
import {
  aggregateTier,
  probePosition,
  type TacticsReport,
  type TightBudgetResult,
  type TacticCaseResult,
} from './tactics'
import type { EngineSpec } from './types'

/**
 * 战术探针入口：`yarn tactics`。
 *
 * 对五档各跑一遍标准战术局面，用独立判据打分，并把逐题结果与矩阵写进
 * `bench/strength/results/`。**它不做门禁断言**——战术失败是数据，
 * 不是构建错误；真正的行为红线在 `src/ai/*.test.ts`。
 *
 * 时间紧张探针单独跑：同一个局面、预算压到 1 ms，只要求「返回合法着法」。
 */

const RESULT_DIR = 'bench/strength/results'

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

const SYMBOL = { pass: '✓', fail: '✗', diagnostic: '·' } as const

test('战术探针：五档 × 标准局面', () => {
  const generatedAt = new Date().toISOString()
  const boards = new Map(POSITIONS.map((position) => [position.id, boardFromLines(position.lines)]))
  const tiers = DIFFICULTIES.map((difficulty) => {
    const params = DIFFICULTY_PARAMS[difficulty]
    const spec: EngineSpec = {
      id: `tactics-${difficulty}`,
      label: DIFFICULTY_LABELS[difficulty],
      difficulty,
      clock: 'real',
    }
    const engine = createLocalEngine(spec)
    const cases: TacticCaseResult[] = POSITIONS.map((position) =>
      probePosition(engine, position, boards.get(position.id)!),
    )
    return aggregateTier(engine, difficulty, DIFFICULTY_LABELS[difficulty], params.budgetMs, cases)
  })

  const tightBudget: TightBudgetResult[] = DIFFICULTIES.map((difficulty) => {
    const engine = createLocalEngine({
      id: `tight-${difficulty}`,
      label: DIFFICULTY_LABELS[difficulty],
      difficulty,
      clock: 'real',
      budgetMs: 1,
    })
    const position = POSITIONS.find((item) => item.id === 'quiet-midgame')!
    const board = boards.get(position.id)!
    const result = engine.choose(board.slice(), position.player)
    const legal = result.move !== null && board[idx(result.move.x, result.move.y)] === 0
    return {
      engineId: engine.id,
      difficulty,
      position: position.id,
      verdict: legal ? 'pass' : 'fail',
      move: result.move,
      reason: result.reason,
      elapsedMs: result.elapsedMs,
    }
  })

  const payload: TacticsReport = { generatedAt, loadAverage: loadavg()[0] ?? null, tiers, tightBudget }

  mkdirSync(RESULT_DIR, { recursive: true })
  const stem = `${stamp()}-tactics`
  writeFileSync(`${RESULT_DIR}/${stem}.json`, `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(`${RESULT_DIR}/${stem}.md`, renderMarkdown(payload))

  console.log(`\n=== 战术探针（正式预算，真实时钟）===`)
  console.log('档位\t通过\t失败\t诊断\t预算')
  for (const tier of tiers) {
    console.log(`${tier.label}\t${tier.passed}\t${tier.failed}\t${tier.diagnostic}\t${tier.budgetMs} ms`)
  }

  const failures = tiers.flatMap((tier) =>
    tier.cases
      .filter((item) => item.verdict === 'fail')
      .map((item) => `${tier.label} ${item.position}（期望：${item.expected}，实际：${formatMove(item.move)}）`),
  )
  console.log(failures.length === 0 ? '失败项：无' : `失败项：\n- ${failures.join('\n- ')}`)

  console.log(`\n=== 时间紧张（预算 1 ms）===`)
  for (const item of tightBudget) {
    console.log(
      `${DIFFICULTY_LABELS[item.difficulty]}\t` +
        `${item.verdict === 'pass' ? '合法' : '非法/无着法'}\t${item.reason}\t${item.elapsedMs} ms`,
    )
  }

  console.log(`\n结果已写入 ${RESULT_DIR}/${stem}.{json,md}`)
}, 900_000)

function formatMove(move: { x: number; y: number } | null): string {
  return move === null ? '无' : `(${move.x},${move.y})`
}

function renderMarkdown(report: TacticsReport): string {
  const ids = POSITIONS.map((position) => position.id)
  const lines: string[] = [
    '# 战术探针结果',
    '',
    `生成时间：${report.generatedAt}　负载：${report.loadAverage?.toFixed(2) ?? '?'}`,
    '',
    '判据只依赖 `core/rules` 与独立证明器；「必败局面」不计入通过率。',
    '',
    '## 通过率',
    '',
    '| 档位 | 通过 | 失败 | 诊断 | 预算 |',
    '| --- | --- | --- | --- | --- |',
    ...report.tiers.map(
      (tier) => `| ${tier.label} | ${tier.passed} | ${tier.failed} | ${tier.diagnostic} | ${tier.budgetMs} ms |`,
    ),
    '',
    '## 逐题矩阵（✓ 通过 / ✗ 失败 / · 必败局面只记录）',
    '',
    `| 档位 | ${ids.join(' | ')} |`,
    `| --- | ${ids.map(() => '---').join(' | ')} |`,
    ...report.tiers.map((tier) => {
      const byId = new Map(tier.cases.map((item) => [item.position, item]))
      return `| ${tier.label} | ${ids.map((id) => SYMBOL[byId.get(id)!.verdict]).join(' | ')} |`
    }),
    '',
    '## 失败明细',
    '',
  ]

  const failures = report.tiers.flatMap((tier) =>
    tier.cases
      .filter((item) => item.verdict === 'fail')
      .map(
        (item) =>
          `- ${tier.label} ｜ ${item.position} ｜ 期望「${item.expected}」｜ 实际 ${formatMove(item.move)} ｜ ` +
          `${item.reason} / ${item.elapsedMs} ms`,
      ),
  )
  lines.push(...(failures.length === 0 ? ['无。'] : failures))

  lines.push(
    '',
    '## 时间紧张（预算 1 ms）',
    '',
    '| 档位 | 合法着法 | 原因 | 耗时 |',
    '| --- | --- | --- | --- |',
    ...report.tightBudget.map(
      (item) =>
        `| ${DIFFICULTY_LABELS[item.difficulty]} | ` +
        `${item.verdict === 'pass' ? '是' : '否'} | ${item.reason} | ${item.elapsedMs} ms |`,
    ),
    '',
  )

  return lines.join('\n')
}
