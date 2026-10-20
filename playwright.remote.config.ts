import { defineConfig, devices } from '@playwright/test'

/**
 * 对**已部署的线上站点**跑全量 e2e：`yarn e2e:remote`。
 *
 * 与另外两份配置的分工（三份都不能省）：
 *   - `playwright.config.ts`      dev server，验的是源码；
 *   - `playwright.prod.config.ts` 本机 `dist`，验的是构建产物；
 *   - 这一份                       真实托管，验的是**部署结果**——响应头、CDN、Worker
 *     chunk 的真实取件路径、跨域/缓存策略，这些只有在线上才成立。
 *
 * 为什么不复用 `playwright.prod.config.ts`：那份的 `webServer` 会自己起
 * `vite preview`；线上没有本地服务器可起，也不该有。
 *
 * 地址必须显式给或显式取默认值，**不猜**：
 *
 *   yarn e2e:remote                                  # 默认生产站
 *   REMOTE_BASE=https://xxx.pages.dev yarn e2e:remote # 预览部署
 *
 * 默认值写死是有意的：发布后最容易漏的一步就是「线上还没验」。把它做成一条
 * 命令，比每次现场拼 curl 更容易坚持。
 */
const FALLBACK_BASE = 'https://gomoku-lab.pages.dev'
const baseURL = process.env.REMOTE_BASE ?? FALLBACK_BASE

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  // 线上每一条都要走网络，比本地慢；并发压到 4，避免把对方的限流打出来。
  workers: 4,
  timeout: 45_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      // prod.spec.ts 断言的是本机构建通道，online 版由这一份配置自身覆盖。
      testIgnore: ['**/mobile.spec.ts', '**/tablet.spec.ts', '**/prod.spec.ts'],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      testMatch: '**/mobile.spec.ts',
    },
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium', channel: 'chrome' },
      testMatch: '**/tablet.spec.ts',
    },
  ],
})
