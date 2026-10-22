import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BLACK, WHITE, type Point } from '../../core/types'
import { memoryGameRecords, type GameRecordInput } from '../../persist/gameRecords'
import { EMPTY_PROGRESS, type LearningProgress } from '../../persist/progress'
import { toBackupFile, toGameFile } from '../../persist/transfer/format'
import type { PersistedSession } from '../../persist/storage'
import { DataManagementPanel, type DataManagementServices } from './DataManagementPanel'

const MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 },
  { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 },
  { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

function record(): GameRecordInput {
  return {
    moves: [...MOVES],
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
  }
}

const PROGRESS: LearningProgress = {
  ...EMPTY_PROGRESS,
  completedLessons: ['rules'],
  solvedPuzzles: ['win-h'],
}

const SESSION: PersistedSession = {
  schemaVersion: 2,
  moves: [{ x: 7, y: 7 }],
  firstPlayer: BLACK,
  mode: 'pve',
  humanColor: WHITE,
  difficulty: 'easy',
  resignedBy: null,
}

function services(overrides: Partial<DataManagementServices> = {}): DataManagementServices {
  return {
    now: () => Date.UTC(2026, 9, 22, 15, 30, 0),
    loadProgress: async () => PROGRESS,
    loadSession: () => SESSION,
    preferences: () => ({ theme: 'dark', showCoords: false, soundEnabled: true }),
    onMergeProgress: vi.fn(async () => {}),
    onRestorePreferences: vi.fn(),
    onRestoreSession: vi.fn(),
    ...overrides,
  }
}

function fileOf(value: unknown): File {
  return new File([JSON.stringify(value)], 'import.json', { type: 'application/json' })
}

let blobs: Blob[] = []
let clicks: string[] = []

beforeEach(() => {
  blobs = []
  clicks = []
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobs.push(blob)
      return 'blob:test'
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.download)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function readBlob(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(blobs).toHaveLength(1))
  return JSON.parse(await blobs[0]!.text()) as Record<string, unknown>
}

describe('数据管理面板 · 导出', () => {
  it('导出全部棋谱：文件名由注入时钟决定，内容可被解析器读回', async () => {
    const storage = memoryGameRecords()
    await storage.put(record())
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={vi.fn()} degraded={false} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '导出全部棋谱' }))
    const payload = await readBlob()
    expect(clicks[0]).toBe('gomoku-lab-games-20261022153000.json')
    expect(payload.format).toBe('gomoku-lab.backup')
    expect(payload.games).toHaveLength(1)
    expect('progress' in payload).toBe(false)
  })

  it('完整备份包含棋谱、进度、偏好与会话', async () => {
    const storage = memoryGameRecords()
    await storage.put(record())
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={vi.fn()} degraded={false} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '完整备份' }))
    const payload = await readBlob()
    expect(payload).toMatchObject({
      format: 'gomoku-lab.backup',
      progress: { completedLessons: ['rules'], solvedPuzzles: ['win-h'] },
      preferences: { theme: 'dark', showCoords: false, soundEnabled: true },
      session: { moves: [{ x: 7, y: 7 }], resignedBy: null },
    })
  })

  it('空库导出全部棋谱时不伪造数据', async () => {
    render(
      <DataManagementPanel storage={memoryGameRecords()} services={services()} onImported={vi.fn()} degraded={false} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '导出全部棋谱' }))
    expect(await screen.findByTestId('import-error')).toHaveTextContent('空的')
    expect(blobs).toHaveLength(0)
  })
})

describe('数据管理面板 · 导入', () => {
  it('单盘导入：预览 → 确认 → 写入 → 结果', async () => {
    const storage = memoryGameRecords()
    const onImported = vi.fn()
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={onImported} degraded={false} />,
    )

    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileOf(toGameFile(record()))] },
    })
    expect(await screen.findByRole('heading', { name: '导入预览' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))

    expect(await screen.findByTestId('import-result')).toHaveTextContent('已导入 1 条')
    expect((await storage.list()).records).toHaveLength(1)
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('重复单盘：预览明确说会跳过，确认后仍是 1 条', async () => {
    const storage = memoryGameRecords()
    await storage.put(record())
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={vi.fn()} degraded={false} />,
    )

    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileOf(toGameFile(record()))] },
    })
    expect(await screen.findByText(/已经在库里/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '跳过重复' }))

    expect(await screen.findByTestId('import-result')).toHaveTextContent('跳过重复 1 条')
    expect((await storage.list()).records).toHaveLength(1)
  })

  it('取消预览不做任何写入', async () => {
    const storage = memoryGameRecords()
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={vi.fn()} degraded={false} />,
    )

    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileOf(toGameFile(record()))] },
    })
    await screen.findByRole('heading', { name: '导入预览' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('heading', { name: '导入预览' })).not.toBeInTheDocument()
    expect((await storage.list()).records).toHaveLength(0)
  })

  it('事务失败时明说没有写入，不冒充本次会话可用', async () => {
    const base = memoryGameRecords()
    const storage = {
      ...base,
      importMany: async () => ({
        imported: 0,
        duplicates: 0,
        persisted: false,
        storage: 'failed' as const,
      }),
    }
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={vi.fn()} degraded={false} />,
    )

    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileOf(toGameFile(record()))] },
    })
    await screen.findByRole('heading', { name: '导入预览' })
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))

    expect(await screen.findByTestId('import-result')).toHaveTextContent('没有写入任何棋谱')
    expect((await base.list()).records).toHaveLength(0)
  })

  it('坏 JSON 精确报错，零写入', async () => {
    const storage = memoryGameRecords()
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={vi.fn()} degraded={false} />,
    )

    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [new File(['{oops'], 'bad.json', { type: 'application/json' })] },
    })

    expect(await screen.findByTestId('import-error')).toHaveTextContent('不是合法的 JSON')
    expect((await storage.list()).records).toHaveLength(0)
  })

  it('备份导入：默认只合并进度，偏好与会话默认不覆盖', async () => {
    const storage = memoryGameRecords()
    const api = services()
    render(
      <DataManagementPanel storage={storage} services={api} onImported={vi.fn()} degraded={false} />,
    )

    const backup = toBackupFile({
      games: [record()],
      progress: PROGRESS,
      preferences: { theme: 'dark', showCoords: false, soundEnabled: true },
      session: SESSION,
    })
    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileOf(backup)] },
    })
    await screen.findByRole('heading', { name: '导入预览' })
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))

    expect(await screen.findByTestId('import-result')).toHaveTextContent('学习/残局进度：合并完成')
    expect(api.onMergeProgress).toHaveBeenCalledTimes(1)
    expect(api.onRestorePreferences).not.toHaveBeenCalled()
    expect(api.onRestoreSession).not.toHaveBeenCalled()
  })

  it('备份里一条无效棋谱：只导入有效的一条，并点名无效数量', async () => {
    const storage = memoryGameRecords()
    render(
      <DataManagementPanel storage={storage} services={services()} onImported={vi.fn()} degraded={false} />,
    )

    const good = JSON.parse(JSON.stringify(toGameFile(record())))
    const bad = { ...good, moves: [...good.moves, good.moves[0]] }
    const backup = { ...toBackupFile({ games: [] }), games: [good, bad] }
    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [fileOf(backup)] },
    })
    await screen.findByRole('heading', { name: '导入预览' })
    expect(screen.getByText(/无效 1 条/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))

    expect(await screen.findByTestId('import-result')).toHaveTextContent('无效 1 条')
    expect((await storage.list()).records).toHaveLength(1)
  })
})
