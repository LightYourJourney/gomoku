import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Engine, EngineSpec } from './types'
import { createLocalEngine } from './local'

/**
 * 引擎装配：当前源码，或一个**独立打包的历史引擎**。
 *
 * ## 为什么版本对照要打包，而不是复制源码
 *
 * 直接 `import` 两版源码会把两套模块图塞进同一个进程，`src/ai/*` 里凡是依赖
 * 模块级状态的（置换表、常量表）都会互相污染，而且生产入口会被迫认识评测。
 * 打包成一个自包含的 `.mjs` 之后，旧版本只是「一个可加载的模块」：
 * 它有自己的 `search.ts` 与 `difficulty.ts`，与当前源码零共享。
 *
 * 共享的只有**协议**：`Engine.choose` 的返回形状（见 `types.ts`）。
 * 打包脚本在 `bundle-engine.mjs`，它把目标源码树的 `src/ai/{search,difficulty}.ts`
 * 连同依赖打成一个文件——目标树可以是任意 `git worktree`。
 */

export interface LoadedEngine {
  readonly engine: Engine
  /**
   * 引擎包 SHA-256；当前源码为 `null`。
   *
   * 这里不能塞一个 `'source'` 之类的占位串——报告里「指纹」一列是要能直接比对的
   * 哈希，混进同形不同义的字符串会让读者以为那份源码也被指纹化过。
   */
  readonly digest: string | null
  /** 实际加载方式，进报告。 */
  readonly kind: 'source' | 'module'
}

interface EngineModule {
  createEngine?: (spec: EngineSpec) => Engine
}

export async function loadEngine(spec: EngineSpec): Promise<LoadedEngine> {
  if (spec.module === undefined) {
    return { engine: createLocalEngine(spec), digest: null, kind: 'source' }
  }

  const path = resolve(spec.module)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    throw new Error(`引擎包不存在：${path}（先用 node bench/strength/bundle-engine.mjs 生成）`)
  }

  const mod = (await import(pathToFileURL(path).href)) as EngineModule
  if (typeof mod.createEngine !== 'function') {
    throw new Error(`引擎包 ${path} 没有导出 createEngine()`)
  }

  const engine = mod.createEngine(spec)
  if (engine.id !== spec.id) {
    /*
     * id 不一致说明「配置」与「实现」来自不同来源——正是版本对照里最容易
     * 悄悄发生的混淆。宁可开跑前失败，也不要产出一份署错名的报告。
     */
    throw new Error(`引擎包返回的 id (${engine.id}) 与配置 (${spec.id}) 不一致`)
  }

  return {
    engine,
    digest: createHash('sha256').update(bytes).digest('hex'),
    kind: 'module',
  }
}
