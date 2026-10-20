// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadEngine } from './engines'
import { assertSpec, createLocalEngine } from './local'
import { boardOf, POSITIONS } from './positions'
import type { EngineSpec } from './types'

/**
 * 引擎装配的测试。
 *
 * 两条要证的事：
 * 1. **打包不改变行为**：把当前源码打成独立包之后，逐局面与进程内引擎给出
 *    相同着法。这同时钉住了「打包入口的参数装配与 `local.ts` 等价」。
 * 2. **两版对照不会串配置**：两个不同的引擎包各自返回自己的着法，
 *    id 与配置对不上时直接报错。
 */

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gomoku-engines-'))
})

afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true })
})

const SPEC: EngineSpec = {
  id: 'probe',
  label: 'probe',
  difficulty: 'easy',
  clock: 'fixed',
  maxDepth: 2,
}

describe('配置校验', () => {
  it('确定性模式必须显式给深度', () => {
    expect(() => assertSpec({ ...SPEC, maxDepth: undefined })).toThrow(/maxDepth/)
  })

  it('真实棋力评测不能固定深度', () => {
    expect(() => assertSpec({ ...SPEC, clock: 'real' })).toThrow(/固定深度/)
  })

  it('合法配置不抛错', () => {
    expect(() => assertSpec(SPEC)).not.toThrow()
    expect(() => assertSpec({ ...SPEC, clock: 'real', maxDepth: undefined, budgetMs: 100 })).not.toThrow()
  })

  it('当前源码没有可指纹化的文件，报告里记 null 而不是占位串', async () => {
    const loaded = await loadEngine(SPEC)
    expect(loaded.kind).toBe('source')
    expect(loaded.digest).toBeNull()
  })
})

describe('打包后的引擎与进程内引擎行为一致', () => {
  it('逐局面给出相同着法', async () => {
    const out = join(dir, 'engine.mjs')
    execFileSync('node', ['bench/strength/bundle-engine.mjs', '--root', REPO, '--out', out], {
      cwd: REPO,
      stdio: 'pipe',
    })

    const bundled = await loadEngine({ ...SPEC, module: out })
    const local = createLocalEngine(SPEC)

    expect(bundled.kind).toBe('module')
    expect(bundled.digest).toMatch(/^[0-9a-f]{64}$/)

    for (const position of POSITIONS) {
      const board = boardOf(position)
      const a = bundled.engine.choose(board.slice(), position.player)
      const b = local.choose(board.slice(), position.player)

      expect(a.move, `${position.id} 的着法不一致`).toEqual(b.move)
      expect(a.reason, `${position.id} 的 reason 不一致`).toEqual(b.reason)
      expect(a.depth, `${position.id} 的深度不一致`).toEqual(b.depth)
      expect(a.nodes, `${position.id} 的节点数不一致`).toEqual(b.nodes)
    }
  }, 180_000)
})

describe('两个引擎包不会互相污染', () => {
  async function writeEngine(
    name: string,
    point: { x: number; y: number },
    id = 'spec.id',
  ): Promise<string> {
    const path = join(dir, `${name}.mjs`)
    await writeFile(
      path,
      `export function createEngine(spec) {
  return {
    id: ${id},
    choose() {
      return { move: { x: ${point.x}, y: ${point.y} }, depth: 1, nodes: 1, ttHits: 0, reason: 'search', elapsedMs: 0 }
    },
  }
}
`,
      'utf8',
    )
    return path
  }

  it('各自返回自己的着法，指纹不同', async () => {
    const one = await writeEngine('one', { x: 1, y: 1 })
    const two = await writeEngine('two', { x: 5, y: 5 })

    const a = await loadEngine({ ...SPEC, id: 'one', module: one })
    const b = await loadEngine({ ...SPEC, id: 'two', module: two })

    const board = boardOf(POSITIONS[0]!)
    expect(a.engine.choose(board, 1).move).toEqual({ x: 1, y: 1 })
    expect(b.engine.choose(board, 1).move).toEqual({ x: 5, y: 5 })
    expect(a.digest).not.toBe(b.digest)
  })

  it('包返回的 id 与配置不一致时报错，而不是产出一份署错名的报告', async () => {
    const path = await writeEngine('mismatch', { x: 0, y: 0 }, "'someone-else'")
    await expect(loadEngine({ ...SPEC, id: 'expected', module: path })).rejects.toThrow(/不一致/)
  })

  it('包不存在时给出可操作的错误', async () => {
    await expect(loadEngine({ ...SPEC, id: 'ghost', module: join(dir, 'nope.mjs') })).rejects.toThrow(
      /引擎包不存在/,
    )
  })
})
