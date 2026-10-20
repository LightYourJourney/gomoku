import { defineConfig } from 'vitest/config'

/**
 * AI 强度评测的运行配置。
 *
 * 与 `vitest.bench.config.ts`（引擎数值基准）、`vitest.learn.config.ts`（教学耗时）
 * 分开：这一份会真的跑完整对局，耗时从几秒（smoke）到几十分钟（extended），
 * **不进 CI 的常规门禁**。
 *
 *   yarn strength
 *
 * 评测器自身的单元测试**不在这里**——它们在 `bench/strength/*.test.ts`，
 * 由 `yarn test` 跑（见 `vite.config.ts` 的 `include`）。那部分必须每次提交都绿。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/strength/run.ts'],
    /*
     * **不要拦截 console。**
     *
     * 默认情况下 vitest 会把用例里的 `console.log` 收进报告，只在失败时才展示；
     * 而这个入口的产物就是「一份人读的摘要 + 报告路径」——被吞掉之后，
     * 跑完只看得到 "1 passed"，根本不知道结果是什么、文件在哪。
     * 首跑实测确认过：不加这一行，摘要一行都不显示。
     */
    disableConsoleIntercept: true,
    // 一局最多几百手、每手可能几秒；整个实验可能很长，交给外层墙钟上限约束。
    testTimeout: 30 * 60_000,
    hookTimeout: 60_000,
  },
})
