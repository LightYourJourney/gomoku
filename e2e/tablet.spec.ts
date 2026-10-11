import { expect, test, type Page } from '@playwright/test'

/**
 * 平板视口与触屏专项。
 *
 * 跑在 `tablet` 项目里（iPad 横屏 1080×810，开了触摸）——`lg` 断点之上是三栏、
 * 之下是纵向堆叠，两条布局分界都得在真浏览器里过一遍；命中区在视口变化时
 * 最容易偏半格，jsdom 不做命中测试，看不出这类问题。
 */

declare global {
  interface Window {
    /** 页面看到过多少次 touchstart（捕获阶段，早于任何处理函数）。 */
    __touchStarts?: number
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem('e2e-fresh', '1')
    }

    // 「不落子」和「只落一子」这类断言天生会空转：手势根本没送达页面时，
    // 它们同样会绿。数一数页面真正收到了几次触摸，断言才有立足点。
    window.__touchStarts = 0
    window.addEventListener('touchstart', () => {
      window.__touchStarts = (window.__touchStarts ?? 0) + 1
    }, true)
  })
})

async function touchStarts(page: Page): Promise<number> {
  return page.evaluate(() => window.__touchStarts ?? 0)
}

/** 切到本地双人：没有 AI 应手，连续落子不必等，命中测试只关心点在哪。 */
async function useLocalTwoPlayer(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('radio', { name: '本地双人' }).click()
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** 在交叉点中心派发一串真实触摸，用于拖动这类 page.touchscreen 表达不了的手势。 */
async function touchDrag(page: Page, from: { x: number; y: number }, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let step = 10; step <= dy; step += 10) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x, y: from.y + step }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

test.describe('平板横屏（1080×810）', () => {
  test('不横向溢出，棋盘是正方形且完整可见', async ({ page }) => {
    await page.goto('/')

    expect(await horizontalOverflow(page)).toBe(0)

    const board = await page.getByTestId('board').boundingBox()
    expect(board).not.toBeNull()
    if (board === null) return

    expect(Math.abs(board.width - board.height)).toBeLessThan(1)
    const viewport = page.viewportSize()!
    expect(board.x).toBeGreaterThanOrEqual(0)
    expect(board.x + board.width).toBeLessThanOrEqual(viewport.width)
    expect(board.y).toBeGreaterThanOrEqual(0)
    expect(board.y + board.height).toBeLessThanOrEqual(viewport.height)
  })

  test('三栏并列：左设置 / 中棋盘 / 右面板互不压盖', async ({ page }) => {
    await page.goto('/')

    const asides = page.locator('main > aside')
    await expect(asides).toHaveCount(2)

    const left = await asides.nth(0).boundingBox()
    const right = await asides.nth(1).boundingBox()
    const board = await page.getByTestId('board').boundingBox()
    expect(left).not.toBeNull()
    expect(right).not.toBeNull()
    expect(board).not.toBeNull()
    if (left === null || right === null || board === null) return

    // 三块横向首尾相接、不重叠——「压盖」在几何上就是这个意思。
    // 注意 DOM 顺序是 左 / 中 / 右，靠 `order` 类还原成视觉顺序；这里按 x 排序取实际位置。
    const columns = [left, right, board].sort((a, b) => a.x - b.x)
    for (let i = 1; i < columns.length; i++) {
      const previous = columns[i - 1]!
      const current = columns[i]!
      expect(previous.x + previous.width).toBeLessThanOrEqual(current.x + 1)
    }

    // 并排而不是摞起来：三者的垂直区间必须真的重叠
    const [a, b, c] = columns
    expect(Math.min(a!.y + a!.height, b!.y + b!.height, c!.y + c!.height)).toBeGreaterThan(
      Math.max(a!.y, b!.y, c!.y),
    )
  })
})

test.describe('平板竖屏（768×1024）', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('退化为纵向堆叠，棋盘仍完整可见', async ({ page }) => {
    await page.goto('/')

    expect(await horizontalOverflow(page)).toBe(0)

    const board = await page.getByTestId('board')
    await board.scrollIntoViewIfNeeded()

    const box = await board.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) return

    expect(Math.abs(box.width - box.height)).toBeLessThan(1)
    const viewport = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)

    // 堆叠：两侧面板整块落在棋盘的上方或下方，不再与它并排
    const asides = page.locator('main > aside')
    for (const aside of await asides.all()) {
      const panel = await aside.boundingBox()
      expect(panel).not.toBeNull()
      if (panel === null) continue
      const sideBySide = panel.x + panel.width <= box.x + 1 || box.x + box.width <= panel.x + 1
      expect(sideBySide).toBe(false)
    }
  })
})

