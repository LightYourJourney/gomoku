#!/usr/bin/env node
/*
 * 依赖方向门禁：分层规则由机器守，不再靠每轮审计手工 grep。
 *
 * 规则出处是 `AGENTS.md` 的「硬性约束」与 `docs/ARCHITECTURE.md` 的「依赖方向」。
 * **改下面的允许表就是改分层**——先改 `ARCHITECTURE.md`，再改这里，提交信息写明。
 *
 * 两条判据：
 *   1. 跨层 import 必须在允许表里（键可以依赖值里的层或层下子路径；同层随意）；
 *      `TYPE_ONLY_ALLOWED` 里的目标只许 `import type` 引入。
 *      `src` 下不在表里的顶层目录或根文件一律红——新目录要显式归类，不能悄悄逃出门禁。
 *   2. 纯逻辑层（core / ai / analysis / learn）的生产文件，直接或**间接**都不得引入
 *      react / react-dom / zustand 以及测试与渲染库（@testing-library、vitest 等）。
 *      间接也要查：`learn → lib` 合法，但 `lib` 里有 React hook。
 *      纯逻辑层也不许有 `.tsx`：自动 JSX 运行时引入的 React 不是写出来的 import，图里看不见。
 *
 * 不查的：测试文件与 `src/test/`（组装场景时跨层是常态；被排除的文件连同指向它们的边都不进图，
 * 所以生产代码若 import 了 `src/test/` 下的东西，这里也看不见——那由 knip 与审查兜着）；
 * DOM 全局（`window`、`localStorage`……不是 import）由 `yarn lint` 守（`.oxlintrc.json` 的 `no-restricted-globals`，裁定 23），这里不查。
 *
 * 解析交给 madge（`check:cycles` 用的同一个解析器，含仅类型的 import）。madge 解析不了的
 * import 会进 `skipped`、在图里看不见——除了下面 `SKIPPABLE` 写明的两类，一律**失败关闭**。
 * 动态 `import()` **不进 skipped 也不能放过**：非字面量（纯逻辑层）直接红，字面量按普通
 * import 入图并计入「仅类型」判断（见 dynamicImports）。
 * 图是空的（madge 没扫到文件）同样失败关闭：一个什么都没查的门禁不能报绿。
 *
 * 用法：`yarn check:layers`（在 `yarn gates` 里）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SRC = resolve(REPO, 'src')
const require = createRequire(import.meta.url)
const madge = require('madge')
const ts = require('typescript')

/**
 * 键可以依赖值里的层。根（`App.tsx` / `main.tsx`）是组装点，可以依赖一切。
 * 值里的条目是层名（`core`，整层）或层下的子路径（`persist/transfer`，只放行这个目录 / 文件及其下）。
 */
const ALLOWED = {
  core: [],
  ai: ['core'],
  analysis: ['core', 'ai'],
  learn: ['core', 'ai', 'lib'],
  lib: ['core', 'ai'],
  persist: ['core', 'ai', 'lib'],
  sharing: ['core', 'persist/transfer'],
  store: ['core', 'ai', 'analysis', 'persist', 'lib'],
  components: ['core', 'ai', 'learn', 'lib'],
  features: ['core', 'ai', 'analysis', 'learn', 'lib', 'persist', 'sharing', 'store', 'components'],
}
/**
 * 只许**仅类型**引入的目标（条目写法同上）：每一条指向它的 import 都得是 `import type …`
 * 或 `export type … from`——编译后整条擦掉，运行期不加载那个模块。
 * `import { type X } from` **不算**：本项目开着 verbatimModuleSyntax，它编译成
 * `import {} from '…'`，模块（连同它的副作用与依赖，比如 IndexedDB 那一串）照样被加载。
 */
const TYPE_ONLY_ALLOWED = {
  sharing: ['persist/gameRecords'],
}
const ROOT_FILES = new Set(['App.tsx', 'main.tsx'])
const PURE = ['core', 'ai', 'analysis', 'learn']
/**
 * 纯逻辑层不许碰的 npm 包。除了 React / Zustand，还包括测试与渲染库：
 * `src/core` 里 `import { render } from '@testing-library/react'` 曾同时骗过
 * `tsconfig.pure.json`（它只清空 `types`，不阻止按需加载 .d.ts）与本文件（名单太窄）。
 * 生产文件对这些包没有合法用法（2026-11-27 grep 确认；只有 `src/test/setup.ts` 用，
 * 而测试文件不进图）。
 */
const FORBIDDEN_IN_PURE =
  /node_modules\/(?:@types\/)?(?:react|react-dom|zustand|vitest|jsdom|fake-indexeddb|@testing-library|@playwright)\//

/**
 * madge 解析不了的 import 不进图。只放过两种，其余一律失败关闭：
 * `?raw`（Vite 把文件当字符串读进来，不是模块依赖——只有测试在用）与
 * `index.css` 里的 `@import 'tailwindcss'`（样式，不是代码）。
 */
const SKIPPABLE = [/\?raw$/, /^tailwindcss$/]

