import { Session } from 'node:inspector'

/**
 * V8 CPU Profiler 的最小封装。
 *
 * 用采样而不是在函数里插计时：插计时会改变内联与优化决策，而且
 * 「单次耗时 × 调用次数」并不等于真实占比（缓存、分支预测、去优化都不在里面）。
 *
 * 只剖析**当前进程**——调用方必须保证 vitest 用单进程跑（见 `vitest.profile.config.ts`）。
 */

export interface CpuProfileNode {
  readonly id: number
  readonly callFrame: {
    readonly functionName: string
    readonly url: string
    readonly lineNumber: number
  }
  readonly hitCount: number
}

export interface CpuProfile {
  readonly nodes: readonly CpuProfileNode[]
  readonly startTime: number
  readonly endTime: number
  readonly samples: readonly number[]
  readonly timeDeltas: readonly number[]
}

export interface FunctionRow {
  readonly name: string
  readonly url: string
  /** 自身耗时（µs）。误差与采样间隔同数量级。 */
  readonly selfUs: number
  readonly share: number
  readonly hits: number
}

export interface Aggregate {
  /** 采样覆盖的总时长（含 idle / GC / program）。 */
  readonly totalUs: number
  /** 去掉 idle 之后的时长。 */
  readonly busyUs: number
  readonly functions: readonly FunctionRow[]
  readonly gcUs: number
  readonly idleUs: number
  readonly programUs: number
  /** 名字为空的内联帧合计（V8 不给出可读函数名）。 */
  readonly anonymousUs: number
}

function post<T>(session: Session, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method as never, params, (error, result) => {
      if (error !== null) reject(error)
      else resolve(result as T)
    })
  })
}

function fileName(url: string): string {
  if (url === '') return '(native)'
  const parts = url.split('/')
  return parts[parts.length - 1] ?? url
}

export async function startProfiling(sampleIntervalUs = 100): Promise<Session> {
  const session = new Session()
  session.connect()
  await post(session, 'Profiler.enable')
  await post(session, 'Profiler.setSamplingInterval', { interval: sampleIntervalUs })
  await post(session, 'Profiler.start')
  return session
}

export async function stopProfiling(session: Session): Promise<CpuProfile> {
  const { profile } = await post<{ profile: CpuProfile }>(session, 'Profiler.stop')
  session.disconnect()
  return profile
}

export function aggregate(profile: CpuProfile): Aggregate {
  const byId = new Map<number, CpuProfileNode>()
  for (const node of profile.nodes) byId.set(node.id, node)

  const self = new Map<string, { name: string; url: string; us: number; hits: number }>()
  let totalUs = 0
  let gcUs = 0
  let idleUs = 0
  let programUs = 0
  let anonymousUs = 0

  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i] ?? 0
    totalUs += delta

    const node = byId.get(profile.samples[i]!)
    const name = node?.callFrame.functionName ?? '(unknown)'

    if (name === '(garbage collector)') {
      gcUs += delta
      continue
    }
    if (name === '(idle)') {
      idleUs += delta
      continue
    }
    if (name === '(program)' || name === '(root)') {
      programUs += delta
      continue
    }

    const url = node?.callFrame.url ?? ''
    if (name === '') anonymousUs += delta

    const key = `${name}@${url}`
    const entry = self.get(key) ?? { name: name === '' ? '(匿名)' : name, url, us: 0, hits: 0 }
    entry.us += delta
    entry.hits += 1
    self.set(key, entry)
  }

  const functions = [...self.values()]
    .sort((a, b) => b.us - a.us)
    .map((entry) => ({
      name: entry.name,
      url: fileName(entry.url),
      selfUs: Math.round(entry.us),
      share: totalUs === 0 ? 0 : entry.us / totalUs,
      hits: entry.hits,
    }))

  return {
    totalUs: Math.round(totalUs),
    busyUs: Math.round(totalUs - idleUs),
    functions,
    gcUs: Math.round(gcUs),
    idleUs: Math.round(idleUs),
    programUs: Math.round(programUs),
    anonymousUs: Math.round(anonymousUs),
  }
}

export const pct = (value: number): string => `${(value * 100).toFixed(1)}%`
export const ms = (us: number): string => `${(us / 1000).toFixed(1)} ms`
