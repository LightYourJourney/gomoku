import { expect, test } from '@playwright/test'

/**
 * 触屏相关的验收。
 *
 * 这一组跑在真正开启触摸的移动上下文里（见 playwright.config.ts 的 mobile 项目）——
 * jsdom 不做命中测试，桌面项目也没有触摸事件，只有这里能验。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem('e2e-fresh', '1')
    }
  })
})

test('页面不出现横向滚动', async ({ page }) => {
  await page.goto('/')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  expect(overflow).toBe(0)
})

test('棋盘是正方形，并且完整落在视口宽度内', async ({ page }) => {
  await page.goto('/')

  const board = await page.getByTestId('board').boundingBox()
  expect(board).not.toBeNull()
  if (board === null) return

  expect(Math.abs(board.width - board.height)).toBeLessThan(1)
  expect(board.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
})

test('棋盘锁死 touch-action，手指带一点拖动也不会滚页面', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('board')).toHaveCSS('touch-action', 'none')
})

test('触摸点按交叉点可以落子', async ({ page }) => {
  await page.goto('/')

  const target = await page.getByTestId('intersection-7-7').boundingBox()
  expect(target).not.toBeNull()
  if (target === null) return

  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2)

  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')
  // AI 应手后轮次交还玩家
  await expect(page.getByRole('status')).toHaveText('轮到你落子')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
})

test('触摸点按的落子位置与交叉点一致', async ({ page }) => {
  await page.goto('/')

  for (const [x, y] of [
    [0, 0],
    [14, 14],
    [7, 7],
  ] as const) {
    const box = await page.getByTestId(`intersection-${x}-${y}`).boundingBox()
    expect(box).not.toBeNull()
    if (box === null) continue

    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)

    await expect(page.getByTestId(`stone-${x}-${y}`)).toBeVisible()
  }
})