const result = await madge(resolve(REPO, 'src'), {
  fileExtensions: ['ts', 'tsx'],
  includeNpm: true,
  tsConfig: resolve(REPO, 'tsconfig.app.json'),
  excludeRegExp: [/\.test\.tsx?$/, /^test\//, /\.css$/],
})
const graph = result.obj()
const problems = []
if (Object.keys(graph).length === 0) problems.push('依赖图是空的：madge 没扫到任何生产文件（路径或配置坏了），门禁失败关闭')

const unresolved = result.warnings().skipped.filter((spec) => !SKIPPABLE.some((re) => re.test(spec)))
for (const spec of unresolved) problems.push(`解析不了的 import：${spec}（图里看不见它，门禁失败关闭）`)

/** `src` 下相对路径 → 层名；根文件 → 'root'；不认识 → null。 */
function layerOf(file) {
  if (ROOT_FILES.has(file)) return 'root'
  const top = file.split('/')[0]
  return file.includes('/') && top in ALLOWED ? top : null
}

/**
 * 图上的一条边是不是 npm 包。
 *
 * 图里的键都是 `src` 下的相对路径，所以**以 `..` 开头的边不等于 npm 包**：
 * 只有解析到 `node_modules/` 里的才是（madge 打开 `includeNpm` 后把 `zustand`
 * 这类写成 `../node_modules/zustand/index.d.ts`）。其余以 `..` 开头的边是从 `src`
 * 经相对路径**逃出了 src 树**——以前这里一律 `continue`，于是 `src/core/x.ts`
 * 引入 `../../scripts/y.ts` 这种逃逸在图里既不归类也不查越层，整条隐了。
 */
function isNpmDep(dep) {
  return dep.startsWith('..') && resolve(SRC, dep).split(sep).includes('node_modules')
}

/** 解析后落在 `src` 之外的相对边——失败关闭，它绕过了整个分层判据。 */
function escapesSrc(dep) {
  if (!dep.startsWith('..') || isNpmDep(dep)) return false
  const abs = resolve(SRC, dep)
  return abs !== SRC && !abs.startsWith(SRC + sep)
}

/** 条目（层名或子路径）是否覆盖 `src` 下的这个依赖文件。 */
function entryCovers(entry, dep) {
  const bare = dep.replace(/\.tsx?$/, '')
  return bare === entry || bare.startsWith(`${entry}/`)
}

/** 相对模块说明符解析到实际文件；解析不到返回 `undefined`。 */
function resolveRelative(abs, spec) {
  const base = resolve(dirname(abs), spec)
  return [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')].find(
    (candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate),
  )
}

/**
 * `file` 里的动态 `import()`：字面量记下说明符，非字面量记 `null`（无法静态判定）。
 *
 * madge 能看见字面量动态 import（precinct 会解析 `import('x')`），但看不见
 * `const t = 'react'; await import(t)`；而且它不回答「这次引用是不是仅类型」。
 * 两件事都得自己走 AST。
 */
const dynamicCache = new Map()
function dynamicImports(file) {
  if (dynamicCache.has(file)) return dynamicCache.get(file)
  const abs = resolve(SRC, file)
  const source = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, false)
  const out = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      const literal =
        arg !== undefined && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
      out.push({
        spec: literal ? arg.text : null,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  dynamicCache.set(file, out)
  return out
}

/**
 * `file` 里指向各个 `src` 内目标的 import 是否**全部**为仅类型。返回 Map：目标（`src` 相对路径）→ 布尔。
 * 静态的 import / export-from 声明与动态 `import()` 都看：动态引用是运行期加载，
 * **不是**仅类型，同一个目标只要被动态引用过一次就记 false——否则一行
 * `import type` 就能把 `await import(同一个模块)` 洗白（实测曾如此）。
 */
const typeOnlyCache = new Map()
function typeOnlyImports(file) {
  if (typeOnlyCache.has(file)) return typeOnlyCache.get(file)
  const abs = resolve(SRC, file)
  const source = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, false)
  const out = new Map()
  for (const stmt of source.statements) {
    let typeOnly
    if (ts.isImportDeclaration(stmt)) typeOnly = stmt.importClause?.isTypeOnly === true
    else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier !== undefined) typeOnly = stmt.isTypeOnly
    else continue
    const spec = stmt.moduleSpecifier.text
    if (!spec.startsWith('.')) continue
    const hit = resolveRelative(abs, spec)
    if (hit === undefined) continue
    const target = relative(SRC, hit).split(sep).join('/')
    out.set(target, (out.get(target) ?? true) && typeOnly)
  }
  for (const { spec } of dynamicImports(file)) {
    if (spec === null || !spec.startsWith('.')) continue
    const hit = resolveRelative(abs, spec)
    if (hit === undefined) continue
    const target = relative(SRC, hit).split(sep).join('/')
    out.set(target, false)
  }
  typeOnlyCache.set(file, out)
  return out
}

