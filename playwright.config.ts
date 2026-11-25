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
      // 触屏用例必须在开了触摸的上下文里跑：桌面上下文里 page.touchscreen 直接抛错。
      // prod.spec.ts 属于生产构建通道（playwright.prod.config.ts），这里也不该收。
      testIgnore: ['**/mobile.spec.ts', '**/tablet.spec.ts', '**/prod.spec.ts'],
    },
    {
      name: 'mobile',
      // 触屏相关的要求（误触、页面滚动干扰）只有在真正开启触摸的上下文里才验得了。
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      testMatch: '**/mobile.spec.ts',
    },
    {
      name: 'tablet',
      // 平板横屏 1080×810：`lg` 断点（1024px）之上，走**两栏**布局（Phase 02 起
      // 三栏的起点是 1440，1080 落在 1024–1439 的两栏档；三栏那一档见 layout.spec.ts）。
      // iPad 的设备描述符自带 browserName: 'webkit'，得显式改回 chromium——
      // 本仓库统一用本机 Chrome，且 webkit 不认 channel: 'chrome'。
      use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium', channel: 'chrome' },
      testMatch: '**/tablet.spec.ts',
    },
  ],
  webServer: {
    command: `yarn vite --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: BASE_URL,
    // 恒为 false：不复用现成的 dev server，让 Playwright 自己起自己关。
    //
    // 以前是 `!process.env.CI`，本地会复用 5181 上已有的服务。可是这台机器的 5181
    // 上坐着的很可能是**别的工作树**的 dev server（多个 worktree / 多个 agent 并行时
    // 常态如此），于是本地 e2e 测的是别人的代码：那边绿这边红、或反过来，
    // 而且报错全指向与本改动无关的地方。--strictPort 让端口被占时 Playwright
    // 直接起不来——**这是期望的响亮失败**：要么先停掉占端口的服务，要么换端口，
    // 总之不测错东西。
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
