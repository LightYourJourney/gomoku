#!/usr/bin/env node
/*
 * 类型压制注释闸门：`tsconfig.pure.json` 费尽力气把 DOM 类型挡在外面，
 * 但一行注释就能整份解除——`// @ts-nocheck` 让该文件不再报任何类型错，
 * `/// <reference lib="dom" />` 把 DOM 类型库直接拉回来。两道都实测能过
 * `tsc -p tsconfig.pure.json` 与 `oxlint --deny-warnings`，所以必须单独查注释。
 *
 * 判据：
 *   1. 纯逻辑层（tsconfig.pure.json 的 include 范围：core / ai / learn / analysis，
 *      排除测试与 ai/worker.ts、ai/browserEngine.ts 两个外壳）里，
 *      `@ts-nocheck`、`@ts-ignore`、`@ts-expect-error`、三斜线 `<reference` 一律红。
 *      `@ts-expect-error` 现在全仓零处（2026-11-27 grep 确认），没有需要豁免的合法用法。
 *   2. `src` 全范围（含测试）禁 `@ts-nocheck`：它会把整个文件从类型检查里摘出去，
 *      放哪儿都不该有。`@ts-ignore` / `@ts-expect-error` 的全局禁令不在本脚本范围。
 *
 * 用法：`yarn check:suppressions`（在 `yarn gates` 里）。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SRC = resolve(REPO, 'src')
const require = createRequire(import.meta.url)
const ts = require('typescript')

const problems = []

/** 纯逻辑层禁的四种写法；行号按 1 起算，给人看的。 */
const PURE_BANNED = [
  { label: '@ts-nocheck', re: /@ts-nocheck\b/ },
  { label: '@ts-ignore', re: /@ts-ignore\b/ },
  { label: '@ts-expect-error', re: /@ts-expect-error\b/ },
  { label: '/// <reference', re: /^\s*\/\/\/\s*<reference\b/ },
]

function scan(file, patterns) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    problems.push(`读不到 ${file}：${err.message}`)
    return
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const { label, re } of patterns) {
      if (re.test(lines[i])) {
        problems.push(`${relative(REPO, file).split('\\').join('/')}:${i + 1} 出现了 ${label}`)
      }
    }
  }
}

// 判据 1 的文件集**从 tsconfig.pure.json 自己解析**：以后改 include / exclude，
// 这道闸门自动跟上，不用在这里再抄一份目录名。
const configPath = resolve(REPO, 'tsconfig.pure.json')
const read = ts.readConfigFile(configPath, ts.sys.readFile)
if (read.error !== undefined) {
  console.error(`✗ 读不了 tsconfig.pure.json：${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`)
  process.exit(2)
}
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO)
const configErrors = parsed.errors.filter((error) => error.category === ts.DiagnosticCategory.Error)
if (configErrors.length > 0) {
  console.error('✗ tsconfig.pure.json 解析报错，闸门不知道要查哪些文件：')
  for (const error of configErrors) console.error(`  - ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
  process.exit(2)
}
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) yield path
  }
}

/*
 * 文件集是**两处的并集**：
 *   - tsconfig.pure.json 解析出来的 include（改 include / exclude 时自动跟上）；
 *   - 四个纯逻辑层目录下所有非测试、非两个 Worker 外壳的 .ts/.tsx。
 * 第二份不是重复：有人把某个目录从 tsconfig 的 include 里拿掉，纯类型检查会就此
 * 漏掉它；这里的固定目录仍会扫，注释压制跑不掉。
 */
const LAYER_DIRS = ['core', 'ai', 'learn', 'analysis'].map((layer) => resolve(SRC, layer))
const WORKER_SHELLS = new Set([resolve(SRC, 'ai/worker.ts'), resolve(SRC, 'ai/browserEngine.ts')])
const pureSet = new Set(parsed.fileNames.filter((file) => /\.tsx?$/.test(file)).map((file) => resolve(file)))
for (const dir of LAYER_DIRS) {
  for (const file of walk(dir)) {
    if (/\.test\.tsx?$/.test(file) || WORKER_SHELLS.has(file)) continue
    pureSet.add(file)
  }
}
const pureFiles = [...pureSet]
if (pureFiles.length === 0) {
  console.error('✗ 纯逻辑层一个文件都没解析出来：闸门什么都没查，失败关闭')
  process.exit(2)
}
for (const file of pureFiles) scan(file, PURE_BANNED)

// 判据 2：src 全范围（含测试）禁 @ts-nocheck。已经出现在纯逻辑层里的不必重复报。
let srcFiles = 0
for (const file of walk(SRC)) {
  srcFiles += 1
  if (pureSet.has(file)) continue
  scan(file, [{ label: '@ts-nocheck', re: /@ts-nocheck\b/ }])
}
if (srcFiles === 0) {
  console.error('✗ src 下一个 .ts/.tsx 都没扫到：闸门什么都没查，失败关闭')
  process.exit(2)
}

if (problems.length > 0) {
  console.error(`✗ 类型压制注释：${problems.length} 处`)
  for (const line of problems) console.error(`  - ${line}`)
  console.error(
    '  纯逻辑层的 DOM 隔离靠 `tsc -p tsconfig.pure.json`；这些注释会把它整份解除，' +
      '所以纯逻辑层四种写法全禁、src 全范围禁 @ts-nocheck。规则见 AGENTS.md「硬性约束」。',
  )
  process.exit(1)
}
console.log(
  `✓ 类型压制：纯逻辑层 ${pureFiles.length} 个文件无 @ts-nocheck / @ts-ignore / @ts-expect-error / 三斜线 reference；` +
    `src 全范围 ${srcFiles} 个文件无 @ts-nocheck`,
)
