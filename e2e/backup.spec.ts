import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 11A 的真实浏览器验收：文件真的被下载、真的从磁盘读回、真的穿过
 * IndexedDB 再刷新。校验器的单元测试不能证明这几件事。
 */

async function playNineMoveWin(page: Page): Promise<void> {
  await page.goto('/')
  // 应用会恢复 lastView；先显式切回对战，别假设当前停在哪个页面。
  await page.getByRole('button', { name: '对战', exact: true }).click()
  await page.getByRole('radio', { name: '本地双人' }).click()
  const moves: Array<[number, number]> = [
    [3, 7], [3, 9], [4, 7], [4, 9], [5, 7], [5, 9], [6, 7], [6, 9], [7, 7],
  ]
  for (const [x, y] of moves) await page.getByTestId(`intersection-${x}-${y}`).click()
  await expect(page.getByRole('dialog')).toContainText('黑棋获胜')
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await page.getByRole('button', { name: '复盘', exact: true }).click()
}

async function download(page: Page, name: string | RegExp): Promise<{ path: string; filename: string }> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name }).click(),
  ])
  const path = await file.path()
  expect(path).not.toBeNull()
  return { path: path!, filename: file.suggestedFilename() }
}

async function importFile(page: Page, path: string): Promise<void> {
  await page.getByTestId('import-file').setInputFiles(path)
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByTestId('import-result')).toBeVisible()
}

test('单盘导出 → 换一个干净浏览器上下文导入 → 回放与刷新后仍在', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await playNineMoveWin(page)

  const { path, filename } = await download(page, /导出棋谱/)
  expect(filename).toMatch(/^gomoku-lab-game-\d{14}\.json$/)

  const game = JSON.parse(readFileSync(path, 'utf8')) as {
    format: string
    formatVersion: number
    moves: unknown[]
  }
  expect(game.format).toBe('gomoku-lab.game')
  expect(game.formatVersion).toBe(1)
  expect(game.moves).toHaveLength(9)

  // 干净上下文 = 空 IndexedDB，等价于换设备。
  const context = await browser.newContext()
  const fresh = await context.newPage()
  await fresh.goto('/')
  await fresh.getByRole('button', { name: '复盘', exact: true }).click()
  await expect(fresh.getByText('还没有保存的对局')).toBeVisible()

  await importFile(fresh, path)
  expect(await fresh.getByTestId('import-result').textContent()).toContain('已导入 1 条')
  await expect(fresh.getByTestId(/^record-/)).toHaveCount(1)

  await fresh.getByTestId(/^record-/).first().click()
  // 回放从 0 手开始是空盘；拖到末手才看得到 9 枚棋子。
  await fresh.getByRole('slider', { name: '回放手数' }).fill('9')
  await expect(fresh.getByTestId(/^stone-/)).toHaveCount(9)

  await fresh.reload()
  await fresh.getByRole('button', { name: '复盘', exact: true }).click()
  await expect(fresh.getByTestId(/^record-/)).toHaveCount(1)
  await context.close()
})

