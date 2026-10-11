import { expect, test, type Page } from '@playwright/test'

/**
 * 复盘流程的端到端验收。
 *
 * 成局方式用**本地双人**：没有 AI 应手，每一手都由测试点出，完全确定。
 * 黑棋第 7 行连五点、白棋在第 9 行陪走四点，第 9 手黑棋成五终局。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

/** 在本地双人模式下把一局下到黑棋五连终局。 */
async function playNineMoveWin(page: Page): Promise<void> {
  await page.getByRole('radio', { name: '本地双人' }).click()

  const moves: Array<[number, number]> = [
    [3, 7], [3, 9], [4, 7], [4, 9], [5, 7], [5, 9], [6, 7], [6, 9], [7, 7],
  ]
  for (const [x, y] of moves) {
    await page.getByTestId(`intersection-${x}-${y}`).click()
  }
}

/** 从对战页切到复盘页。终局后结果弹窗会盖住导航，先关掉它。 */
async function gotoReview(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: '看看棋盘' })
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click()
  await page.getByRole('button', { name: '复盘', exact: true }).click()
}

test('下完一局 → 弹窗说已存入 → 复盘页列出这一局', async ({ page }) => {
  await page.goto('/')
  await playNineMoveWin(page)

  // 终局弹窗如实告知入库结果
  await expect(page.getByText(/这局已存入棋谱库/)).toBeVisible()

  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)

  const records = page.getByTestId(/^record-/)
  await expect(records).toHaveCount(1)
  await expect(records.first()).toContainText('黑方胜')
  await expect(records.first()).toContainText('9 手')
})

test('回放：落子编号、走一步退一步、自动播放', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await playNineMoveWin(page)
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)
  await page.getByTestId(/^record-/).first().click()

  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')

  // 走一步：计数器前进，第 1 手的编号标记出现
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('move-counter')).toHaveText('1 / 9')
  await expect(page.getByTestId('board-mark-3-7')).toBeVisible()

  // 退一步：回到空盘，标记消失
  await page.getByRole('button', { name: '上一步' }).click()
  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')
  await expect(page.getByTestId('board-mark-3-7')).toHaveCount(0)

  // 自动播放开着切走再切回：复盘页整个卸载重建，回到列表；
  // 重新打开时必须从 0 开始，且**不会有遗留定时器在后台自己推进**。
  await page.getByRole('button', { name: '自动播放' }).click()
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()

  await page.getByRole('button', { name: '对战', exact: true }).click()
  await page.waitForTimeout(2500)
  await gotoReview(page)
  await page.getByTestId(/^record-/).first().click()

  const counter = page.getByTestId('move-counter')
  await expect(counter).toHaveText('0 / 9')
  await page.waitForTimeout(2000)
  await expect(counter).toHaveText('0 / 9')
})

test('刷新后棋谱仍在（IndexedDB 持久）', async ({ page }) => {
  await page.goto('/')
  await playNineMoveWin(page)
  // 等「已存入」——它是写入落库完成的信号；不等就刷新会打断事务
  await expect(page.getByText(/这局已存入棋谱库/)).toBeVisible()
  await page.getByRole('button', { name: '看看棋盘' }).click()

  await page.reload()
  // 刷新后这局仍是终局，结果弹窗重新出现——先关掉再进复盘
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)

  await expect(page.getByTestId(/^record-/)).toHaveCount(1)
})

test('分析：逐手跑完并给出结论，标注引擎出处', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await playNineMoveWin(page)
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)
  await page.getByTestId(/^record-/).first().click()

  // 结论的出处必须写在面板上
  await expect(page.getByTestId('analysis-source')).toContainText('400ms')
  await expect(page.getByTestId('analysis-source')).toContainText('引擎 search-1')

  await page.getByRole('button', { name: '开始分析' }).click()

  // 9 手局 = 9 个局面请求，串行跑完
  await expect(page.getByTestId('analysis-progress')).toContainText('9 / 9', { timeout: 60_000 })
  // 至少给出一条结论，且带引擎推荐坐标
  await expect(page.getByTestId(/^verdict-/).first()).toContainText('引擎推荐')
})
