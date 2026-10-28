import { expect, test, type Page } from '@playwright/test'
import { BLACK, type Point } from '../src/core/types'
import { DB_NAME, RECORDS_STORE } from '../src/persist/schema'
import { seedGameRecords } from './helpers/seed'
import { createGameShare } from '../src/sharing/link'

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
    await expect(pageB.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
    // B 与 A 存储隔离；预览本身不写棋谱。
    expect(await recordCount(pageB)).toBe(0)

    await pageB.getByTestId('share-save').click()
    await expect(pageB.getByTestId('share-save-state')).toContainText('已保存')
    expect(await recordCount(pageB)).toBe(1)

    await pageB.reload()
    await expect(pageB.getByTestId('share-kind')).toContainText('单盘棋谱')
    await pageB.getByRole('button', { name: '← 返回应用' }).click()
    await expect(pageB.getByRole('navigation', { name: '主导航' })).toBeVisible()
    expect(pageB.url()).not.toContain('#share=')
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

test('分享：打开链接不自动续走本地对局，返回应用后才续走', async ({ page }) => {
  test.setTimeout(60_000)
  const token = createGameShare({
    seq: 1,
    schemaVersion: 1,
    moves: MOVES,
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
  })
  expect(token.ok).toBe(true)
  if (!token.ok) return

  await page.addInitScript(() => {
    localStorage.setItem(
      'gomoku-lab:session',
      JSON.stringify({
        schemaVersion: 2,
        moves: [{ x: 7, y: 7 }],
        firstPlayer: 1,
        mode: 'pve',
        humanColor: 1,
        difficulty: 'easy',
        resignedBy: null,
      }),
    )
  })
  await page.goto(`/#share=${token.token}`)
  await expect(page.getByTestId('share-kind')).toContainText('单盘棋谱')

  // 分享预览同样不应打开或升级本地数据库。
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).some((database) => database.name === 'gomoku-lab'),
    ),
  ).toBe(false)

  // 打开链接只恢复局面，不能借后台 AI 落子/入库。
  await page.waitForTimeout(1_500)
  const during = await page.evaluate(() => JSON.parse(localStorage.getItem('gomoku-lab:session') ?? 'null'))
  expect(during.moves).toHaveLength(1)

  await page.getByRole('button', { name: '← 返回应用' }).click()
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => localStorage.getItem('gomoku-lab:session'))
      return (JSON.parse(raw ?? 'null') as { moves?: unknown[] }).moves?.length ?? 0
    })
    .toBeGreaterThan(1)
})

