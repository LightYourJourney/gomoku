import { defineConfig } from 'vitest/config'

/**
 * 学习内容的判题 / 求解基准。
 *
 * 与 `vitest.bench.config.ts` 分开：那份是引擎基准（会写 `bench/last-run.json`、
 * 被 `bench:check` 用来做数值门禁）；这份只量**教学交互里同步计算**的耗时，
 * 不做断言、不进 CI 门禁。
 *
 *   yarn bench:learn
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/learn.measure.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
