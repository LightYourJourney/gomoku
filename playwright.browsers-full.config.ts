import { defineConfig, devices } from '@playwright/test'

/** Firefox / WebKit 全量核心流程；触屏项目仍由 Chrome 的 mobile/tablet 项目覆盖。 */
const PORT = 5183
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'firefox-full',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ['**/mobile.spec.ts', '**/tablet.spec.ts', '**/prod.spec.ts'],
      // 键盘焦点顺序是浏览器 UA 行为；Chrome 主套件负责键盘矩阵。
      grepInvert: /键盘|结果弹窗的焦点/,
    },
    {
      name: 'webkit-full',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['**/mobile.spec.ts', '**/tablet.spec.ts', '**/prod.spec.ts'],
      // Safari 的 Tab 只走表单控件（默认不聚焦按钮），且 IndexedDB 不能可靠地挂起；
      // 这两类用例由 Chrome 负责，WebKit 只跑与 UA 无关的核心流程。
      grepInvert: /键盘|结果弹窗的焦点|进度没读出来时给占位/,
    },
  ],
  webServer: {
    command: `yarn vite --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
