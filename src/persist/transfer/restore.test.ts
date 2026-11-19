import { describe, expect, it, vi } from 'vitest'
import { BLACK, WHITE, type Point } from '../../core/types'
import { memoryGameRecords } from '../gameRecords'
import { memoryPositions, type PositionStorage } from '../positions'
import { toGamePayload, type BackupPosition, type GamePayload } from './format'
import { restoreImport, type RestoreDeps, type RestorePlan } from './restore'

/**
 * 恢复备份的策略（评估报告 §5.5）：棋谱整笔失败则其余各段不动；进度 / 偏好 / 会话各自独立成败；
 * 局面逐条去重逐条写。组件测试（`DataManagementPanel.test.tsx`）照旧作集成层，这里直接钉策略本身。
 */

const FIVE: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 }, { x: 6, y: 7 }, { x: 6, y: 9 }, { x: 7, y: 7 },
]

function game(): GamePayload {
  return toGamePayload({ moves: FIVE, firstPlayer: BLACK, mode: 'pvp', humanColor: BLACK, difficulty: 'easy', resignedBy: null })
}

function position(at: number): BackupPosition {
  const cells = new Array<number>(225).fill(0)
  cells[at] = BLACK
  return { title: null, cells, nextPlayer: WHITE, provenance: null }
}

function backup(overrides: Partial<Extract<RestorePlan, { kind: 'backup' }>> = {}): RestorePlan {
  return {
    kind: 'backup',
    games: [game()],
    invalid: 0,
    progress: { completedLessons: ['rules'], solvedPuzzles: [], lastVisited: null, lastView: 'battle' },
    preferences: { theme: 'dark', showCoords: true, soundEnabled: false },
    session: null,
    positions: [position(0), position(1)],
    include: { progress: true, preferences: true, session: true, positions: true },
    ...overrides,
  }
}

function deps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    records: memoryGameRecords(),
    positions: memoryPositions(),
    mergeProgress: vi.fn(() => Promise.resolve()),
    restorePreferences: vi.fn(),
    restoreSession: vi.fn(),
    now: () => 1,
    ...overrides,
  }
}

describe('restoreImport —— 棋谱段', () => {
  it('写入抛错：整体失败、报原因，其余各段一律不碰', async () => {
    const d = deps({ records: { importMany: () => Promise.reject(new Error('库坏了')) } })

    expect(await restoreImport(backup(), d)).toEqual({ ok: false, error: '库坏了' })
    expect(d.mergeProgress).not.toHaveBeenCalled()
    expect(d.restorePreferences).not.toHaveBeenCalled()
  })

  it('备份的棋谱段整笔失败（配额）：其余各段不动，不做半恢复', async () => {
    const d = deps({
      records: { importMany: () => Promise.resolve({ imported: 0, duplicates: 0, persisted: false, storage: 'failed' }) },
    })

    const result = await restoreImport(backup(), d)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain('其余各段均未改动')
    expect(d.mergeProgress).not.toHaveBeenCalled()
    expect((await d.positions.list()).records).toHaveLength(0)
  })

  it('单盘棋谱整笔失败：照常给分项结果（没有别的段可保护）', async () => {
    const d = deps({
      records: { importMany: () => Promise.resolve({ imported: 0, duplicates: 0, persisted: false, storage: 'failed' }) },
    })

    const result = await restoreImport({ kind: 'game', game: game() }, d)

    expect(result).toMatchObject({ ok: true, outcome: { imported: 0, storage: 'failed', progress: 'absent' } })
  })
})

describe('restoreImport —— 各段独立成败', () => {
  it('全选：进度合并、偏好与会话恢复、局面写入', async () => {
    const d = deps()
    const plan = backup({ session: { moves: [], firstPlayer: BLACK, mode: 'pve', humanColor: BLACK, difficulty: 'easy', resignedBy: null } })

    const result = await restoreImport(plan, d)

    expect(result).toEqual({
      ok: true,
      outcome: {
        imported: 1, duplicates: 0, invalid: 0, persisted: false, storage: 'memory',
        progress: 'merged', preferences: 'restored', session: 'restored',
        positionsImported: 2, positionsDuplicates: 0, positionsFailed: 0, positionsMemory: 2,
      },
    })
  })

  it('没选中的段记 skipped，文件里没有的段记 absent', async () => {
    const result = await restoreImport(
      backup({ include: { progress: false, preferences: false, session: true, positions: false } }),
      deps(),
    )

    expect(result).toMatchObject({
      ok: true,
      outcome: { progress: 'skipped', preferences: 'skipped', session: 'absent', positionsImported: 0 },
    })
  })

  it('一段失败不影响别的段', async () => {
    const d = deps({
      mergeProgress: () => Promise.reject(new Error('进度写不进')),
      restorePreferences: () => {
        throw new Error('偏好写不进')
      },
    })

    const result = await restoreImport(backup(), d)

    expect(result).toMatchObject({ ok: true, outcome: { progress: 'failed', preferences: 'failed', positionsImported: 2 } })
  })

  it('无效棋谱条数原样带进结果', async () => {
    expect(await restoreImport(backup({ invalid: 3 }), deps())).toMatchObject({ ok: true, outcome: { invalid: 3 } })
  })
})

describe('restoreImport —— 局面逐条', () => {
  it('与库里已有的、以及文件内彼此重复的都算重复', async () => {
    const positions = memoryPositions()
    await restoreImport(backup({ positions: [position(0)] }), deps({ positions }))

    const result = await restoreImport(backup({ positions: [position(0), position(1), position(1)] }), deps({ positions }))

    expect(result).toMatchObject({ ok: true, outcome: { positionsImported: 1, positionsDuplicates: 2 } })
  })

  it('单条写失败只计这一条', async () => {
    const real = memoryPositions()
    let calls = 0
    const positions: PositionStorage = {
      ...real,
      save: (...args) => (++calls === 1 ? Promise.reject(new Error('写不进')) : real.save(...args)),
    }

    const result = await restoreImport(backup(), deps({ positions }))

    expect(result).toMatchObject({ ok: true, outcome: { positionsImported: 1, positionsFailed: 1 } })
  })

  it('列不出已有局面：整段计失败', async () => {
    const positions: PositionStorage = { ...memoryPositions(), list: () => Promise.reject(new Error('读不出')) }

    const result = await restoreImport(backup(), deps({ positions }))

    expect(result).toMatchObject({ ok: true, outcome: { positionsImported: 0, positionsFailed: 2 } })
  })
})
