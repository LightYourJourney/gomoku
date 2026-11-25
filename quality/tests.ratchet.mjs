#!/usr/bin/env node
/*
 * 测试条数棘轮：用例只许涨，不许跌。
 *
 * 为什么要有它：整套门禁里没有任何一处读测试条数——删掉一个 e2e 文件、给用例加个
 * `.skip`（`forbidOnly` 只拦 `.only`，拦不住 `.skip`），全绿。而那正是「安全网悄悄变小」。
 *
 * 四条判据：
 *   numTotalTests  ≥ 基线   删用例/删文件
 *   numPendingTests ≤ 基线  加 .skip
 *   numTodoTests    ≤ 基线  加 .todo
 *   e2e 总数        ≥ 基线  删 e2e 用例/文件
 *
 * 用法：`yarn check:tests`。前提是刚跑过 `yarn test`（它落盘 vitest-report.json）。
 */

import { readdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertShape, readJson } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

const baseline = await readJson(resolve(HERE, 'tests.baseline.json'), '基线')

/*
 * 基线形状校验。**没有它，基线里少一个键就等于把那条判据悄悄关掉**：
 * `5 < undefined` 为 false，于是「删掉 900 条用例 + 键名打错」会静默通过。
 */
{
  const bad = []
  for (const k of [
    'unitTotal',
    'unitPending',
    'unitTodo',
    'e2eTotal',
    'e2eSkipped',
    'e2eProdTotal',
    'e2eBrowsersTotal',
    'e2eBrowsersFullTotal',
  ]) {
    if (typeof baseline[k] !== 'number') bad.push(`${k} 不是数字（实际 ${JSON.stringify(baseline[k])}）`)
  }
  assertShape(bad, 'quality/tests.baseline.json')
}

// ── 单测条数（读 yarn test 落盘的报告）─────────────────────────────
let report
try {
  report = JSON.parse(await readFile(resolve(REPO, 'vitest-report.json'), 'utf8'))
} catch (err) {
  // 读不到就响亮失败。静默跳过＝一条永远不红的判据。
  console.error(`✗ 读不到 vitest-report.json：${err.message}`)
  console.error('  先跑 `yarn test` —— 这份报告是它的产物（钩子里就在它后面，CI 里同理）。')
  process.exit(2)
}

// ── e2e 条数（问 playwright 要，不去数字符）────────────────────────
/**
 * 逐个配置数用例。
 *
 * 只数默认配置是不够的：`e2e:prod`（7 条）、`e2e:browsers`（20 条）、
 * `e2e:browsers:full` 各有独立配置（当前条数见 `tests.baseline.json`），删掉其中一整条用例或缩小
 * `grepInvert`，默认配置的总数都不会变——安全网变小却全绿。
 */
function listE2e(extraArgs) {
  try {
    const out = execFileSync('yarn', ['playwright', 'test', '--list', ...extraArgs], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const m = out.match(/Total:\s*(\d+)\s+tests?/)
    return m ? { total: Number(m[1]), error: null } : { total: null, error: '输出里没有 `Total: N tests`' }
  } catch (err) {
    /*
     * **不能吞掉它的输出**：这一条本来最可能因为「自己写的 spec 有语法错 / 配置错」
     * 而失败，而那是要看报错才能修的。早先这里是个空 `catch {}`，
     * 于是任何原因都只表现为「playwright 没跑起来？」，把人往环境问题上引。
     */
    const stderr = (err.stderr ?? '').toString().trim()
    return {
      total: null,
      error:
        `playwright --list 失败（退出码 ${err.status ?? '?'}）` +
        (stderr === '' ? '' : `：\n${stderr.split('\n').slice(-6).join('\n')}`),
    }
  }
}

const defaultList = listE2e([])
const e2eTotal = defaultList.total
const e2eError = defaultList.error
const prodList = listE2e(['--config', 'playwright.prod.config.ts'])
const browsersList = listE2e(['--config', 'playwright.browsers.config.ts'])
const browsersFullList = listE2e(['--config', 'playwright.browsers-full.config.ts'])

/*
 * e2e 的**静态** skip 检查。
 *
 * 为什么不能靠 `playwright --list` 的数：给一条用例加 `test.skip` 之后它仍然是
 * `Total: 103 tests`（实测过），行首也不打任何标记——**跳过的用例在总数里照样算一个**。
 * 单测那边有 `numPendingTests` 兜着，e2e 这边没有等价的字段。
 * 所以这里直接扫 e2e/ 下所有 .ts 里的 skip/fixme/fail 标记，把「跳过」变成一个只许跌不许涨的数；
 * 跑完之后的运行期判据在 `quality/e2e-skips.mjs`（CI 的 e2e / browsers job 里接着跑）。
 */
/*
 * 覆盖所有把用例关掉的写法。判据：代码里（注释、字符串剥掉之后）**出现 `skip` / `fixme` / `fail`
 * 这三个词就算**——不要求是调用、不要求前面有点号（`.fail` 一并算：预期失败也是关判据）。
 * 早先要求 `.skip(` 紧跟括号，于是两处绕得过去（都实测过）：
 *   - 只取引用不当场调用：`const maybe = cond ? test : test.skip; maybe(…)`；
 *   - 解构 / 别名：`const { skip } = test`。
 * 再早先还列过固定前缀（`test.` / `testInfo.`……），形参换个名字就绕过去了。
 * 另外 `test['skip']` 这类字符串键单独查（`SKIP_KEY`，在保留字符串的版本上查）。
 * 三个词在 e2e/ 里目前没有任何合法用途（基线 0），误伤的代价是改个变量名。
 * 静态扫描认不出的写法（拼接出来的键、运行期条件）由 `quality/e2e-skips.mjs` 在跑完之后兜底。
 */
const SKIP_MARKER = /\b(skip|fixme|fail)\b/
const SKIP_KEY = /(['"`])(skip|fixme|fail)\1/

/**
 * 把注释与字符串字面量抹成空格（保留换行，行号才对得上）。
 *
 * 不剥的话，`// 这里不能写 test.skip(` 这类注释、以及含 `.skip(` 的用例标题都会误报。
 * 也不用「行首是 // 就跳过」那种粗办法——行尾注释照样骗得过去。
 * 只做剥壳，不追求完整词法：模板字符串里的 `${...}` 一律当字符串处理（那些位置的
 * 代码本来就少见，宁可漏看注释化的 `.skip(`，也不要把真实调用误判成注释）。
 */
function blankOutCommentsAndStrings(source, { keepStrings = false } = {}) {
  const out = source.split('')
  let state = 'code'
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line'
        out[i] = ' '
      } else if (c === '/' && next === '*') {
        state = 'block'
        out[i] = ' '
      } else if (c === "'" || c === '"' || c === '`') {
        state = c
        if (!keepStrings) out[i] = ' '
      }
    } else if (state === 'line') {
      if (c === '\n') state = 'code'
      else out[i] = ' '
    } else if (state === 'block') {
      if (c === '*' && next === '/') {
        out[i] = ' '
        out[i + 1] = ' '
        i += 1
        state = 'code'
      } else if (c !== '\n') {
        out[i] = ' '
      }
    } else {
      // 字符串里
      if (c === '\\') {
        if (!keepStrings) out[i] = ' '
        if (next !== undefined && next !== '\n') {
          if (!keepStrings) out[i + 1] = ' '
          i += 1
        }
      } else if (c === state || (state !== '`' && c === '\n')) {
        // 普通引号字符串不跨行：没闭合就当作结束，别把后面整份文件吞进字符串。
        if (!keepStrings) out[i] = ' '
        state = 'code'
      } else if (c !== '\n') {
        if (!keepStrings) out[i] = ' '
      }
    }
  }
  return out.join('')
}

