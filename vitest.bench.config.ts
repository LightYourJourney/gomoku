import { defineConfig } from 'vitest/config'

/**
 * 基准专用配置。
 *
 * 与 `vite.config.ts` 分开，是因为基准不该混进 `yarn test`：它要跑一两分钟，
 * 结果也只对人看，不该在每次改代码时重复执行。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/**/*.bench.ts'],
    // 整套要跑一两分钟，默认的 5 秒远远不够
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
