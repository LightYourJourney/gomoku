import { defineConfig, devices } from '@playwright/test'

const PORT = 5181
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
      name: 'chrome',
      // 用本机已安装的 Chrome，不额外下载 Chromium。
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      testIgnore: '**/mobile.spec.ts',
    },
    {
      name: 'mobile',
      // 触屏相关的要求（误触、页面滚动干扰）只有在真正开启触摸的上下文里才验得了。
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      testMatch: '**/mobile.spec.ts',
    },
  ],
  webServer: {
    command: `yarn vite --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
