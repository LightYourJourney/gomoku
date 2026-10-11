import { defineConfig, devices } from '@playwright/test'

/**
 * 生产构建的冒烟通道。
 *
 * 与主配置分开是**有意的**：主配置的 webServer 跑的是 vite dev，
 * 而这里要验的是 `dist` 里的真实产物——Worker 的 module 路径、CSS 打包、
 * 代码分割在构建后与 dev 下并不一样，只有这一条通道能发现差异。
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
      name: 'prod',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      testMatch: '**/prod.spec.ts',
    },
  ],
  webServer: {
    // 每次都重新构建：这条通道的意义就是「验证刚构建出来的东西」，
    // 复用旧服务器等于验了个来历不明的产物。
    // --host 127.0.0.1 不能省：vite preview 默认只绑 localhost，可能落在 ::1 上，
    // 而 Playwright 探的是上面的 127.0.0.1，探测会一直失败到超时。
    command: `yarn build && yarn preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
