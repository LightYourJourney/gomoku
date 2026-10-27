import { expect, test, type Page } from '@playwright/test'
import { BLACK, type Point } from '../src/core/types'
import { DB_NAME, RECORDS_STORE } from '../src/persist/schema'
import { seedGameRecords } from './helpers/seed'

const MOVES: readonly Point[] = [
  { x: 3, y: 7 }, { x: 3, y: 9 },
  { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 },
  { x: 6, y: 7 }, { x: 6, y: 9 },
  { x: 7, y: 7 },
]

async function recordCount(page: Page): Promise<number> {
  return page.evaluate(
    async ({ dbName, recordsStore }) => {
      const databases = await indexedDB.databases()
      if (!databases.some((db) => db.name === dbName)) return 0
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (!db.objectStoreNames.contains(recordsStore)) {
        db.close()
        return 0
      }
      const count = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(recordsStore, 'readonly')
        const req = tx.objectStore(recordsStore).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return count
    },
    { dbName: DB_NAME, recordsStore: RECORDS_STORE },
  )
}

async function shareGame(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByTestId(/^record-/).first().click()
  await page.getByRole('button', { name: '分享棋谱' }).click()
  await page.getByRole('button', { name: '分享整盘' }).click()
  const link = await page.getByTestId('share-link').inputValue()
  expect(link).toContain('#share=')
  await page.getByRole('button', { name: '复制链接' }).click()
  await expect(page.getByRole('button', { name: '已复制' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  await page.getByRole('button', { name: '关闭' }).click()
  return link
}

test('分享：A 复制链接、B 独立上下文预览、确认后保存、刷新仍在', async ({ browser, page }) => {
  test.setTimeout(60_000)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await seedGameRecords(page, [
    {
      schemaVersion: 1,
      moves: MOVES,
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    },
  ])
  const link = await shareGame(page)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  try {
    await pageB.goto(link)
    await expect(pageB.getByTestId('share-kind')).toContainText('单盘棋谱')
    // B 与 A 存储隔离；预览本身不写棋谱。
    expect(await recordCount(pageB)).toBe(0)

    await pageB.getByTestId('share-save').click()
    await expect(pageB.getByTestId('share-save-state')).toContainText('已保存')
    expect(await recordCount(pageB)).toBe(1)

    await pageB.reload()
    await expect(pageB.getByTestId('share-kind')).toContainText('单盘棋谱')
    await pageB.getByRole('button', { name: '← 返回应用' }).click()
    await expect(pageB.getByRole('navigation', { name: '主导航' })).toBeVisible()
    await pageB.getByRole('button', { name: '复盘', exact: true }).click()
    await expect(pageB.getByTestId(/^record-/)).toHaveCount(1)

    // 重复打开同一链接不重复写入。
    await pageB.goto(link)
    await pageB.getByTestId('share-save').click()
    await expect(pageB.getByTestId('share-save-state')).toContainText('已经在本地')
    expect(await recordCount(pageB)).toBe(1)

    // 同页历史前进/后退。
    await pageB.goto('/')
    await expect(pageB.getByRole('navigation', { name: '主导航' })).toBeVisible()
    await pageB.goto(link)
    await expect(pageB.getByTestId('share-kind')).toBeVisible()
    await pageB.goBack()
    await expect(pageB.getByRole('navigation', { name: '主导航' })).toBeVisible()
    await pageB.goForward()
    await expect(pageB.getByTestId('share-kind')).toBeVisible()
  } finally {
    await contextB.close()
  }

  // A 的原棋谱仍在，且没有被 B 的存储影响。
  await page.getByRole('button', { name: '← 棋谱列表' }).click()
  await expect(page.getByTestId(/^record-/)).toHaveCount(1)
})

test('分享：自由摆盘链接预览并保存为局面', async ({ browser, page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()
  await page.getByTestId('intersection-7-7').click()
  await page.getByLabel('局面名称').fill('分享测试')
  await page.getByRole('button', { name: '分享局面' }).click()
  await page.getByRole('button', { name: '分享当前局面' }).click()
  const link = await page.getByTestId('share-link').inputValue()
  await page.getByRole('button', { name: '关闭' }).click()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  try {
    await pageB.goto(link)
    await expect(pageB.getByTestId('share-kind')).toContainText('自定义局面')
    await pageB.getByTestId('share-save').click()
    await expect(pageB.getByTestId('share-save-state')).toContainText('已保存')

    await pageB.goto('/')
    await pageB.getByRole('button', { name: '复盘', exact: true }).click()
    await pageB.getByRole('button', { name: '局面研究' }).click()
    await expect(pageB.getByLabel('打开已保存局面')).toContainText('分享测试')
  } finally {
    await contextB.close()
  }
})

test('分享：损坏 Fragment 显示错误页，普通页面仍可使用', async ({ page }) => {
  await page.goto('/#share=1.00000000.***')
  await expect(page.getByTestId('share-error')).toBeVisible()
  await page.getByRole('button', { name: '← 返回应用' }).click()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
})
