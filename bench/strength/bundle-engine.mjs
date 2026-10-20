#!/usr/bin/env node
/**
 * 把某个源码树里的引擎打成一个独立 ESM 包：`node bench/strength/bundle-engine.mjs`。
 *
 * ## 用途
 *
 * 版本对照：「旧版本 vs 新版本」不能靠 `import` 两套源码——两套模块图会在同一个
 * 进程里共享模块级状态（置换表、常量表），旧代码还会被当前 `tsconfig` 与打包器
 * 一并处理。打成独立文件之后，旧版本就是「一个可加载的模块」，与当前源码零共享。
 *
 * ## 用法
 *
 * ```bash
 * # 当前源码
 * node bench/strength/bundle-engine.mjs --root . --out bench/strength/.engines/current.mjs
 *
 * # 历史版本（先建一个 worktree）
 * git worktree add /tmp/gomoku-base 7a08f32
 * node bench/strength/bundle-engine.mjs --root /tmp/gomoku-base --out bench/strength/.engines/7a08f32.mjs
 * ```
 *
 * ## 为什么入口是临时生成的
 *
 * 目标树可能是任意旧提交，不一定有本目录。所以入口写在系统临时目录里，
 * 只 import 目标树的 `src/ai/search.ts` 与 `src/ai/difficulty.ts`——
 * 也就是「旧版本自己的引擎与它自己的难度参数」。
 *
 * 生成的入口与 `bench/strength/local.ts` 的装配逻辑**必须等价**；
 * `engines.test.ts` 有一条用例把「当前源码打包后」与「进程内引擎」逐手比对，
 * 两者不一致就会红。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (value === undefined) throw new Error(`--${name} 缺少值`)
  return value
}

const root = resolve(argValue('root', REPO))
const out = resolve(argValue('out', join(REPO, 'bench/strength/.engines/current.mjs')))

/** 与 `local.ts` 的 `optionsFromSpec` 等价；改一边必须改另一边（测试会抓）。 */
const ENTRY = `
import { searchBoard, searchOptionsFor } from ${JSON.stringify(join(root, 'src/ai/search.ts'))}
import { DIFFICULTY_PARAMS } from ${JSON.stringify(join(root, 'src/ai/difficulty.ts'))}

const FIXED_BUDGET_MS = 1_000_000_000
const FIXED_CLOCK = () => 0

export function createEngine(spec) {
  const params = DIFFICULTY_PARAMS[spec.difficulty]
  if (params === undefined) throw new Error('未知难度：' + spec.difficulty)

  const base = searchOptionsFor(params, {
    budgetMs: spec.clock === 'fixed' ? FIXED_BUDGET_MS : spec.budgetMs,
  })
  const options = {
    ...base,
    ...(spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }),
    ...(spec.width === undefined ? {} : { width: spec.width }),
    ...(spec.transposition === undefined ? {} : { transposition: spec.transposition }),
    ...(spec.threatPlies === undefined ? {} : { threatPlies: spec.threatPlies }),
    ...(spec.threatThrees === undefined ? {} : { threatThrees: spec.threatThrees }),
  }
  const clock = spec.clock === 'fixed' ? FIXED_CLOCK : Date.now

  return {
    id: spec.id,
    choose(board, player) {
      const startedAt = clock()
      const outcome = searchBoard(board, player, options, clock)
      return {
        move: outcome.move,
        depth: outcome.depth,
        nodes: outcome.nodes,
        ttHits: outcome.ttHits,
        reason: outcome.reason,
        elapsedMs: clock() - startedAt,
      }
    },
  }
}
`

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'gomoku-engine-'))
  const entry = join(dir, 'entry.ts')

  try {
    await writeFile(entry, ENTRY, 'utf8')

    const { build } = await import('vite')
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: entry,
        outDir: dirname(out),
        emptyOutDir: false,
        target: 'node20',
        minify: false,
        rollupOptions: { output: { entryFileNames: out.split('/').pop(), format: 'es' } },
      },
    })

    console.log(`✓ 引擎包已生成：${out}`)
    console.log(`  来源：${root}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`✗ 打包失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