function edgeAllowed(from, file, dep) {
  if (ALLOWED[from].some((entry) => entryCovers(entry, dep))) return true
  const typeOnly = TYPE_ONLY_ALLOWED[from] ?? []
  return typeOnly.some((entry) => entryCovers(entry, dep)) && typeOnlyImports(file).get(dep) === true
}

/*
 * 动态 import() 先过一遍：
 *   - 纯逻辑层的非字面量动态 import（`const t='react'; await import(t)`）无法静态判定，
 *     直接红——以前 madge 只把它丢进 `skipped` 就完事，门禁照样绿（实测）；
 *   - 字面量相对路径当作普通 import 入图：跨层允许表、越出 src、纯逻辑层可达性都看得见；
 *   - 字面量 npm 包在纯逻辑层按禁用名单判；
 *   - 相对路径解析不到就红（运行期会炸，门禁不该放过）。
 * 字面量动态 import 若已由 madge 入图，不重复添加；「是不是仅类型」由
 * typeOnlyImports 单独记 false。
 */
for (const file of Object.keys(graph)) {
  const from = layerOf(file)
  if (from === null) continue // 未归类的会在下面那一轮报
  const abs = resolve(SRC, file)
  for (const { spec, line } of dynamicImports(file)) {
    if (spec === null) {
      if (PURE.includes(from)) {
        problems.push(`纯逻辑层的动态 import 目标不是字面量：${file}:${line}（无法静态判定，失败关闭）`)
      }
      continue
    }
    if (!spec.startsWith('.')) {
      if (PURE.includes(from) && FORBIDDEN_IN_PURE.test(`../node_modules/${spec}/`)) {
        problems.push(`纯逻辑层引入了禁用包：${file}:${line} → import('${spec}')`)
      }
      continue
    }
    const hit = resolveRelative(abs, spec)
    if (hit === undefined) {
      problems.push(`动态 import 解析不到：${file}:${line} → '${spec}'（失败关闭）`)
      continue
    }
    if (!hit.startsWith(SRC + sep)) {
      problems.push(`越出 src：${file}:${line} → '${spec}'（解析到 ${hit}）`)
      continue
    }
    const dep = relative(SRC, hit).split(sep).join('/')
    if (!graph[file].includes(dep)) graph[file].push(dep)
  }
}

let crossEdges = 0
for (const [file, deps] of Object.entries(graph)) {
  const from = layerOf(file)
  if (from === null) {
    problems.push(`未归类：${file}（src 下的新顶层目录或根文件要在 quality/layers.mjs 里显式归类）`)
    continue
  }
  if (PURE.includes(from) && file.endsWith('.tsx')) {
    problems.push(`纯逻辑层不许有 .tsx：${file}（自动 JSX 运行时会引入 React，而图里看不见）`)
  }
  for (const dep of deps) {
    if (isNpmDep(dep)) continue // npm 包：判据 2 管
    if (escapesSrc(dep)) {
      // 从 src 经相对路径跑到 src 之外：既不会被归层，也不会被下面任何一条判据看到。
      problems.push(`越出 src：${file} → ${dep}（src 下的文件只能依赖 src 内的模块与 npm 包）`)
      continue
    }
    const to = layerOf(dep)
    if (to === null || to === from) continue // 未归类的会在它自己那一行报
    crossEdges += 1
    if (from !== 'root' && !edgeAllowed(from, file, dep)) {
      const typeOnly = (TYPE_ONLY_ALLOWED[from] ?? []).some((entry) => entryCovers(entry, dep))
      problems.push(
        `越层：${file} → ${dep}（${from} 不得依赖 ${to}` + (typeOnly ? '，这个目标只许 `import type` 引入' : '') + '）',
      )
    }
  }
}

// 判据 2：从每个纯逻辑文件出发做可达性搜索，记下第一条通到禁用包的路径
for (const start of Object.keys(graph)) {
  if (!PURE.includes(layerOf(start))) continue
  const seen = new Map([[start, null]])
  const queue = [start]
  let hit = null
  while (queue.length > 0 && hit === null) {
    const file = queue.shift()
    for (const dep of graph[file] ?? []) {
      if (seen.has(dep)) continue
      seen.set(dep, file)
      if (FORBIDDEN_IN_PURE.test(dep)) {
        hit = dep
        break
      }
      if (!dep.startsWith('..')) queue.push(dep)
    }
  }
  if (hit !== null) {
    const path = []
    for (let at = hit; at !== null; at = seen.get(at)) path.unshift(at)
    problems.push(`纯逻辑层引入了 React / Zustand / 测试渲染库：${path.join(' → ')}`)
  }
}

if (problems.length > 0) {
  console.error(`✗ 依赖方向：${problems.length} 处违规`)
  for (const line of problems) console.error(`  - ${line}`)
  console.error('  规则见 AGENTS.md 与 docs/ARCHITECTURE.md「依赖方向」；允许表在 quality/layers.mjs。')
  process.exit(1)
}
console.log(
  `✓ 依赖方向：${Object.keys(graph).length} 个生产文件、${crossEdges} 条跨层 import，均在允许表内；` +
    '纯逻辑层不引入 React / Zustand / 测试渲染库（含字面量动态 import）',
)