test('分享：应用内改 hash 进入预览会中止在飞 AI，返回后续走', async ({ page }) => {
  test.setTimeout(60_000)
  const token = createGameShare({
    seq: 1,
    schemaVersion: 1,
    moves: MOVES,
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
  })
  expect(token.ok).toBe(true)
  if (!token.ok) return

  await page.addInitScript(() => {
    type Request = { requestId: number; gameVersion: number }
    const requests: Request[] = []
    const listeners: Array<(event: { data: unknown }) => void> = []
    class StubWorker {
      postMessage(request: Request): void {
        requests.push(request)
      }
      addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
        if (type === 'message') listeners.push(listener)
      }
      terminate(): void {}
    }
    const testWindow = window as unknown as {
      __aiRequests: Request[]
      __aiReply: (requestId: number, gameVersion: number) => void
    }
    testWindow.__aiRequests = requests
    testWindow.__aiReply = (requestId, gameVersion) => {
      for (const listener of listeners) {
        listener({
          data: {
            requestId,
            gameVersion,
            move: { x: 0, y: 0 },
            score: 0,
            depth: 1,
            nodes: 1,
            elapsedMs: 1,
            confidence: 'exact',
            reason: 'search',
            candidates: [],
            urgency: 'normal',
          },
        })
      }
    }
    Object.assign(globalThis, { Worker: StubWorker })
  })

  await page.goto('/')
  await page.getByTestId('intersection-7-7').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __aiRequests: unknown[] }).__aiRequests.length)).toBe(1)
  const first = await page.evaluate(
    () => (window as unknown as { __aiRequests: Array<{ requestId: number; gameVersion: number }> }).__aiRequests[0]!,
  )

  // 不重载，只改 hash：应用内进入分享预览。
  await page.evaluate((shareToken) => {
    window.location.hash = `#share=${shareToken}`
  }, token.token)
  await expect(page.getByTestId('share-kind')).toBeVisible()

  // 迟到的旧 AI 响应必须被 requestId 闸门丢弃。
  await page.evaluate(
    ({ requestId, gameVersion }) => {
      ;(window as unknown as { __aiReply: (id: number, version: number) => void }).__aiReply(
        requestId,
        gameVersion,
      )
    },
    first,
  )
  await page.waitForTimeout(200)
  const during = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gomoku-lab:session') ?? 'null'),
  )
  expect(during.moves).toHaveLength(1)

  // 不点按钮，直接改 hash 离开分享页：这条路径也必须续走。
  await page.evaluate(() => {
    window.location.hash = '#battle'
  })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __aiRequests: unknown[] }).__aiRequests.length))
    .toBeGreaterThan(1)
  const afterLeavingShare = await page.evaluate(
    () => (window as unknown as { __aiRequests: unknown[] }).__aiRequests.length,
  )

  // 普通页面之间改 hash 不应再次请求 AI。
  await page.evaluate(() => {
    window.location.hash = '#learn'
  })
  await page.waitForTimeout(200)
  expect(
    await page.evaluate(() => (window as unknown as { __aiRequests: unknown[] }).__aiRequests.length),
  ).toBe(afterLeavingShare)
  const second = await page.evaluate(
    () => {
      const requests = (window as unknown as { __aiRequests: Array<{ requestId: number; gameVersion: number }> }).__aiRequests
      return requests[requests.length - 1]!
    },
  )
  await page.evaluate(
    ({ requestId, gameVersion }) => {
      ;(window as unknown as { __aiReply: (id: number, version: number) => void }).__aiReply(
        requestId,
        gameVersion,
      )
    },
    second,
  )
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => localStorage.getItem('gomoku-lab:session'))
      return (JSON.parse(raw ?? 'null') as { moves?: unknown[] }).moves?.length ?? 0
    })
    .toBe(2)
})

test('分享：回放中的第 N 手局面可作为带 provenance 的局面导入', async ({ browser, page }) => {
  test.setTimeout(60_000)
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

  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByTestId(/^record-/).first().click()
  const slider = page.getByLabel('回放手数')
  await slider.focus()
  await slider.press('Home')
  for (let i = 0; i < 5; i++) await slider.press('ArrowRight')
  await expect(page.getByTestId('move-counter')).toHaveText('5 / 9')

  await page.getByRole('button', { name: '分享棋谱' }).click()
  await page.getByRole('button', { name: '分享第 5 手局面' }).click()
  const link = await page.getByTestId('share-link').inputValue()
  await page.getByRole('button', { name: '关闭' }).click()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  try {
    await pageB.goto(link)
    await expect(pageB.getByTestId('share-kind')).toContainText('自定义局面')
    await expect(pageB.getByText('来自棋谱第 5 手（已知手顺）')).toBeVisible()
    await expect(pageB.getByTestId(/^stone-/)).toHaveCount(5)
    await pageB.getByTestId('share-save').click()
    await expect(pageB.getByTestId('share-save-state')).toContainText('已保存')

    await pageB.goto('/')
    await pageB.getByRole('button', { name: '复盘', exact: true }).click()
    await pageB.getByRole('button', { name: '局面研究' }).click()
    await expect(pageB.getByLabel('打开已保存局面')).toContainText('棋谱第 5 手')
  } finally {
    await contextB.close()
  }
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
