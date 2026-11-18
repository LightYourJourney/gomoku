import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

/*
 * 包体积门禁（gzip）。两条上限，**只许收紧**：
 *
 * - 入口：`dist/index.html` 引用的入口脚本，加上它 `modulepreload` 的分块——首屏真正要下的 JS。
 *   拆包（阶段 C）之后 `index-*.js` 不再保证只有一个，所以按 `index.html` 认入口，不按文件名。
 * - 总量：`dist/assets` 下全部 JS（含按页加载的分块与 Worker）。防止「把代码挪进分块」
 *   变成无限增长的出口。
 *
 * 2026-11-18 阶段 C 拆包后实测：入口约 98.5 kB、总量约 147.7 kB（构建号写进产物，随提交差几个字节）；上限取实测 + 约 10% 取整到千字节
 * （评估报告 §14 裁定 5 批准的那一次收紧；此前入口上限 135,000 B、没有总量上限）。
 */
const ENTRY_LIMIT = 108_000
const TOTAL_LIMIT = 162_000
const dir = 'dist'

let html
try {
  html = readFileSync(`${dir}/index.html`, 'utf8')
} catch {
  console.error(`✗ 找不到 ${dir}/index.html；先运行 yarn build`)
  process.exit(1)
}

// 逐个标签取属性，不依赖属性顺序：顺序一变就漏算 modulepreload，门禁会悄悄放宽。
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const scripts = [...html.matchAll(/<script\b[^>]*>/g)]
  .map(([tag]) => tag)
  .filter((tag) => attr(tag, 'type') === 'module')
  .map((tag) => attr(tag, 'src'))
const preloads = [...html.matchAll(/<link\b[^>]*>/g)]
  .map(([tag]) => tag)
  .filter((tag) => attr(tag, 'rel') === 'modulepreload')
  .map((tag) => attr(tag, 'href'))
if ([...scripts, ...preloads].some((url) => url === undefined)) {
  console.error('✗ index.html 里有缺地址的入口脚本或 modulepreload')
  process.exit(1)
}
if (scripts.length !== 1) {
  console.error(`✗ 期望 index.html 里恰好一个入口脚本，实际 ${scripts.length} 个`)
  process.exit(1)
}

/** `index.html` 里的地址 → `dist` 下的文件。地址带部署前缀（`VITE_BASE`）时只取 `assets/` 之后的部分。 */
const fileOf = (url) => {
  const at = url.indexOf('assets/')
  if (at === -1) {
    console.error(`✗ 认不出的脚本地址：${url}`)
    process.exit(1)
  }
  return `${dir}/${url.slice(at)}`
}
const gzipOf = (file) => gzipSync(readFileSync(file)).length

const entryFiles = [...scripts, ...preloads].map(fileOf)
const entry = entryFiles.reduce((sum, file) => sum + gzipOf(file), 0)
const all = readdirSync(`${dir}/assets`).filter((name) => name.endsWith('.js'))
const total = all.reduce((sum, name) => sum + gzipOf(`${dir}/assets/${name}`), 0)

let failed = false
if (entry > ENTRY_LIMIT) {
  console.error(`✗ 入口 JS gzip ${entry} B 超过预算 ${ENTRY_LIMIT} B（${entryFiles.join('、')}）`)
  failed = true
}
if (total > TOTAL_LIMIT) {
  console.error(`✗ 全部 JS gzip ${total} B 超过预算 ${TOTAL_LIMIT} B（${all.length} 个文件）`)
  failed = true
}
if (failed) process.exit(1)
console.log(`✓ 入口 JS gzip ${entry} B ≤ ${ENTRY_LIMIT} B（${entryFiles.length} 个文件）；全部 JS ${total} B ≤ ${TOTAL_LIMIT} B（${all.length} 个文件）`)
