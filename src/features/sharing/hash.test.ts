import { describe, expect, it } from 'vitest'
import { shouldResumeAiAfterHashChange } from './hash'

describe('shouldResumeAiAfterHashChange', () => {
  it('从分享页回到普通页面才续走', () => {
    expect(shouldResumeAiAfterHashChange('token', null)).toBe(true)
  })

  it('进入分享页不续走', () => {
    expect(shouldResumeAiAfterHashChange(null, 'token')).toBe(false)
  })

  it('普通页面之间换 hash 不续走', () => {
    expect(shouldResumeAiAfterHashChange(null, null)).toBe(false)
  })

  it('分享页换到另一个分享 token 不续走', () => {
    expect(shouldResumeAiAfterHashChange('old', 'new')).toBe(false)
  })
})
