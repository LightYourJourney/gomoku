import { describe, expect, it } from 'vitest'
// ?raw 由 Vite 提供：src 的 tsconfig 只带 vite/client 类型，读文件用不了 node:fs。
import cssSource from '../index.css?raw'

/**
 * 主题配色的对比度守卫。
 *
 * 这些组合是**界面上真实出现的**（例如提示标签是 `bg-good-soft text-good`、
 * 次要说明是 `text-faint`），不是理论搭配。Lighthouse 只审它跑到的那套主题，
 * 而浅色主题下 `good` / `warn` / `accent` 压在各自的浅底上曾经只有 3.5–4.05，
 * 所以这里按主题逐条算，两套都守住。
 *
 * 阈值取 WCAG AA 对正文的要求：4.5:1。
 */
const MIN_RATIO = 4.5

const TOKENS = {
  light: ':root',
  dark: '.dark',
} as const

/** 界面上真实出现的「文字色 / 背景色」组合。 */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--c-fg', '--c-surface'],
  ['--c-fg', '--c-surface-2'],
  ['--c-fg', '--c-bg'],
  ['--c-muted', '--c-surface'],
  ['--c-muted', '--c-surface-2'],
  ['--c-muted', '--c-bg'],
  ['--c-faint', '--c-surface'],
  ['--c-faint', '--c-surface-2'],
  ['--c-faint', '--c-bg'],
  ['--c-accent', '--c-surface'],
  ['--c-accent', '--c-accent-soft'],
  ['--c-accent', '--c-bg'],
  ['--c-accent-fg', '--c-accent'],
  ['--c-danger', '--c-danger-soft'],
  ['--c-danger', '--c-surface'],
  ['--c-good', '--c-good-soft'],
  ['--c-good', '--c-surface'],
  ['--c-warn', '--c-warn-soft'],
  ['--c-warn', '--c-surface'],
]

/** 从 CSS 里取某个选择器块内的变量表。 */
function readTokens(selector: string): Map<string, string> {
  const start = cssSource.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`index.css 里找不到 ${selector} 块`)

  const end = cssSource.indexOf('}', start)
  const block = cssSource.slice(start, end)
  const tokens = new Map<string, string>()

  for (const line of block.split('\n')) {
    const match = /^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line)
    if (match !== null) tokens.set(match[1]!, match[2]!)
  }
  return tokens
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => channel(Number.parseInt(full.slice(i, i + 2), 16)))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe.each(Object.entries(TOKENS))('%s 主题的对比度', (_name, selector) => {
  const tokens = readTokens(selector)

  it('变量齐全——少一个就说明这份守卫在自欺', () => {
    for (const [fg, bg] of PAIRS) {
      expect(tokens.has(fg), `${selector} 里没有 ${fg}`).toBe(true)
      expect(tokens.has(bg), `${selector} 里没有 ${bg}`).toBe(true)
    }
  })

  it.each(PAIRS)('%s 压在 %s 上不低于 4.5:1', (fg, bg) => {
    const ratio = contrast(tokens.get(fg)!, tokens.get(bg)!)
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(MIN_RATIO)
  })
})
