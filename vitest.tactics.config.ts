import { defineConfig } from 'vitest/config'

/**
 * 战术探针的运行配置。
 *
 * 与 `vitest.strength.config.ts` 分开：战术探针只问**一手**、不做完整对局，
 * 但五档 × 16 个局面也要几秒到几十秒；它同样**不进 CI 的常规门禁**。
 *
 *   yarn tactics
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/strength/tactics.run.ts'],
    disableConsoleIntercept: true,
    testTimeout: 10 * 60_000,
    hookTimeout: 60_000,
  },
})