test('完整备份 → 恢复棋谱、进度、偏好与会话；重复导入会跳过', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await playNineMoveWin(page)

  // 造一条学习进度，并切到深色；完整备份必须把它们带上。
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('gomoku-lab', 2)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('progress')) req.result.createObjectStore('progress')
          if (!req.result.objectStoreNames.contains('records')) {
            req.result.createObjectStore('records', { keyPath: 'seq', autoIncrement: true })
          }
        }
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('progress', 'readwrite')
          tx.objectStore('progress').put(
            {
              schemaVersion: 1,
              completedLessons: ['rules'],
              solvedPuzzles: [],
              lastVisited: null,
              lastView: 'learn',
            },
            'learning',
          )
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await page.evaluate(() => {
    localStorage.setItem(
      'gomoku-lab:settings',
      JSON.stringify({ state: { theme: 'dark', showCoords: false, soundEnabled: true }, version: 0 }),
    )
  })
  await page.reload()
  await page.getByRole('button', { name: '复盘', exact: true }).click()

  const { path } = await download(page, '完整备份')
  const backup = JSON.parse(readFileSync(path, 'utf8')) as {
    format: string
    games: unknown[]
    progress?: { completedLessons: string[] }
    preferences?: { theme: string }
    session?: { moves: unknown[] } | null
  }
  expect(backup.format).toBe('gomoku-lab.backup')
  expect(backup.games).toHaveLength(1)
  expect(backup.progress?.completedLessons).toContain('rules')
  expect(backup.preferences?.theme).toBe('dark')
  expect(backup.session?.moves).toHaveLength(9)

  const context = await browser.newContext()
  const fresh = await context.newPage()
  await fresh.goto('/')
  await fresh.getByRole('button', { name: '复盘', exact: true }).click()
  await fresh.getByTestId('import-file').setInputFiles(path)
  await expect(fresh.getByRole('heading', { name: '导入预览' })).toBeVisible()

  // 三个恢复开关都打开：进度、偏好、会话。
  for (const name of ['合并学习与残局进度', '恢复显示偏好', '恢复进行中的对局']) {
    const toggle = fresh.getByRole('switch', { name })
    if ((await toggle.getAttribute('aria-checked')) === 'false') await toggle.click()
  }
  await fresh.getByRole('button', { name: '确认导入' }).click()
  await expect(fresh.getByTestId('import-result')).toContainText('已导入 1 条')

  await expect(fresh.locator('html')).toHaveClass(/dark/)
  await fresh.getByRole('button', { name: '教学', exact: true }).click()
  await expect(fresh.getByText(/已完成 1 \/ 8 节/)).toBeVisible()
  await fresh.getByRole('button', { name: '对战', exact: true }).click()
  await expect(fresh.getByTestId(/^stone-/)).toHaveCount(9)

  // 恢复的是已经结束的 9 手局，终局弹窗会挡住导航。
  const dismiss = fresh.getByRole('button', { name: '看看棋盘' })
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click()

  // 同一份备份再导入一次：所有内容重复，0 新增。
  await fresh.getByRole('button', { name: '复盘', exact: true }).click()
  await fresh.getByTestId('import-file').setInputFiles(path)
  await expect(fresh.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await fresh.getByRole('button', { name: '确认导入' }).click()
  await expect(fresh.getByTestId('import-result')).toContainText('跳过重复 1 条')
  await expect(fresh.getByTestId(/^record-/)).toHaveCount(1)
  await context.close()
})

test('坏文件精确报错且零写入；取消预览也不写入', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'gomoku-import-'))
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, '{ this is not json', 'utf8')

  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByTestId('import-file').setInputFiles(bad)
  await expect(page.getByTestId('import-error')).toContainText('不是合法的 JSON')
  await expect(page.getByText('还没有保存的对局')).toBeVisible()

  // 合法文件取消预览同样零写入
  await playNineMoveWin(page)
  const { path } = await download(page, /导出棋谱/)
  await page.getByTestId('import-file').setInputFiles(path)
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByTestId(/^record-/)).toHaveCount(1)
})

test('v1 会话存档在真实浏览器里升级到 v2，旧棋局仍能恢复', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'gomoku-lab:session',
      JSON.stringify({
        schemaVersion: 1,
        moves: [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 8, y: 8 }],
        firstPlayer: 1,
        mode: 'pvp',
        humanColor: 1,
        difficulty: 'easy',
      }),
    )
  })
  await page.goto('/')

  await expect(page.getByTestId(/^stone-/)).toHaveCount(3)

  // 迁移是只读的：下一次真正落子时，存档才写成 v2。
  await page.getByTestId('intersection-9-9').click()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('gomoku-lab:session')))
    .toContain('"schemaVersion":2')
})
