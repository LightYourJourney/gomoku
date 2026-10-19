import { describe, expect, it } from 'vitest'
import { searchPathOf, type SearchReason } from './types'

/**
 * 搜索路径的**显式**分类。
 *
 * 界面不许靠 depth / nodes / elapsedMs 推断走了哪条路——那些是引擎的度量，
 * 不是语义。这里把 `SearchReason` 穷举映射成四类，所有消费方共用。
 */
describe('searchPathOf', () => {
  it('常规搜索', () => {
    expect(searchPathOf('search')).toBe('search')
  })

  it('预算耗尽 → aborted（不是「结论」而是「中止」）', () => {
    expect(searchPathOf('timeout')).toBe('aborted')
  })

  it('无棋可走 → none', () => {
    expect(searchPathOf('no_move')).toBe('none')
  })

  it('规则 / 快速路径：直接成五、必防、开局天元', () => {
    for (const reason of ['win', 'block', 'opening'] as const) {
      expect(searchPathOf(reason)).toBe('shortcut')
    }
  })

  it('六种 reason 全部有类别，不存在「未分类」', () => {
    const reasons: readonly SearchReason[] = [
      'win',
      'block',
      'search',
      'opening',
      'timeout',
      'no_move',
    ]

    expect(reasons.map(searchPathOf)).toEqual([
      'shortcut',
      'shortcut',
      'search',
      'shortcut',
      'aborted',
      'none',
    ])
  })
})
