import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // 部署到子路径时用 `VITE_BASE=/gomoku/ yarn build`；默认根路径。
  // 写成构建期常量而不是运行时读 location：资源 URL 一旦生成就没法改，
  // 让产物自己知道它被放在哪，比运行时猜可靠。
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    /*
     * **别让「不在模块图里的文件」触发整页重载。**
     *
     * dev server 的 watcher 盯着整个项目根目录。改 `src/` 下的源码走 HMR
     * （`src/lib/cx.ts` 这类会热更新、`src/main.tsx` 这类会整页刷新，都正常）；
     * 但改**根本不在模块图里**的文件——文档、e2e 用例、基准脚本——它无从热更新，
     * 于是向所有连着的前端广播一次**整页重载**。实测：碰一下 `docs/ROADMAP.md`
     * 就会把打开着的页面刷掉。
     *
     * 为什么必须挡住：`yarn e2e` 复用的就是这个 dev server
     * （`playwright.config.ts` 的 `reuseExistingServer`）。于是「跑着 e2e、
     * 顺手改个文档」＝ 把正在跑的那条用例整页刷新掉，表现为一条与改动毫无关系的
     * 断言超时。`FINDINGS.md` 的 F-30 就是这么来的——刷新后会话从 localStorage
     * 恢复、AI 那一手被补完、状态条也变回「轮到你落子」，但棋盘是**新挂载**的，
     * `hasEverFocusedRef` 归零，没人再把焦点送回棋盘。
     *
     * 两个方向都实测过（`e2e` 里临时探针，用完已删）：加上这行之后，
     * 文档 / 用例 / 基准改动不再触发刷新，而改 `src/main.tsx` 仍然会整页刷新。
     */
    watch: {
      ignored: ['**/*.md', '**/docs/**', '**/e2e/**', '**/bench/**'],
    },
  },
  test: {
    environment: 'jsdom',
    // 主题对比度守卫要读 index.css 的原文（?raw）；关着 CSS 处理时它返回空串。
    css: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
