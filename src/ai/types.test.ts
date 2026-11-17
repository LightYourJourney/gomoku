import { describe, expect, it } from 'vitest'
import { confidenceOf, type SearchReason } from './types'

/**
 * 可靠度的**显式**分类。
 *
 * 一手是怎么得出来的、有多可靠，由 `reason` 与 `depth` 唯一决定——界面不许拿
 * nodes / elapsedMs 去猜。这张表钉的是此前倒挂过的那件事：搜完六层再超时不是
 * 「兜底」，只搜一层搜完了也不是「精确」。
 */
describe('confidenceOf', () => {
  it.each([
    ['win', 0, 'shortcut'],
    ['block', 0, 'shortcut'],
    ['opening', 0, 'shortcut'],
    ['no_move', 0, 'shortcut'],
    ['search', 1, 'complete'],
    ['search', 8, 'complete'],
    ['timeout', 6, 'partial'],
    ['timeout', 1, 'partial'],
    ['timeout', 0, 'fallback'],
    ['search', 0, 'fallback'],
  ] as const)('%s 深度 %i → %s', (reason, depth, expected) => {
    expect(confidenceOf(reason, depth)).toBe(expected)
  })

  it('六种 reason 全部有类别，不存在「未分类」', () => {
    const reasons: readonly SearchReason[] = ['win', 'block', 'search', 'opening', 'timeout', 'no_move']

    expect(reasons.map((reason) => confidenceOf(reason, 2))).toEqual([
      'shortcut',
      'shortcut',
      'complete',
      'shortcut',
      'partial',
      'shortcut',
    ])
  })

  it('超时但已经搜完若干层不是兜底——兜底只留给一层都没搜完的', () => {
    expect(confidenceOf('timeout', 7)).not.toBe('fallback')
    expect(confidenceOf('timeout', 0)).toBe('fallback')
  })
})
