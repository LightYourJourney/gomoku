/*
 * 门禁脚本共用的小工具。
 *
 * 为什么要有这个文件：`bench/gate.mjs` 与两个棘轮各自抄过一份 `argValue` / `readJson` /
 * 形状校验骨架——`argValue` 两份**逐字相同**。而 `.jscpd.json` 的范围是 `src/`，
 * 抓不到这套门禁脚本自己。与其让「刚立起零容忍重复闸门的那个 diff 自己先有两份副本」，
 * 不如抽出来：改一处，三处都跟上。
 *
 * 这些函数会**直接 `process.exit`**——它们是给命令行脚本用的，不是通用库。
 * 门禁脚本读不到输入、基线形状不对时，正确行为就是立刻停。
 */

import { readFile } from 'node:fs/promises'

/** 取 `--flag value`。漏写值时给人话，而不是 `resolve(undefined)` 抛一串栈。 */
export function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`✗ ${name} 后面要跟一个路径，实际给的是：${v ?? '（没有）'}`)
    process.exit(2)
  }
  return v
}

/** 读一份 JSON。读不到就**响亮地失败**——静默跳过就是一条永远不红的判据。 */
export async function readJson(path, what, hint) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    console.error(`✗ 读不到${what}：${path}`)
    console.error(`  ${err.message}`)
    if (hint !== undefined) console.error(`  ${hint}`)
    process.exit(2)
  }
}

/**
 * 基线形状校验的统一出口。
 *
 * **没有它，基线丢一个字段就等于把对应判据悄悄关掉**：`?? []` 让判据跑 0 次、
 * `x < undefined` 恒为 false、`!row.gated` 让整行走进「跳过」分支——三条路都是
 * 印一句听起来很合理的理由，然后退出 0。所以要校验形状，而不是信任基线。
 *
 * @param {string[]} bad 收集到的问题描述；非空即停
 * @param {string} fileLabel 出问题时告诉人该去看哪个文件
 */
export function assertShape(bad, fileLabel) {
  if (bad.length === 0) return
  console.error(`✗ 基线形状不对（${fileLabel}）——${bad.length} 处：`)
  for (const b of bad.slice(0, 10)) console.error(`  - ${b}`)
  if (bad.length > 10) console.error(`  ……还有 ${bad.length - 10} 处`)
  console.error('  基线坏了就判不出东西，所以这里直接停：修好基线再跑。')
  process.exit(2)
}
