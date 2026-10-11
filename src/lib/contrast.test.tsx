import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EMPTY_PROGRESS } from '../persist/progress'
import { useLearnStore } from '../store/learnStore'
// ?raw 由 Vite 提供：src 的 tsconfig 只带 vite/client 类型，读文件用不了 node:fs。
import cssSource from '../index.css?raw'
import { LearnScreen } from '../features/learn/LearnScreen'
import { PuzzleScreen } from '../features/puzzles/PuzzleScreen'

/**
 * 主题配色的对比度守卫。
 *
 * 两层：
 * 1. **令牌层**（本文件上半）：一组已知会相遇的令牌配对必须过 AA。
 * 2. **用法层**（下半）：把真实页面渲染出来，逐元素沿着 DOM 往上找它实际压在哪个
 *    底色上，再算对比度。
 *
 * 第二层是补上来的：第一层是白名单，**看不见「界面上真实出现了什么组合」**——
 * 「已完成课程卡」的摘要曾经是 `text-faint` 压在 `bg-good-soft` 上（暗色 4.10，
 * 不过 AA），白名单里没有这一对，两套主题又都跑过 Lighthouse 也没抓到
 * （它只审当前系统主题那一套）。用法层直接读页面，这类漏网就无处可藏。
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

/** 类名 → CSS 令牌。用法层靠它把「元素上写了什么」翻译成「实际是什么颜色」。 */
const SURFACE_CLASSES: Readonly<Record<string, string>> = {
  'bg-bg': '--c-bg',
  'bg-surface': '--c-surface',
  'bg-surface-2': '--c-surface-2',
  'bg-good-soft': '--c-good-soft',
  'bg-danger-soft': '--c-danger-soft',
  'bg-accent-soft': '--c-accent-soft',
  'bg-warn-soft': '--c-warn-soft',
}

const TEXT_CLASSES: Readonly<Record<string, string>> = {
  'text-fg': '--c-fg',
  'text-muted': '--c-muted',
  'text-faint': '--c-faint',
  'text-accent': '--c-accent',
  'text-danger': '--c-danger',
  'text-good': '--c-good',
  'text-warn': '--c-warn',
}

function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/)
}

/** 这个元素压在哪块底色上：最近的一个带背景类名的祖先，都没有就是页面底色。 */
function backgroundToken(element: Element): string {
  let node: Element | null = element.parentElement
  while (node !== null) {
    const found = classesOf(node).find((name) => name in SURFACE_CLASSES)
    if (found !== undefined) return SURFACE_CLASSES[found]!
    node = node.parentElement
  }
  return '--c-bg'
}

/** 遍历页面里所有写了文字色的元素，逐个核对它和实际底色的对比度。 */
function contrastProblems(container: HTMLElement, theme: keyof typeof TOKENS): string[] {
  const tokens = readTokens(TOKENS[theme])
  const problems: string[] = []

  for (const element of container.querySelectorAll('*')) {
    const textClass = classesOf(element).find((name) => name in TEXT_CLASSES)
    // 只看真正有文字的叶子节点，容器不算
    if (textClass === undefined || element.children.length > 0) continue
    const text = element.textContent?.trim()
    if (text === undefined || text === '') continue

    const bgToken = backgroundToken(element)
    const ratio = contrast(tokens.get(TEXT_CLASSES[textClass]!)!, tokens.get(bgToken)!)
    if (ratio < MIN_RATIO) {
      problems.push(
        `${textClass} 压在 ${bgToken} 上只有 ${ratio.toFixed(2)}:1（「${text.slice(0, 12)}」）`,
      )
    }
  }
  return problems
}

describe.each(['light', 'dark'] as const)('用法层：%s 主题下渲染出来的文字', (theme) => {
  // 组件读的是 CSS 变量在 <html> 上的类，这里对应地切换
  function withTheme(run: () => void): void {
    document.documentElement.className = theme === 'dark' ? 'dark' : ''
    try {
      run()
    } finally {
      document.documentElement.className = ''
    }
  }

  it('课程列表（含已完成的卡片）里没有读不清的文字', () => {
    useLearnStore.setState({
      progress: {
        ...EMPTY_PROGRESS,
        completedLessons: ['rules', 'open-two'],
        solvedPuzzles: ['win-h'],
      },
      loaded: true,
      view: 'learn',
    })

    withTheme(() => {
      const { container } = render(<LearnScreen />)
      expect(contrastProblems(container, theme)).toEqual([])
    })
  })

  it('残局列表（含已通过的卡片）里没有读不清的文字', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'], solvedPuzzles: ['win-h'] },
      loaded: true,
      view: 'puzzles',
    })

    withTheme(() => {
      const { container } = render(<PuzzleScreen />)
      expect(contrastProblems(container, theme)).toEqual([])
    })
  })
})
