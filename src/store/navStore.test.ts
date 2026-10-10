import { beforeEach, describe, expect, it } from 'vitest'
import { isView, useNavStore } from './navStore'

beforeEach(() => {
  useNavStore.setState({ view: 'battle' })
})

describe('navStore', () => {
  it('默认停在对战页', () => {
    expect(useNavStore.getState().view).toBe('battle')
  })

  it('go 切换视图', () => {
    useNavStore.getState().go('learn')
    expect(useNavStore.getState().view).toBe('learn')

    useNavStore.getState().go('puzzles')
    expect(useNavStore.getState().view).toBe('puzzles')
  })

  it('restore 认得已知的视图', () => {
    useNavStore.getState().restore('puzzles')

    expect(useNavStore.getState().view).toBe('puzzles')
  })

  it('restore 不认得的取值时不改变现状', () => {
    useNavStore.getState().go('learn')

    for (const bad of ['somewhere', 42, null, undefined, {}, ['learn']]) {
      useNavStore.getState().restore(bad)
      expect(useNavStore.getState().view).toBe('learn')
    }
  })
})

describe('isView', () => {
  it('只认三个已知视图', () => {
    expect(isView('battle')).toBe(true)
    expect(isView('learn')).toBe(true)
    expect(isView('puzzles')).toBe(true)
    expect(isView('battlefield')).toBe(false)
    expect(isView('')).toBe(false)
  })
})
