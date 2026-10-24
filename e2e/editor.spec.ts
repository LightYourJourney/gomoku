import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

async function openEditor(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()
  await expect(page.getByRole('heading', { name: '局面研究' })).toBeVisible()
}

async function playNineMoveWin(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '对战', exact: true }).click()
  await page.getByRole('radio', { name: '本地双人' }).click()
  const moves: Array<[number, number]> = [
    [3, 7], [3, 9], [4, 7], [4, 9], [5, 7], [5, 9], [6, 7], [6, 9], [7, 7],
  ]
  for (const [x, y] of moves) await page.getByTestId(`intersection-${x}-${y}`).click()
  await expect(page.getByRole('dialog')).toContainText('黑棋获胜')
  await page.getByRole('button', { name: '看看棋盘' }).click()
}

test('编辑器：放黑/放白/擦除/撤销/重做/键盘', async ({ page }) => {
  await openEditor(page)

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')

  await page.getByRole('button', { name: '工具：白棋' }).click()
  await page.getByTestId('intersection-8-8').click()
  await expect(page.getByTestId('stone-8-8')).toHaveAttribute('data-player', '2')

  await page.getByRole('button', { name: '工具：擦除' }).click()
  await page.getByTestId('intersection-8-8').click()
  await expect(page.getByTestId('stone-8-8')).toHaveCount(0)

  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.getByTestId('stone-8-8')).toBeVisible()
  await page.getByRole('button', { name: '重做' }).click()
  await expect(page.getByTestId('stone-8-8')).toHaveCount(0)

  await page.getByRole('button', { name: '工具：黑棋' }).click()
  const cell = page.getByTestId('intersection-9-9')
  await cell.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('stone-9-9')).toBeVisible()
})

test('编辑器：保存局面 → 刷新后显示时间并删除', async ({ page }) => {
  test.setTimeout(60_000)
  await openEditor(page)
  await page.getByTestId('intersection-7-7').click()
  await page.getByLabel('局面名称').fill('斜月研究')
  await page.getByRole('button', { name: '保存局面' }).click()
  await expect(page.getByTestId('position-notice')).toContainText('已保存')

  await page.reload()
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()
  await page.getByLabel('打开已保存局面').selectOption({ label: '斜月研究' })
  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  await expect(page.getByTestId('position-saved-at')).toContainText(
    /最近保存：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
  )

  await page.getByRole('button', { name: '删除已保存局面' }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByTestId('position-notice')).toContainText('已删除')
  await expect(page.getByTestId('position-saved-at')).toHaveCount(0)
  await expect(page.getByTestId('stone-7-7')).toBeVisible()
})

test('编辑器：从合法棋谱载入第 9 手', async ({ page }) => {
  test.setTimeout(60_000)
  await playNineMoveWin(page)
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()

  await page.getByLabel('棋谱').selectOption({ index: 1 })
  await page.getByLabel('载入手数').fill('9')
  await page.getByRole('button', { name: '载入' }).click()

  await expect(page.getByTestId('position-kind')).toContainText('第 9 手')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(9)
})

test('编辑器：AI 只读分析显示候选与搜索指标', async ({ page }) => {
  test.setTimeout(60_000)
  await openEditor(page)
  await page.getByTestId('intersection-7-7').click()
  await page.getByRole('button', { name: '工具：白棋' }).click()
  await page.getByTestId('intersection-8-8').click()

  await page.getByLabel('分析档位').selectOption('hard')
  await page.getByRole('button', { name: '分析当前局面' }).click()
  const panel = page.getByTestId('position-analysis')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel).toContainText('高级')
  const budget = page.getByTestId('position-analysis-budget')
  await expect(budget).toBeHidden()
  await page.getByText('技术细节').click()
  await expect(budget).toBeVisible()
  await expect(budget).toContainText('1600ms')
  await expect(panel).toContainText('深度')
  await expect(panel).toContainText('节点')
  await expect(panel).toContainText('结论')
})

