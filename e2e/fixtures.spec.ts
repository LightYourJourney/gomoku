import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

import { memoryGameRecords } from '../src/persist/gameRecords'
import { parseSavedPosition } from '../src/persist/positions'
import { decodeSession } from '../src/persist/storage'
import { gameContentKey, gamePayloadToRecordInput, toGameFile } from '../src/persist/transfer/format'
import { parsePositionText, toPositionFile } from '../src/persist/transfer/position'
import { parseImportText } from '../src/persist/transfer/validate'
import { DB_NAME } from '../src/persist/schema'
import type { GamePayload } from '../src/persist/transfer/format'

const FIXTURES = resolve(process.cwd(), 'docs/audit/fixtures/phase11e')
const load = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

test('旧版本夹具：外部文件、内部记录与会话都还能被当前解析器读取', async () => {
  const session = decodeSession(JSON.stringify(load('session-v1.json')))
  expect(session).toMatchObject({ schemaVersion: 2, resignedBy: null })
  expect(session?.moves).toHaveLength(3)

  const gameFile = load('game-v1.json')
  const game = parseImportText(JSON.stringify(gameFile))
  expect(game.ok).toBe(true)
  if (!game.ok || game.kind !== 'game') return
  const reexported = parseImportText(JSON.stringify(toGameFile(gamePayloadToRecordInput(game.game))))
  expect(reexported.ok).toBe(true)
  if (!reexported.ok || reexported.kind !== 'game') return
  expect(gameContentKey(reexported.game)).toBe(gameContentKey(game.game))

  const backupText = JSON.stringify(load('backup-v1.json'))
  const backup = parseImportText(backupText)
  expect(backup.ok).toBe(true)
  if (!backup.ok || backup.kind !== 'backup') return
  expect(backup.games).toHaveLength(2)
  expect(backup.progress?.completedLessons).toContain('rules')
  const storage = memoryGameRecords()
  expect(await storage.importMany(backup.games.map(gamePayloadToRecordInput))).toMatchObject({
    imported: 2,
    duplicates: 0,
  })
  expect(await storage.importMany(backup.games.map(gamePayloadToRecordInput))).toMatchObject({
    imported: 0,
    duplicates: 2,
  })

  const positionText = JSON.stringify(load('position-v1.json'))
  const position = parsePositionText(positionText)
  expect(position.ok).toBe(true)
  if (!position.ok) return
  const positionAgain = parsePositionText(
    JSON.stringify(toPositionFile(position.position, position.title, position.provenance)),
  )
  expect(positionAgain.ok).toBe(true)
  if (!positionAgain.ok) return
  expect([...positionAgain.position.board]).toEqual([...position.position.board])

  const saved = (load('positions-v1.json') as unknown[]).map(parseSavedPosition)
  expect(saved).toHaveLength(2)
  expect(saved.every((entry) => entry?.createdAt === null && entry.updatedAt === null)).toBe(true)
})

test('旧 v2 库：升级、导出完整备份、干净上下文恢复', async ({ page, browser }) => {
  test.setTimeout(90_000)
  const records = load('records-v1.json') as Record<string, unknown>[]
  const progress = load('progress-v1.json') as Record<string, unknown>

  await page.goto('/robots.txt')
  await page.evaluate(
    async ({ records, progress, dbName }) => {
      await new Promise<void>((resolve) => {
        const del = indexedDB.deleteDatabase(dbName)
        del.onsuccess = del.onerror = del.onblocked = () => resolve()
      })
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName, 2)
        req.onupgradeneeded = () => {
          req.result.createObjectStore('progress')
          req.result.createObjectStore('records', { keyPath: 'seq', autoIncrement: true })
        }
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['progress', 'records'], 'readwrite')
          tx.objectStore('progress').put(progress, 'learning')
          for (const record of records) tx.objectStore('records').put(record)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { records, progress, dbName: DB_NAME },
  )

  await page.goto('/')
  await page.getByRole('button', { name: '← 课程列表' }).click()
  await expect(page.getByTestId('learn-progress')).toContainText('已完成 1 / 8 节')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await expect(page.getByTestId(/^record-/)).toHaveCount(2)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '完整备份' }).click(),
  ])
  const backupPath = await download.path()
  expect(backupPath).not.toBeNull()
  const backup = JSON.parse(readFileSync(backupPath!, 'utf8')) as {
    games: GamePayload[]
    progress?: { completedLessons: string[] }
  }
  expect(backup.games).toHaveLength(2)
  expect(backup.progress?.completedLessons).toContain('rules')

  const context = await browser.newContext()
  const fresh = await context.newPage()
  try {
    await fresh.goto('/')
    await fresh.getByRole('button', { name: '复盘', exact: true }).click()
    await fresh.getByTestId('import-file').setInputFiles(backupPath!)
    await expect(fresh.getByRole('heading', { name: '导入预览' })).toBeVisible()
    await fresh.getByRole('button', { name: '确认导入' }).click()
    await expect(fresh.getByTestId('import-result')).toContainText('已导入 2 条')
    await expect(fresh.getByTestId(/^record-/)).toHaveCount(2)
    await fresh.reload()
    await fresh.getByRole('button', { name: '复盘', exact: true }).click()
    await expect(fresh.getByTestId(/^record-/)).toHaveCount(2)
  } finally {
    await context.close()
  }
})
