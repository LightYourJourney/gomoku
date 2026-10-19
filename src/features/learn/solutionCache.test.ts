import { describe, expect, it, vi } from 'vitest'
import type { Point } from '../../core/types'
import type { Practice } from '../../learn/types'
import { createSolutionCache } from './solutionCache'

const PRACTICE = {
  prompt: '随便一道题',
  board: { lines: Array(15).fill('...............') },
  player: 1,
  goal: { kind: 'win' },
  hints: ['a', 'b'],
  solution: 'c',
} as Practice

const OTHER = { ...PRACTICE } as Practice

describe('createSolutionCache', () => {
  it('同一道题只解一次——重进这一题不再付求解开销', () => {
    const solve = vi.fn(() => ({ x: 4, y: 7 }) as Point)
    const get = createSolutionCache(solve)

    expect(get(PRACTICE)).toEqual({ x: 4, y: 7 })
    expect(get(PRACTICE)).toEqual({ x: 4, y: 7 })
    expect(solve).toHaveBeenCalledTimes(1)
  })

  it('不同的题各解各的', () => {
    const solve = vi.fn((practice: Practice) =>
      practice === PRACTICE ? { x: 1, y: 1 } : { x: 2, y: 2 },
    )
    const get = createSolutionCache(solve)

    expect(get(PRACTICE)).toEqual({ x: 1, y: 1 })
    expect(get(OTHER)).toEqual({ x: 2, y: 2 })
    expect(solve).toHaveBeenCalledTimes(2)
  })

  it('解不出来（null）不缓存——那可能是预算耗尽，下次还要再试', () => {
    const solve = vi
      .fn<(practice: Practice) => Point | null>()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ x: 1, y: 2 })
    const get = createSolutionCache(solve)

    expect(get(PRACTICE)).toBeNull()
    expect(get(PRACTICE)).toEqual({ x: 1, y: 2 })
    expect(solve).toHaveBeenCalledTimes(2)
  })
})
