import { defineConfig, devices } from '@playwright/test'

/**
 * 跨浏览器专项：只跑局面编辑器的主路径，用 Playwright 自带的 Firefox / WebKit。
 *
 * 不并入 `playwright.config.ts`：主套件统一用本机 Chrome，且移动/平板用例依赖
 * 触摸上下文；把整套 176 条复制到三个引擎只会放大环境噪声。编辑器是 Phase 11B
 * 新增交互最密集的页面，先用它验证「不只 Chrome 能用」。
 */
const PORT = 5182
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
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
