import { describe, expect, it } from 'vitest'
import { columnLabel, formatPoint, rowLabel } from './coords'

describe('columnLabel / rowLabel', () => {
  it('列从左到右是 A 到 O', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(7)).toBe('H')
    expect(columnLabel(14)).toBe('O')
  })

  it('行号从下往上数，最下面一行是 1', () => {
    expect(rowLabel(14)).toBe('1')
    expect(rowLabel(7)).toBe('8')
    expect(rowLabel(0)).toBe('15')
  })
})

describe('formatPoint', () => {
  it('左上角是 A15', () => {
    expect(formatPoint({ x: 0, y: 0 })).toBe('A15')
  })

  it('右下角是 O1', () => {
    expect(formatPoint({ x: 14, y: 14 })).toBe('O1')
  })

  it('天元是 H8', () => {
    expect(formatPoint({ x: 7, y: 7 })).toBe('H8')
  })
})
