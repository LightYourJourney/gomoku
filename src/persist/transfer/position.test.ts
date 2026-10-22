import { describe, expect, it } from 'vitest'
import { BLACK, type Point } from '../../core/types'
import { applyEdit, createPosition, positionFromReplay } from '../../core/position'
import { parsePositionText, toPositionFile } from './position'

const NINE_MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 },
  { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 },
  { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

describe('局面文件格式', () => {
  it('自由摆盘往返一致', () => {
    const position = applyEdit(createPosition(), { x: 7, y: 7 }, 'black')
    const parsed = parsePositionText(JSON.stringify(toPositionFile(position, '天元', null)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.title).toBe('天元')
    expect(parsed.provenance).toBeNull()
    expect([...parsed.position.board]).toEqual([...position.board])
    expect(parsed.position.nextPlayer).toBe(BLACK)
  })

  it('已知手顺可以证明可重放，并原样往返', () => {
    const loaded = positionFromReplay(NINE_MOVES, BLACK, 5)
    const parsed = parsePositionText(
      JSON.stringify(toPositionFile(loaded.position, '第 5 手', loaded.provenance)),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.provenance?.moves).toHaveLength(5)
    expect([...parsed.position.board]).toEqual([...loaded.position.board])
  })

  it('已知手顺与盘面不一致时拒绝', () => {
    const loaded = positionFromReplay(NINE_MOVES, BLACK, 5)
    const file = JSON.parse(
      JSON.stringify(toPositionFile(loaded.position, '坏手顺', loaded.provenance)),
    )
    file.stones.push({ x: 0, y: 0, color: 1 })
    const parsed = parsePositionText(JSON.stringify(file))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors[0]!.message).toContain('不一致')
  })

  it('重复交叉点被拒绝', () => {
    const file = JSON.parse(
      JSON.stringify(toPositionFile(createPosition(), null, null)),
    )
    file.stones = [
      { x: 1, y: 1, color: 1 },
      { x: 1, y: 1, color: 2 },
    ]
    const parsed = parsePositionText(JSON.stringify(file))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors[0]!.message).toContain('多次')
  })

  it('未来版本被拒绝', () => {
    const file = JSON.parse(
      JSON.stringify(toPositionFile(createPosition(), null, null)),
    )
    file.formatVersion = 2
    const parsed = parsePositionText(JSON.stringify(file))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors[0]!.message).toContain('不支持版本')
  })
})
