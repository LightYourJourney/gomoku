import { defineConfig } from 'vitest/config'

/**
 * 复盘「分差」口径的测量。
 *
 * 与 `vitest.bench.config.ts` 分开：那份是引擎基准（写 `bench/last-run.json`、
 * 被 `bench:check` 用来做数值门禁）；这份只输出三项统计，不做断言、不进 CI 门禁。
 *
 *   yarn bench:review-loss
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/review-loss.measure.ts'],
    // 复盘预算实验（ANALYSIS_BUDGET_PLAN）里高档位给足预算时单条可能超过 10 分钟
    testTimeout: 3_600_000,
    // 这份脚本的产物就是给人看的表：让 console.log 原样出现在终端
    disableConsoleIntercept: true,
  },
})
