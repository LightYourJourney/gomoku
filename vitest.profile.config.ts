import { defineConfig } from 'vitest/config'

/**
 * 性能剖析专用配置（Phase 10B）。
 *
 * 与 `yarn bench` 分开：这里跑的是**采样剖析**，输出的是一份 profile 与函数级
 * 自身耗时表，不是给门禁断言用的数字。两者混在一起会让 `bench:check` 的产物
 * 多出一堆与机器负载强相关、又不该被断言的字段。
 *
 * `maxWorkers: 1` + `fileParallelism: false`：`node:inspector` 的 Session 只能剖析
 * **当前进程**。默认的多进程池会把每个测试文件放进不同子进程，主进程里拿到的
 * profile 是空的，而且多进程并行本身就是性能测量的噪声源。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/profile/*.profile.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    // 内存测量前后要强制回收一次，否则「恰好发生的一次 GC」会让 heap 增量变成负数
    execArgv: ['--expose-gc'],
    // 让 console.log 原样出现在终端：这份脚本的产物就是给人看的表
    disableConsoleIntercept: true,
  },
})
