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

  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)

  await page.getByTestId('intersection-7-7').click()

  // 玩家这一手立刻出现
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')

  // AI 应手后轮次交还玩家
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
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
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('刷新页面后棋局恢复，且 AI 思考中的那一手会被补完', async ({ page }) => {
  await page.goto('/')

  // 直接写入一份「玩家刚落子、AI 还没应手」的存档。
  // 这里的字段必须与 src/persist/storage.ts 的 PersistedSession 一致——
  // 少一个字段存档就会被安全丢弃，这条用例会立刻失败（这正是我们要的）。
  await page.evaluate(() => {
    window.localStorage.setItem(
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
  await page.reload()

  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('认输后刷新页面，对局不会复活成进行中', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

  await page.getByRole('button', { name: '认输' }).click()
  await expect(page.getByRole('dialog')).toContainText('你认输了')

  await page.reload()

  // 手顺还原不出认输，所以它必须单独存档；否则刷新后这局会重新变得可以继续下。
  await expect(page.getByTestId('status-pill')).toHaveText('你认输了')
  await expect(page.getByRole('button', { name: '认输' })).toBeDisabled()
  await expect(page.getByRole('dialog')).toContainText('你认输了')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
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
  await expect(page.getByTestId('status-pill')).toHaveText('轮到白棋')

  await page.getByTestId('intersection-7-8').click()
  await expect(page.getByTestId('status-pill')).toHaveText('轮到黑棋')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
})

test('请求提示后棋盘上出现候选标记，且棋局一手未变', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
  const before = await stones(page)
  expect(before).toBeGreaterThan(0)

  await page.getByRole('button', { name: '求提示' }).click()

  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(3)
  // 提示只做分析：手数、轮次都不许变，也不能多出棋子
  await expect(page.getByTestId(/^stone-/)).toHaveCount(before)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('提示之后落子，提示标记消失', async ({ page }) => {
  await page.goto('/')
  // 本地双人：没有 AI 随机应手，落点完全可控
  await page.getByRole('radio', { name: '本地双人' }).click()

  await page.getByTestId('intersection-7-7').click()
  await page.getByRole('button', { name: '求提示' }).click()
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(3)

  await page.getByTestId('intersection-3-3').click()

  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(0)
  await expect(page.getByTestId('stone-3-3')).toBeVisible()
})

test('收起提示只清标记，不动棋局', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: '本地双人' }).click()

  await page.getByTestId('intersection-7-7').click()
  await page.getByRole('button', { name: '求提示' }).click()
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(3)

  await page.getByRole('button', { name: '收起提示' }).click()

  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(0)
  await expect(page.getByTestId(/^stone-/)).toHaveCount(1)
})

test('专家档深算期间悔棋，迟到的 AI 响应不会把棋子补回来', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('radio', { name: '专家' }).click()
  await page.getByTestId('intersection-7-7').click()

  // AI 正在深算时悔棋
  await page.getByRole('button', { name: '悔棋' }).click()

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)

  // 等过专家档的时间预算，确认那一手确实作废了，而不是只是慢了一步
  await page.waitForTimeout(3500)

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})
