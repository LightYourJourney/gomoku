// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderMarkdown, writeReport, type ExperimentReport } from './report'
import { summarize, searchStats } from './stats'
import type { GameRecord, PairedGameSet } from './types'

/**
 * 报告的完整性测试。
 *
 * 「JSON 结果完整」不是一句形容：缺了 commit、缺了引擎指纹、缺了异常记录，
 * 这份报告就失去了追溯价值——事后没人能说清这些数字是哪份代码、在什么条件下跑出来的。
 */

function game(opening: string, black: string, white: string, outcome: GameRecord['outcome']): GameRecord {
  return {
    opening,
    black,
    white,
    outcome,
    winner: outcome === 'black-win' ? 1 : outcome === 'white-win' ? 2 : null,
    moves: [],
    error: null,
    failAtMove: null,
    elapsedMs: 5,
  }
}

const SETS: PairedGameSet[] = [
  {
    opening: 'o1',
    aBlack: game('o1', 'A', 'B', 'black-win'),
    bBlack: game('o1', 'B', 'A', 'draw'),
  },
]

function makeReport(startedAt: string): ExperimentReport {
  const resolved = {
    budgetMs: 1_000_000_000,
    maxDepth: 1,
    width: 12,
    threatPlies: 5,
    threatThrees: true,
    transposition: true,
  }
  return {
    meta: {
      commit: 'deadbeef',
      dirty: false,
      engineVersion: 'search-1',
      node: 'v26.0.0',
      platform: 'linux',
      arch: 'x64',
      cpuCount: 8,
      startedAt,
      finishedAt: startedAt,
      durationMs: 1000,
      mode: 'smoke',
      command: 'yarn strength',
      openingsVersion: '0123456789abcdef',
      statistics: {
        method: '配对 Bootstrap，以开局为簇重采样',
        bootstrapSamples: 100,
        bootstrapSeed: 1,
        clusterUnit: 'opening',
      },
      notes: ['测试用'],
    },
    a: {
      spec: { id: 'A', label: 'A', difficulty: 'medium', clock: 'fixed', maxDepth: 1 },
      resolved,
      digest: 'a'.repeat(64),
      kind: 'source',
    },
    b: {
      spec: { id: 'B', label: 'B', difficulty: 'medium', clock: 'fixed', maxDepth: 1 },
      resolved,
      digest: 'b'.repeat(64),
      kind: 'module',
    },
    openings: [{ id: 'o1', moves: [{ x: 7, y: 7 }] }],
    maxMoves: 100,
    repeats: 1,
    summary: summarize(SETS, 'A', 'B', { samples: 100, seed: 1 }),
    search: { a: searchStats(SETS, 'A'), b: searchStats(SETS, 'B') },
    games: SETS.flatMap((s) => [s.aBlack, s.bBlack]),
  }
}

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gomoku-report-'))
})

afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true })
})

describe('Markdown 摘要', () => {
  it('包含配置、结果、先后手、逐开局与搜索指标', () => {
    const markdown = renderMarkdown(makeReport('2026-10-20T00:00:00.000Z'))

    expect(markdown).toContain('# 强度评测：A vs B')
    expect(markdown).toContain('deadbeef')
    expect(markdown).toContain('search-1')
    expect(markdown).toContain('A 得分率')
    expect(markdown).toContain('A 执')
    expect(markdown).toContain('逐开局')
    expect(markdown).toContain('搜索指标')
    expect(markdown).toContain('局限')
  })

  it('未完成对局会单独成表，不会被混进胜率', () => {
    const withAnomaly: PairedGameSet[] = [
      {
        opening: 'o1',
        aBlack: game('o1', 'A', 'B', 'illegal-move'),
        bBlack: game('o1', 'B', 'A', 'move-limit'),
      },
    ]
    const report = { ...makeReport('2026-10-20T00:00:00.000Z'), summary: summarize(withAnomaly, 'A', 'B', { samples: 50 }) }
    const markdown = renderMarkdown(report)

    expect(markdown).toContain('未完成 / 异常')
    expect(markdown).toContain('非法着法')
    // 计分局数为 0 → 得分率显示为「—」，不是 0%
    expect(markdown).toContain('| **A 得分率** | **—** |')
  })
})

describe('JSON 落盘', () => {
  it('写出完整字段且可被重新解析', async () => {
    const written = await writeReport(makeReport('2026-10-20T00:00:00.000Z'), dir)
    const raw = JSON.parse(await readFile(written.jsonPath, 'utf8')) as ExperimentReport

    expect(raw.meta.commit).toBe('deadbeef')
    expect(raw.meta.engineVersion).toBe('search-1')
    expect(raw.meta.openingsVersion).toHaveLength(16)
    expect(raw.meta.statistics.clusterUnit).toBe('opening')
    expect(raw.a.resolved.maxDepth).toBe(1)
    expect(raw.a.digest).toHaveLength(64)
    expect(raw.b.kind).toBe('module')
    expect(raw.openings).toHaveLength(1)
    expect(raw.summary.tally.games).toBe(2)
    expect(raw.search.a.moves).toBe(0)
    expect(raw.games).toHaveLength(2)
    expect(raw.games[0]!.outcome).toBe('black-win')
  })

  it('结果文件路径回填到报告里，可从 Markdown 追到完整数据', async () => {
    const written = await writeReport(makeReport('2026-10-20T03:00:00.000Z'), dir)
    const raw = JSON.parse(await readFile(written.jsonPath, 'utf8')) as ExperimentReport

    expect(raw.meta.resultFile).toBe(written.jsonPath)
    // Markdown 也要带上，否则单独分发 Markdown 时追不回去
    const markdown = await readFile(written.markdownPath, 'utf8')
    expect(markdown).toContain(written.jsonPath)
  })

  it('同一时间戳跑两次也不覆盖，退到带序号的文件名', async () => {
    const stamp = '2026-10-20T04:00:00.000Z'
    const first = await writeReport(makeReport(stamp), dir)
    const second = await writeReport(makeReport(stamp), dir)

    expect(second.jsonPath).not.toBe(first.jsonPath)
    expect(second.markdownPath).not.toBe(first.markdownPath)
    // JSON 与 MD 必须同名同后缀序号，否则事后按名配对会错
    expect(second.jsonPath.replace(/\.json$/, '')).toBe(second.markdownPath.replace(/\.md$/, ''))
    expect(second.jsonPath).toMatch(/-2\.json$/)
    // 两份都能重新解析，先写的那份没有被第二次写入吃掉
    const firstRaw = JSON.parse(await readFile(first.jsonPath, 'utf8')) as ExperimentReport
    const secondRaw = JSON.parse(await readFile(second.jsonPath, 'utf8')) as ExperimentReport
    expect(firstRaw.meta.resultFile).toBe(first.jsonPath)
    expect(secondRaw.meta.resultFile).toBe(second.jsonPath)
  })

  it('两次实验各自成文件，不覆盖历史', async () => {
    await writeReport(makeReport('2026-10-20T01:00:00.000Z'), dir)
    await writeReport(makeReport('2026-10-20T02:00:00.000Z'), dir)

    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(new Set(files).size).toBe(files.length)
  })
})