test.describe('触屏命中与误触', () => {
  test('四角与四边中点都点得中——留白换算最容易偏半格的地方', async ({ page }) => {
    await useLocalTwoPlayer(page)

    const targets = [
      [0, 0],
      [14, 0],
      [0, 14],
      [14, 14],
      [7, 0],
      [0, 7],
      [14, 7],
      [7, 14],
    ] as const

    // 一格在屏幕上有多少像素：拿相邻两个交叉点的**中心距**量，不拿被测元素自己的
    // 宽度——那样是自指的。命中区一旦被改小，`box.width` 跟着变小，偏移量也跟着
    // 缩水，用例会一直绿（这个坑踩过一次）。
    const first = await page.getByTestId('intersection-7-7').boundingBox()
    const next = await page.getByTestId('intersection-8-7').boundingBox()
    expect(first).not.toBeNull()
    expect(next).not.toBeNull()
    if (first === null || next === null) return
    const cell = next.x - first.x

    for (const [x, y] of targets) {
      const box = await page.getByTestId(`intersection-${x}-${y}`).boundingBox()
      expect(box).not.toBeNull()
      if (box === null) continue

      // 不点正中心：手指本来就点不准。命中区是整整一格宽（半径半格），
      // 从中心朝盘内偏 0.3 格仍该命中。
      const towardsBoard = { x: x < 7 ? 1 : x > 7 ? -1 : 0, y: y < 7 ? 1 : y > 7 ? -1 : 0 }
      await page.touchscreen.tap(
        box.x + box.width / 2 + towardsBoard.x * cell * 0.3,
        box.y + box.height / 2 + towardsBoard.y * cell * 0.3,
      )

      await expect(page.getByTestId(`stone-${x}-${y}`)).toBeVisible()
    }

    await expect(page.getByTestId(/^stone-/)).toHaveCount(targets.length)
  })

  test('手指在棋盘上拖动不落子', async ({ page }) => {
    await useLocalTwoPlayer(page)

    const stones = page.getByTestId(/^stone-/)
    expect(await stones.count()).toBe(0)

    const target = await page.getByTestId('intersection-7-7').boundingBox()
    expect(target).not.toBeNull()
    if (target === null) return

    await touchDrag(page, { x: target.x + target.width / 2, y: target.y + target.height / 2 }, 120)

    // 先证明这串触摸真到了页面，否则下面的「不落子」只是在陈述「什么都没发生」
    expect(await touchStarts(page)).toBeGreaterThan(0)

    // 拖动是一次手势不是一次点按：起点那一格也不该落子
    await expect(stones).toHaveCount(0)
    await expect(page.getByTestId('board')).toHaveCSS('touch-action', 'none')
  })

  test('快速连点同一交叉点两次只落一子', async ({ page }) => {
    await useLocalTwoPlayer(page)

    const box = await page.getByTestId('intersection-7-7').boundingBox()
    expect(box).not.toBeNull()
    if (box === null) return

    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    // 不 await 第一次点按再点第二次：模拟手指连击，两下之间不留给页面喘息
    await Promise.all([page.touchscreen.tap(x, y), page.touchscreen.tap(x, y)])

    // 两下都真的送达了，这条用例才是在测「重复落子被挡住」
    expect(await touchStarts(page)).toBe(2)

    await expect(page.getByTestId('stone-7-7')).toBeVisible()
    // 第二下必须被「已有子」挡掉——它落在同一格上，不是另开一格
    await expect(page.getByTestId(/^stone-/)).toHaveCount(1)
  })

  test('AI 思考期间触摸棋盘不落子，盘面不变', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '人机对战' }).click()
    // 专家档预算 2600ms（见 ai/difficulty.ts），下面几步触摸是毫秒级的，AI 插不进来
    await page.getByRole('radio', { name: '专家' }).click()

    const center = await page.getByTestId('intersection-7-7').boundingBox()
    expect(center).not.toBeNull()
    if (center === null) return

    await page.touchscreen.tap(center.x + center.width / 2, center.y + center.height / 2)
    await expect(page.getByTestId('status-pill')).toHaveText('AI 思考中…')

    const stones = page.getByTestId(/^stone-/)
    await expect(stones).toHaveCount(1)

    const other = await page.getByTestId('intersection-3-3').boundingBox()
    expect(await touchStarts(page)).toBe(1) // 只有第一次触摸是真的
    expect(other).not.toBeNull()
    if (other === null) return
    await page.touchscreen.tap(other.x + other.width / 2, other.y + other.height / 2)

    await expect(stones).toHaveCount(1)
  })
})
