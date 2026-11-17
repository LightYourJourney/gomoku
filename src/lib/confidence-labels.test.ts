import { describe, expect, it } from 'vitest'
import type { Confidence } from '../ai/types'
import { CONFIDENCE_LABELS, FALLBACK_WARNING } from './confidence-labels'

describe('CONFIDENCE_LABELS', () => {
  it.each([
    ['shortcut', '规则/快速路径判定'],
    ['complete', '搜满档位深度'],
    ['partial', '限时内未搜满，取已搜完的层'],
    ['fallback', '一步贪心兜底'],
  ] as const)('%s → %s', (confidence, label) => {
    expect(CONFIDENCE_LABELS[confidence]).toBe(label)
  })

  it('四条文案里都没有数字——层数由旁边的「搜索深度」说，默认层也用得了', () => {
    const all: readonly Confidence[] = ['shortcut', 'complete', 'partial', 'fallback']
    for (const confidence of all) expect(CONFIDENCE_LABELS[confidence]).not.toMatch(/\d/)
  })

  it('没有哪一类还叫「精确」或「启发式」', () => {
    const text = Object.values(CONFIDENCE_LABELS).join('') + FALLBACK_WARNING
    expect(text).not.toContain('精确')
    expect(text).not.toContain('启发式')
  })

  it('兜底的警示语说清它是什么、且不保证最优', () => {
    expect(FALLBACK_WARNING).toBe('一层都没搜完，这一手只是一步贪心的估计，不保证最优。')
  })
})
