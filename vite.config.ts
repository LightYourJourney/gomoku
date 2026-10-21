import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

import { ENGINE_VERSION } from './src/ai/version.ts'

/**
 * 构建版本标识。三样东西必须分得清，发布记录里也分开写：
 *
 *   - **应用版本**（`package.json`）：面向使用者的发布号；
 *   - **引擎版本**（`ENGINE_VERSION`）：搜索语义的版本，决策不变就不递增；
 *   - **提交号**：这次构建到底来自哪份源码。
 *
 * 注入 `index.html` 的 meta，`curl` 就能核对，不必打开页面，也不在运行时访问
 * GitHub。**不写构建时间**：那会让同一提交的两次构建产出不同哈希，而本项目
 * 靠「重复构建哈希一致」判断产物可复现。
 */
const APP_VERSION = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }
).version

function readCommit(): string {
  try {
    const cwd = import.meta.dirname
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
    // 只跟踪已跟踪文件的改动：`dist/`、测试报告等都是忽略项，不该让发布产物
    // 被标成 dirty；反过来，源码有未提交改动时必须标出来，不能冒充某个提交。
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd,
      encoding: 'utf8',
    }).trim()
    return dirty === '' ? sha : `${sha}-dirty`
  } catch {
    return 'unknown'
  }
}

const BUILD_COMMIT = readCommit()

function buildInfo(): Plugin {
  return {
    name: 'gomoku-build-info',
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { name: 'app-version', content: APP_VERSION }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'engine-version', content: ENGINE_VERSION }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'build-commit', content: BUILD_COMMIT }, injectTo: 'head' },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // 部署到子路径时用 `VITE_BASE=/gomoku/ yarn build`；默认根路径。
  // 写成构建期常量而不是运行时读 location：资源 URL 一旦生成就没法改，
  // 让产物自己知道它被放在哪，比运行时猜可靠。
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), buildInfo()],
  server: {
    /*
     * **别让「不在模块图里的文件」触发整页重载。**
     *
     * dev server 的 watcher 盯着整个项目根目录。改 `src/` 下的源码走 HMR
     * （`src/lib/cx.ts` 这类会热更新、`src/main.tsx` 这类会整页刷新，都正常）；
     * 但改 `.md` 会让打开着的页面**整页重载**——发这条消息的是
     * `@tailwindcss/vite` 的 `hotUpdate`：Tailwind v4 把 `.md` 也当内容源扫描，
     * 于是对这类改动直接 `full-reload`（它的扩展名白名单只放行
     * `.js/.ts/.jsx/.tsx/.mjs/.cjs/.mts/.cts` 与 CSS）。
     * 实测（内容改动，逐个单独跑）：`docs/ROADMAP.md` 会刷掉页面，而 `e2e/*.ts`、
     * `bench/*.mjs` **不会**。
     *
     * 为什么必须挡住：`yarn e2e` 复用的就是这个 dev server
     * （`playwright.config.ts` 的 `reuseExistingServer`）。于是「跑着 e2e、
     * 顺手改个文档」＝ 把正在跑的那条用例整页刷新掉，表现为一条与改动毫无关系的
     * 断言超时。`FINDINGS.md` 的 F-30 就是这么来的——刷新后会话从 localStorage
     * 恢复、AI 那一手被补完、状态条也变回「轮到你落子」，但棋盘是**新挂载**的，
     * `hasEverFocusedRef` 归零，没人再把焦点送回棋盘。
     *
     * 两个方向都实测过（`e2e` 里临时探针，用完已删）：加上这行之后 `.md` 改动不再
     * 触发刷新，而改 `src/main.tsx` 仍然会整页刷新。`e2e/` 与 `bench/` 留在清单里不是
     * 因为它们今天会触发（实测不会），而是为了让这条规则读起来就是它想做的那件事：
     * **应用源码之外的东西，一律不该驱动 dev server 刷新。**
     */
    watch: {
      // `quality/**` 是覆盖棘轮的基线（`quality/coverage.baseline.json`）——
      // 它不属于模块图，改了同样会整页重载，和 `docs/` 一个道理。
      ignored: ['**/*.md', '**/docs/**', '**/e2e/**', '**/bench/**', '**/quality/**'],
    },
  },
  test: {
    environment: 'jsdom',
    // 主题对比度守卫要读 index.css 的原文（?raw）；关着 CSS 处理时它返回空串。
    css: true,
    setupFiles: ['./src/test/setup.ts'],
    // `bench/strength` 是评测器自身的单元测试：它们必须与产品测试一样每次提交都跑，
    // 否则「评测器算错了」只会在真正做强度对比时才暴露（而那时更容易怀疑引擎）。
    include: ['src/**/*.test.{ts,tsx}', 'bench/strength/**/*.test.ts'],
    /*
     * 默认的 5 秒在**负载机器上会假红**——这条是量出来的，不是猜的。
     *
     * 实测：机器被别的任务压到约 4 倍慢时（一次全量套件从 ~20s 变成 ~86s），
     * 有 6 条用例超时，全部是「真跑搜索」或「交互密集」的那类：
     * `difficulty.test.ts` 的两条深度接线（5.1s / 9.9s）、`Board.test.tsx` 的
     * grid 语义（10.4s）、`BattleScreen.test.tsx` 的胜音（6.1s）、
     * `review.test.tsx` 的上一步/下一步禁用（5.9s）、`learn/screens.test.tsx` 的翻页（6.8s）。
     * 同一份代码在空载机器上连跑多次
     * 805 条全绿。
     *
     * 假红的代价不只是那一次失败：**它会让人开始不把红灯当回事**，
     * 而红灯是这个仓库「五条全绿才算完成」那条约定的全部价值所在。
     *
     * 取 15 秒是按实测定的——最坏的一条 10.4s，留约 45% 余量。放宽超时**不动任何
     * 断言**：真正卡死的用例照样会红，只是晚 10 秒。
     */
    testTimeout: 15_000,
    /*
     * **让每一次跑测都落一份完整报告到磁盘。**
     *
     * 起因是一次真实损失：某次全量跑红了一条用例，而我当时把输出管进了 `grep`，
     * 那条用例的名字就此丢掉——事后连跑八次都没再复现，只能记成「一次未定位的
     * 偶发」，追不下去了。**红灯的可追溯性不该依赖我当次有没有把输出看全。**
     *
     * 必须展开 `configDefaults.reporters`：自己配 `reporters` 会**替换**掉默认
     * 列表，而不是追加（那样终端就没有输出了）。
     *
     * 报告路径 `vitest-report.json`（已在 `.gitignore` 里）。要看失败清单：
     *   `python3 -c "import json;d=json.load(open('vitest-report.json'))
     *    print([t['fullName'] for r in d['testResults'] for a in r['assertionResults']
     *           if a['status']=='failed'])"`
     */
    reporters: [...configDefaults.reporters, ['json', { outputFile: 'vitest-report.json' }]],
  },
})
