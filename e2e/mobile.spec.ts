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

test('手指在棋盘上拖动不会滚页面', async ({ page }) => {
  await page.goto('/')

  // 页面本身必须是可以滚的，否则这条用例证明不了任何事。
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(
    page.viewportSize()?.height ?? 0,
  )

  const box = await page.getByTestId('intersection-7-7').boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  // 只有派发真实的触摸序列才验得了这件事：mouse 拖动不会触发页面滚动，
  // 而 touch-action 正是浏览器决定「这一串触摸要不要变成滚动」的开关。
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY }],
  })
  for (let dy = 10; dy <= 120; dy += 10) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX, y: startY - dy }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()

  // 行为放在机制断言前面：先证明「真的没滚」，再确认是靠 touch-action 做到的。
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
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
    // 必须等 AI 应完手、轮次交还玩家再点下一处，否则这一下会被 interactive
    // 静默吞掉，用例变成「赌 AI 已经走完了」。
    await expect(page.getByRole('status')).toHaveText('轮到你落子')

    const box = await page.getByTestId(`intersection-${x}-${y}`).boundingBox()
    expect(box).not.toBeNull()
    if (box === null) continue

    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)

    await expect(page.getByTestId(`stone-${x}-${y}`)).toBeVisible()
  }
})

test('学习页在窄屏上不横向溢出，棋盘是正方形', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()
  await expect(page.getByRole('heading', { name: '互动教学' })).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)

  // 进入练习页，棋盘是新的一处实例，正方形约束得重新验一遍
  await page.getByTestId('lesson-rules').click()
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }

  const box = await page.getByTestId('board').boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return

  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1)
  expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test('学习页的棋盘：手指拖动不滚页面，点按命中正确', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()
  await page.getByTestId('lesson-rules').click()
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }

  await expect(page.getByTestId('board')).toHaveCSS('touch-action', 'none')

  const target = await page.getByTestId('intersection-4-7').boundingBox()
  expect(target).not.toBeNull()
  if (target === null) return

  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2)

  // 点到哪就落在哪：落点必须是这一手本身，判定结果也得对上
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')
})
