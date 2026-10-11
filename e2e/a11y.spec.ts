import { expect, test } from '@playwright/test'

/**
 * 无障碍与动效的验收。
 *
 * 这一组跑在真实 Chrome 里——键盘、焦点、`prefers-reduced-motion` 这些
 * 只有真浏览器才说得清；jsdom 既不跑 CSS 动画，也没有真正的焦点模型。
 */

/** 用本地双人模式：没有 AI 应手，刚落下的那颗子会一直是「最新一手」——
   人机模式里 AI 会在断言前抢先落子，那颗子就不再带落下动效了。 */
async function playOneMove(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('radio', { name: '本地双人' }).click()
  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-last', 'true')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

test.describe('prefers-reduced-motion', () => {
  test.describe('系统要求减少动态时', () => {
    test.use({ reducedMotion: 'reduce' })

    test('落子不发生位移与缩放动画', async ({ page }) => {
      await playOneMove(page)

      // 真的问浏览器要 computed style，而不是读源码猜
      await expect(page.getByTestId('stone-7-7')).toHaveCSS('animation-name', 'none')
    })
  })

  test.describe('没有该偏好时（对照组）', () => {
    test('同一颗子确实带落下动效——否则上一条断言等于没测', async ({ page }) => {
      await playOneMove(page)

      await expect(page.getByTestId('stone-7-7')).toHaveCSS('animation-name', 'motion-stone-drop')
    })
  })
})

test.describe('播报区', () => {
  test('对局界面只有一个 live region，且是棋盘播报区', async ({ page }) => {
    // 两个 role="status" 会把同一件事念两遍。这条守卫是一次真实回归换来的：
    // 播报区刚接上时状态药丸也是 live region，两边都在念「轮到谁落子」。
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()

    await expect(page.getByRole('status')).toHaveCount(1)
    await expect(page.getByRole('status')).toHaveAttribute('data-testid', 'board-announcer')
  })
})

test.describe('键盘操作', () => {
  test('只用键盘就能落子：方向键移动焦点、回车落子', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()

    await page.getByRole('gridcell', { name: 'H8 空位' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')

    await expect(page.getByTestId('stone-8-7')).toBeVisible()
    await expect(page.getByTestId('board-announcer')).toContainText('最后一手在 I8')
  })

  test('焦点指示只占一格——它必须看得见，也不能糊住半个棋盘', async ({ page }) => {
    // 这条是目视复核换来的：焦点指示原先靠全局 `:focus-visible` 的 outline，
    // 而 SVG 里 outline-width / outline-offset 按**用户坐标**解释，
    // 于是 2px 变成 2 个格子宽，焦点框横跨半个棋盘。单元测试看不到，
    // 只有真浏览器能量出它到底多大。
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()

    await page.getByRole('gridcell', { name: 'H8 空位' }).focus()
    await page.keyboard.press('ArrowRight')

    const ring = await page.getByTestId('focus-ring').boundingBox()
    const cell = await page.getByTestId('intersection-8-7').boundingBox()
    expect(ring).not.toBeNull()
    expect(cell).not.toBeNull()
    if (ring === null || cell === null) return

    expect(ring.width).toBeGreaterThan(cell.width * 0.8) // 不能小到看不见
    expect(ring.width).toBeLessThan(cell.width * 1.4) // 也不能大到糊住棋盘
  })

  test('AI 思考期间按回车不落子，播报要说出原因', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '人机对战' }).click()
    // 专家档的时间预算是 2600ms（见 ai/difficulty.ts）——下面这几步 CDP 往返
    // 是毫秒级的，所以断言期间 AI 不会插进来。真插进来了也会让计数对不上而失败，
    // 不会变成假绿。
    await page.getByRole('radio', { name: '专家' }).click()

    await page.getByRole('gridcell', { name: 'H8 空位' }).focus()
    await page.keyboard.press('Enter')

    // 键盘玩家按 Enter 没反应时，「为什么」只能从这条播报里知道
    await expect(page.getByTestId('board-announcer')).toContainText('AI 正在思考')

    const before = await page.getByTestId(/^stone-/).count()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(/^stone-/)).toHaveCount(before)
  })
})
