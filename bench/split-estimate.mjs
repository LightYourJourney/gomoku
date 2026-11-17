/**
 * 按页拆包能省多少的**估算**：`yarn bench:split`。
 *
 * 回答的问题：入口包里，各页面「独占」的应用代码各有多大？
 * 做法：把页面组件按不同组合打成包（React / zustand 外置、压缩、取 gzip），再相减：
 *
 *   复盘组独占 = 全部页面 − （对战 + 教学 + 残局）
 *   教学组独占 = 全部页面 − （对战 + 复盘 + 分享）
 *
 * **这是估算，不是门禁口径**：
 *   - 这里量的是「只含应用代码、以页面组件为入口」的产物，`yarn check:bundle` 量的是含 React 的真实入口；
 *     两者的绝对值不可比，可比的是各组之间的差。
 *   - 真正拆包时公共模块归到哪个块由打包器决定，实际省下的会与这里有出入。
 * 真的做了按页加载之后，以 `yarn build` 的产物与 `yarn check:bundle` 为准，这份脚本即可删除。
 *
 * 用法：`yarn bench:split`（不需要先构建，也不需要起服务器）。
 *
 * 出处与首次结果：`docs/research/REFACTORING_ASSESSMENT.md` §4.4、§13。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SCREENS = {
  battle: ['BattleScreen', 'src/features/battle/BattleScreen'],
  learn: ['LearnScreen', 'src/features/learn/LearnScreen'],
  puzzles: ['PuzzleScreen', 'src/features/puzzles/PuzzleScreen'],
  review: ['ReviewScreen', 'src/features/review/ReviewScreen'],
  share: ['SharePreview', 'src/features/sharing/SharePreview'],
}

const COMBOS = {
  all: ['battle', 'learn', 'puzzles', 'review', 'share'],
  battleOnly: ['battle'],
  withoutReviewGroup: ['battle', 'learn', 'puzzles'],
  withoutLearnGroup: ['battle', 'review', 'share'],
}

async function gzipSizeOf(build, dir, name, screens) {
  const entry = join(dir, `${name}.ts`)
  const source = screens
    .map((key) => {
      const [symbol, path] = SCREENS[key]
      return `export { ${symbol} } from ${JSON.stringify(join(REPO, path))}`
    })
    .join('\n')
  await writeFile(entry, source, 'utf8')

  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      modulePreload: false,
      // 不用库模式：库模式的 ES 产物不压空白，量出来会虚高约 18%。
      // 应用模式默认会把「没人用」的入口导出摇掉（那样页面组件就全没了），所以要显式保留。
      rollupOptions: {
        input: entry,
        preserveEntrySignatures: 'strict',
        external: [/^react($|\/)/, /^react-dom($|\/)/, /^zustand($|\/)/],
      },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output)
  // 只数 JS：Worker 脚本是独立文件，本来就不在入口包里
  const code = outputs
    .filter((item) => item.type === 'chunk' && !/worker/i.test(item.fileName))
    .map((item) => item.code)
    .join('\n')
  return gzipSync(code).length
}

async function main() {
  const { build } = await import('vite')
  const dir = await mkdtemp(join(tmpdir(), 'gomoku-split-'))
  const sizes = {}
  try {
    for (const [name, screens] of Object.entries(COMBOS)) {
      sizes[name] = await gzipSizeOf(build, dir, name, screens)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB（${bytes} B）`
  console.log('\n=== 按页拆包估算（应用代码，不含 React / zustand；压缩后 gzip）===')
  console.log(`全部页面                 ${kB(sizes.all)}`)
  console.log(`只有对战页               ${kB(sizes.battleOnly)}`)
  console.log(`复盘 + 分享（独占部分）  ${kB(sizes.all - sizes.withoutReviewGroup)}`)
  console.log(`教学 + 残局（独占部分）  ${kB(sizes.all - sizes.withoutLearnGroup)}`)
  console.log('\n这是估算：真实拆包后以 yarn build 的产物与 yarn check:bundle 为准。')
}

main().catch((error) => {
  console.error(`✗ 估算失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
