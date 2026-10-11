import { describe, expect, it } from 'vitest'
import { MOTION, motionClass } from './motion'
// ?raw 由 Vite 提供：src 的 tsconfig 只带 vite/client 类型，
// 用 node:fs 会把 node 类型引进应用代码（那是 e2e/bench 才有的）。
import motionSource from './motion.ts?raw'

describe('motionClass', () => {
  it('每个键返回对应的类名', () => {
    expect(motionClass('stoneDrop')).toBe('motion-stone-drop')
    expect(motionClass('lastMovePulse')).toBe('motion-last-move-pulse')
    expect(motionClass('panelIn')).toBe('motion-panel-in')
    expect(motionClass('bannerIn')).toBe('motion-banner-in')
  })

  it('类名与 MOTION 表一一对应，没有拼错的字符串', () => {
    for (const [key, value] of Object.entries(MOTION)) {
      expect(motionClass(key as keyof typeof MOTION)).toBe(value)
    }
  })
})

describe('动效的降级策略', () => {
  it('实现里不出现 matchMedia —— 降级只由 CSS 媒体查询负责', () => {
    // 这是一条**设计约束的守卫**，不是行为测试：用 JS 判 matchMedia 有两个坑——
    // 用户中途改系统设置时分支不会更新；jsdom 里 matchMedia 缺失，靠它判定
    // 会让测试与真实行为脱节。真实行为由 e2e 在 reducedMotion: 'reduce'
    // 的浏览器上下文里断言 animation-name（见 e2e/a11y.spec.ts）。
    // 剥掉注释再找：注释里为解释「为什么不用它」提到这个词，不算违规
    const codeOnly = motionSource
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/\/\/[^\n]*/g, '')
    expect(codeOnly).not.toContain('matchMedia')
  })
})