test('编辑器：导出局面文件 → 清空 → 导入恢复', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('intersection-7-7').click()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出局面文件' }).click(),
  ])
  const path = await download.path()
  expect(path).not.toBeNull()
  const file = JSON.parse(readFileSync(path!, 'utf8')) as { format: string; stones: unknown[] }
  expect(file.format).toBe('gomoku-lab.position')
  expect(file.stones).toHaveLength(1)

  await page.getByRole('button', { name: '清空' }).click()
  await expect(page.getByTestId('stone-7-7')).toHaveCount(0)
  await page.getByTestId('position-file').setInputFiles(path!)
  await expect(page.getByTestId('stone-7-7')).toBeVisible()
})

test('编辑器：v2 库升级到 v3 后旧进度与棋谱仍在', async ({ page }) => {
  await page.goto('/robots.txt')
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase('gomoku-lab')
      del.onsuccess = del.onerror = del.onblocked = () => resolve()
    })
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('gomoku-lab', 2)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('progress')
        req.result.createObjectStore('records', { keyPath: 'seq', autoIncrement: true })
      }
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['progress', 'records'], 'readwrite')
        tx.objectStore('progress').put(
          {
            schemaVersion: 1,
            completedLessons: ['battle-basics'],
            solvedPuzzles: [],
            lastVisited: null,
            lastView: 'review',
          },
          'learning',
        )
        tx.objectStore('records').add({
          seq: 1,
          schemaVersion: 1,
          moves: [
            { x: 7, y: 7 },
            { x: 7, y: 8 },
          ],
          firstPlayer: 1,
          mode: 'pvp',
          humanColor: 1,
          difficulty: 'easy',
          resignedBy: null,
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await expect(page.getByText(/双人 · 2 手/)).toBeVisible()
  await page.getByRole('button', { name: '局面研究' }).click()
  await page.getByTestId('intersection-7-7').click()
  await page.getByRole('button', { name: '保存局面' }).click()
  await expect(page.getByTestId('position-notice')).toContainText('已保存')

  const state = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('gomoku-lab')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const read = <T>(store: string, run: (s: IDBObjectStore) => IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly')
        const req = run(tx.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const version = db.version
    const stores = [...db.objectStoreNames].sort()
    const records = await read('records', (s) => s.count())
    const progress = await read<unknown>('progress', (s) => s.get('learning'))
    db.close()
    return { version, stores, records, progress }
  })

  expect(state.version).toBe(3)
  expect(state.stores).toEqual(['positions', 'progress', 'records'])
  expect(state.records).toBe(1)
  expect(state.progress).toMatchObject({ completedLessons: ['battle-basics'] })
})

test('编辑器：390/768/1024/1440 布局与深色主题', async ({ page }) => {
  await openEditor(page)

  for (const [width, height] of [
    [390, 844],
    [768, 900],
    [1024, 900],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height })
    await expect(page.getByTestId('board')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${width}px 不应横向溢出`).toBe(0)

    const board = await page.getByTestId('board').boundingBox()
    const panel = await page.locator('aside').boundingBox()
    expect(board).not.toBeNull()
    expect(panel).not.toBeNull()
    if (board === null || panel === null) continue
    // 父容器有 1px 边框；WebKit 的 SVG 盒模型会把这两像素算进高度，允许 2px 舍入。
    expect(Math.abs(board.width - board.height), `${width}px 棋盘应为正方形`).toBeLessThanOrEqual(2)
    if (width >= 1024) {
      expect(panel.x, `${width}px 应为右侧两栏`).toBeGreaterThanOrEqual(
        board.x + board.width - 1,
      )
    } else {
      expect(panel.y, `${width}px 应为纵向堆叠`).toBeGreaterThanOrEqual(
        board.y + board.height - 1,
      )
    }
  }

  const theme = page.getByRole('button', { name: /主题：/ })
  await theme.click()
  await theme.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByTestId('board')).toBeVisible()
  const darkOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(darkOverflow).toBe(0)
})

test('编辑器：双方五连的异常快照被明确指出', async ({ page }) => {
  await openEditor(page)
  for (const x of [0, 1, 2, 3, 4]) await page.getByTestId(`intersection-${x}-0`).click()
  await page.getByRole('button', { name: '工具：白棋' }).click()
  for (const x of [0, 1, 2, 3, 4]) await page.getByTestId(`intersection-${x}-1`).click()

  await expect(page.getByTestId('position-issues')).toContainText('同时五连')
  await expect(page.getByRole('button', { name: '分析当前局面' })).toBeDisabled()
})