// e2e/ 下**所有** .ts（含 helpers/ 与任何子目录）：跳过调用藏进 helper 函数里一样生效，只扫顶层 spec 就漏了。
const e2eSpecs = (await readdir(resolve(REPO, 'e2e'), { recursive: true }))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.split(sep).join('/'))
  .sort()
const skipHits = []
for (const f of e2eSpecs) {
  const source = await readFile(resolve(REPO, 'e2e', f), 'utf8')
  const code = blankOutCommentsAndStrings(source).split('\n')
  const withStrings = blankOutCommentsAndStrings(source, { keepStrings: true }).split('\n')
  code.forEach((line, i) => {
    if (SKIP_MARKER.test(line) || SKIP_KEY.test(withStrings[i])) skipHits.push(`e2e/${f}:${i + 1}`)
  })
}

const checks = [
  ['单测总数', report.numTotalTests, baseline.unitTotal, 'below', 'vitest-report.json 里没有这个字段'],
  ['单测被跳过的（.skip）', report.numPendingTests, baseline.unitPending, 'above', 'vitest-report.json 里没有这个字段'],
  ['单测待办的（.todo）', report.numTodoTests, baseline.unitTodo, 'above', 'vitest-report.json 里没有这个字段'],
  ['e2e 总数', e2eTotal, baseline.e2eTotal, 'below', e2eError ?? 'playwright --list 的输出里没找到总数'],
  ['e2e:prod 总数', prodList.total, baseline.e2eProdTotal, 'below', prodList.error ?? ''],
  ['e2e:browsers 总数', browsersList.total, baseline.e2eBrowsersTotal, 'below', browsersList.error ?? ''],
  [
    'e2e:browsers:full 总数',
    browsersFullList.total,
    baseline.e2eBrowsersFullTotal,
    'below',
    browsersFullList.error ?? '',
  ],
  [
    'e2e 被跳过的（.skip/.fixme）',
    skipHits.length,
    baseline.e2eSkipped,
    'above',
    skipHits.length > 0 ? `扫到这些标记：${skipHits.join('、')}` : '',
  ],
]

const failures = []
for (const [name, actual, expected, dir, why] of checks) {
  if (actual === null || actual === undefined) {
    failures.push(`${name}：拿不到数值 —— ${why}`)
    continue
  }
  const bad = dir === 'below' ? actual < expected : actual > expected
  if (bad) failures.push(`${name}：基线 ${expected} → 本次 ${actual}`)
}

if (failures.length > 0) {
  console.error(`✗ 测试条数棘轮：安全网变小了（${failures.length} 项）`)
  for (const f of failures) console.error(`  - ${f}`)
  // 光说「多了 1 个」没用，得点到是哪一行——报错读不懂，人就会去绕开闸门。
  if (skipHits.length > baseline.e2eSkipped) {
    console.error('  被跳过的用例在这些地方：')
    for (const h of skipHits) console.error(`    ${h}`)
  }
  console.error(
    '\n  这是有意的：删用例与跳用例都是把安全网改小。' +
      '\n  真要减，就显式改 quality/tests.baseline.json，并在提交信息里写明为什么。',
  )
  process.exitCode = 1
} else {
  console.log(
    `✓ 测试条数棘轮通过：单测 ${report.numTotalTests}（跳过 ${report.numPendingTests} / 待办 ${report.numTodoTests}）、` +
      `e2e ${e2eTotal}（扫了 e2e/ 下 ${e2eSpecs.length} 个 .ts，skip/fixme/fail 标记 ${skipHits.length} 个）`,
  )
}
