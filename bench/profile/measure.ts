/**
 * 微基准的小工具（Phase 10B）。
 *
 * 为什么不用 `performance.now()` 包一次调用就完事：
 * 在负载机器上单次测量抖得厉害，一次采样说明不了任何事。这里**先预热**，
 * 再跑若干批，每批内重复多次，最后报批均值的 min / 中位 / max。
 *
 * 为什么结果要写进 `sink`：V8 会把「结果没人用」的纯函数调用整个优化掉，
 * 测出来的就是 0。让每个结果都参与一次累加，是最便宜的防死代码消除手段。
 */

export interface Measurement {
  /** 每批的平均单次耗时（µs）。 */
  readonly minUs: number
  readonly medianUs: number
  readonly maxUs: number
  /** 测得的总调用次数（不含预热）。 */
  readonly calls: number
}

export const sink: { value: number } = { value: 0 }

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

export interface MeasureOptions {
  /** 预热调用次数。 */
  readonly warmup?: number
  /** 批数。 */
  readonly batches?: number
  /** 每批调用次数。 */
  readonly inner?: number
}

export function measureUs(fn: () => void, options: MeasureOptions = {}): Measurement {
  const warmup = options.warmup ?? 200
  const batches = options.batches ?? 7
  const inner = options.inner ?? 100

  for (let i = 0; i < warmup; i++) fn()

  const perCall: number[] = []
  for (let batch = 0; batch < batches; batch++) {
    const startedAt = performance.now()
    for (let i = 0; i < inner; i++) fn()
    perCall.push(((performance.now() - startedAt) / inner) * 1000)
  }

  return {
    minUs: Math.min(...perCall),
    medianUs: median(perCall),
    maxUs: Math.max(...perCall),
    calls: batches * inner,
  }
}

/**
 * 强制 GC（需要以 `--expose-gc` 运行，见 `vitest.profile.config.ts` 的 `execArgv`）。
 *
 * 内存测量不强制回收就会被「测量期间恰好发生的一次 GC」带偏：
 * 第一版量置换表时 heapUsed 反而是 **负增长**（-2.4 MiB），因为回收掉的对象比新建的多。
 */
function gcNow(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc
  if (typeof gc !== 'function') return false
  gc()
  return true
}

export interface RetainedBytes {
  readonly heap: number
  readonly external: number
  readonly gcAvailable: boolean
}

/** 前后各强制回收一次，再比较常驻堆。`fn` 必须把对象留住（否则会被回收掉）。 */
export function measureRetained(fn: () => void): RetainedBytes {
  const gcAvailable = gcNow()
  const before = process.memoryUsage()
  fn()
  gcNow()
  const after = process.memoryUsage()
  return {
    heap: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    gcAvailable,
  }
}
