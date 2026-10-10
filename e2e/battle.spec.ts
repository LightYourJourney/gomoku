import { expect, test } from '@playwright/test'

/**
 * 每个用例都从干净的存档开始。
 *
 * 只在本次标签页的第一次导航时清一次：addInitScript 每次导航都会执行，
 * 若无条件清空，「刷新后恢复」这类用例刚写进去的存档会被 reload 自己抹掉。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem('e2e-fresh', '1')
    }
  })
})

async function stones(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId(/^stone-/).count()
}

test('人机对战：玩家落子后 AI 自动应手', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('status')).toHaveText('轮到你落子')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)

  await page.getByTestId('intersection-7-7').click()

  // 玩家这一手立刻出现
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')

  // AI 应手后轮次交还玩家
  await expect(page.getByRole('status')).toHaveText('轮到你落子')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
  await expect(page.getByTestId('stone-7-7')).not.toHaveAttribute('data-last', 'true')
})

test('落子位置与点击的交叉点一致', async ({ page }) => {
  await page.goto('/')

  // 命中区是按格铺开的，点在格子正中必须落在该交叉点上，
  // 不能因为命中区互相重叠而跑到相邻格。
  for (const [x, y] of [
    [0, 0],
    [14, 0],
    [0, 14],
    [14, 14],
    [7, 7],
  ] as const) {
    await page.getByTestId(`intersection-${x}-${y}`).click()
    await expect(page.getByTestId(`stone-${x}-${y}`)).toBeVisible()
  }
})

test('悔棋撤销双方各一手', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

  await page.getByRole('button', { name: '悔棋' }).click()

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '悔棋' })).toBeDisabled()
})

test('重新开始会清空棋盘', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

  await page.getByRole('button', { name: '重新开始' }).click()

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('轮到你落子')
})

test('刷新页面后棋局恢复，且 AI 思考中的那一手会被补完', async ({ page }) => {
  await page.goto('/')

  // 直接写入一份「玩家刚落子、AI 还没应手」的存档。
  await page.evaluate(() => {
    window.localStorage.setItem(
      'gomoku-lab:session',
      JSON.stringify({
        schemaVersion: 1,
        moves: [{ x: 7, y: 7 }],
        firstPlayer: 1,
        mode: 'pve',
        humanColor: 1,
        difficulty: 'easy',
      }),
    )
  })
  await page.reload()

  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
  await expect(page.getByRole('status')).toHaveText('轮到你落子')
})

test('认输弹出结果弹窗，且此后再点棋盘无效', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '认输' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('你认输了')
  await expect(page.getByRole('button', { name: '认输' })).toBeDisabled()

  await page.getByRole('button', { name: '看看棋盘' }).click()
  await expect(dialog).toBeHidden()

  await page.getByTestId('intersection-3-3').click()
  expect(await stones(page)).toBe(0)
})

test('本地双人模式不触发 AI，黑白轮流落子', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('radio', { name: '本地双人' }).click()

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByRole('status')).toHaveText('轮到白棋')

  await page.getByTestId('intersection-7-8').click()
  await expect(page.getByRole('status')).toHaveText('轮到黑棋')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
})
