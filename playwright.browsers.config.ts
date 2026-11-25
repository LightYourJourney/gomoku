import { defineConfig, devices } from '@playwright/test'

/**
 * 跨浏览器专项：只跑局面编辑器的主路径，用 Playwright 自带的 Firefox / WebKit。
 *
 * 不并入 `playwright.config.ts`：主套件统一用本机 Chrome，且移动/平板用例依赖
 * 触摸上下文；把整套 189 条复制到三个引擎只会放大环境噪声。编辑器是 Phase 11B
 * 新增交互最密集的页面，先用它验证「不只 Chrome 能用」。
 */
/**
 * 端口表（每条通道独占一个；`reuseExistingServer` 恒为 false，端口被占就响亮失败、不复用）：
 * 5181 e2e（dev）· 5182 e2e:prod（dist 预览）· 5183 render 探针 · 5184 ui 探针 ·
 * 5185 e2e:browsers · 5186 e2e:browsers:full。曾经这里与 prod 共用 5182：prod 通道的预览
 * 还没退出时跑本通道，测到的是 dist 而不是 dev 源码，照样全绿。
 */
const PORT = 5185
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: '**/editor.spec.ts',
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: '**/editor.spec.ts',
    },
  ],
  webServer: {
    command: `yarn vite --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: BASE_URL,
    // 恒为 false，理由同 playwright.config.ts：本地 5185 上坐着的可能是别的工作树的
    // dev server，复用它就是测别人的代码。--strictPort 让端口被占时直接起不来。
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
