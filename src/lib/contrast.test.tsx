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
  ['--c-accent-fg', '--c-good'],
  ['--c-bg', '--c-fg'],
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

/**
 * 非文字组件的对比度（WCAG 1.4.11，阈值 3:1）。
 *
 * 焦点环是**唯一的**焦点指示——同一个提交把 gridcell 的 `outline` 关掉了
 * （SVG 里 outline 按用户坐标算，会画出半个棋盘大的框），所以它必须自己达标。
 *
 * 它可能压在四种底色上：木纹的亮端与暗端、黑子、白子。单色环做不到通吃
 * （浅色主题的深色环压在黑子上只有 2.25，暗色主题的浅色环压在白子上只有 2.4），
 * 所以画成一圈主色 + 一圈反色晕；判据是**两者之中至少有一个** ≥3:1。
 */
const RING_BACKGROUNDS = [
  '--c-board-a',
  '--c-board-b',
  '--c-stone-black-b',
  '--c-stone-white-a',
] as const

const MIN_NON_TEXT_RATIO = 3

/** 类名 → CSS 令牌。用法层靠它把「元素上写了什么」翻译成「实际是什么颜色」。 */
const SURFACE_CLASSES: Readonly<Record<string, string>> = {
  'bg-bg': '--c-bg',
  'bg-surface': '--c-surface',
  'bg-surface-2': '--c-surface-2',
  'bg-good-soft': '--c-good-soft',
  'bg-danger-soft': '--c-danger-soft',
  'bg-accent-soft': '--c-accent-soft',
  'bg-warn-soft': '--c-warn-soft',
  // 实心底（主按钮、完成徽标、结果药丸）
  'bg-accent': '--c-accent',
  'bg-good': '--c-good',
  'bg-fg': '--c-fg',
}

const TEXT_CLASSES: Readonly<Record<string, string>> = {
  'text-accent-fg': '--c-accent-fg',
  'text-bg': '--c-bg',
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

/**
 * 这个元素压在哪块底色上：**先看自己**，再往上找最近的带背景类名的祖先，
 * 都没有就是页面底色。
 *
 * 「先看自己」不能省：`bg-good text-accent-fg` 这种自带底色的元素，
 * 只看祖先会把父卡的浅底算成它的底色，判出一个根本不存在的问题。
 */
function backgroundToken(element: Element): string {
  let node: Element | null = element
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

describe.each(Object.entries(TOKENS))('非文字：%s 主题的焦点环', (_name, selector) => {
  const tokens = readTokens(selector)

  it.each(RING_BACKGROUNDS)('压在 %s 上时，环或它的晕至少有 3:1', (bg) => {
    const ring = tokens.get('--c-focus-ring')!
    const halo = tokens.get('--c-focus-halo')!
    const background = tokens.get(bg)!

    const best = Math.max(contrast(ring, background), contrast(halo, background))
    expect(Number(best.toFixed(2))).toBeGreaterThanOrEqual(MIN_NON_TEXT_RATIO)
  })
})

describe('用法层：源码里的组合都要登记在案', () => {
  it('没有未登记的「文字令牌 + 背景令牌」组合', () => {
    // 用法层的 DOM 走查只覆盖它渲染到的那几页；这条扫全部 tsx 源码，
    // 保证**任何新加的组合**都必须先写进 PAIRS（写进去就得核算对比度），
    // 不会因为「那页没被渲染到」而漏过去。
    const sources = import.meta.glob('../**/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    const registered = new Set(PAIRS.map(([fg, bg]) => `${fg}|${bg}`))
    const unregistered = new Set<string>()

    for (const [file, source] of Object.entries(sources)) {
      if (file.includes('.test.')) continue
      for (const match of source.matchAll(/'([^']*)'/g)) {
        const classes = match[1]!.split(/\s+/)
        const fg = classes.find((name) => name in TEXT_CLASSES)
        const bg = classes.find((name) => name in SURFACE_CLASSES)
        if (fg === undefined || bg === undefined) continue

        const key = `${TEXT_CLASSES[fg]!}|${SURFACE_CLASSES[bg]!}`
        if (!registered.has(key)) unregistered.add(`${key}（${file.split('/').pop()} 的 ${fg} + ${bg}）`)
      }
    }

    expect([...unregistered]).toEqual([])
  })
})

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

/**
 * 棋盘标记的三档色调必须**互相分得开**（任务书 §六「不同标记类型的颜色差异」）。
 *
 * **判据是 CIE76 的 ΔE，不是色相距离。** 初稿用的是色相距离，于是得出
 * 「accent 与 good 只差 33.5°，是弱区分」——那个结论是**判据选错导致的**：
 * 色相只是颜色三轴里的一轴，把它单独拎出来会漏掉明度与饱和度。
 * 换成 ΔE 之后实测 accent↔good 是 **28.6（浅）/ 27.4（深）**，
 * 远在「明显可分」的线（ΔE > 10）之上。
 *
 * **不改令牌**也正因为如此：两个颜色本来就分得开，改的是尺子不是颜色。
 * （`DESIGN_SYSTEM.md` §2.1 的「令牌一个都不改」在这里不必破例。）
 */
describe('棋盘标记的三档色调', () => {
  /** sRGB → CIE Lab（D65）。 */
  function lab(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ]
    const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    const [R, G, B] = [lin(r), lin(g), lin(b)]
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const [fx, fy, fz] = [f(x), f(y), f(z)]
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
  }

  /** CIE76 色差。经验线：> 10 一眼可分，2.3–10 要并排才看得出。 */
  function deltaE(a: string, b: string): number {
    const [l1, a1, b1] = lab(a)
    const [l2, a2, b2] = lab(b)
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
  }

  it.each(Object.entries(TOKENS))('%s 主题下，三档标记两两都分得开', (_n, selector) => {
    const tokens = readTokens(selector)
    const tones = {
      accent: tokens.get('--c-accent')!,
      good: tokens.get('--c-good')!,
      bad: tokens.get('--c-danger')!,
    }
    const names = Object.keys(tones) as Array<keyof typeof tones>

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const [x, y] = [names[i]!, names[j]!]
        expect(
          deltaE(tones[x], tones[y]),
          `${selector} 下 ${x} 与 ${y} 只差 ${deltaE(tones[x], tones[y]).toFixed(1)}（<10 需并排才看得出）`,
        ).toBeGreaterThanOrEqual(10)
      }
    }
  })
})
