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

  test('AI 思考期间整盘不再是 grid：键盘进不去，播报说出原因', async ({ page }) => {
    await page.goto('/')
    /**
     * 这一页的实例身份。
     *
     * 跑测期间若有人改了 `src/`，dev server 会广播**整页刷新**——刷新之后会话
     * 虽然能从 localStorage 恢复、AI 那一手也会被补完，但棋盘是**新挂载**的，
     * `hasEverFocusedRef` 归零，于是没人再把焦点送回棋盘。那是环境造成的，
     * 不是回归。见 `FINDINGS.md` 的 F-30：当初就是这条断言只留下一句
     * `Received: null`，机制查了很久。
     *
     * `vite.config.ts` 已经把文档 / 用例 / 基准排除在 watcher 之外；
     * 这一句兜住剩下的情况（改源码）。
     */
    const pageId = await page.evaluate(() => performance.timeOrigin)
    await page.getByRole('radio', { name: '人机对战' }).click()
    // 专家档的时间预算是 2600ms（见 ai/difficulty.ts）。原先这里写着「下面这几步
    // CDP 往返是毫秒级的，所以断言期间 AI 不会插进来」——**那句话是错的**：
    // 实测（8 个实例 / 6 个 worker 并发）下面这一串断言要 ~2.5s，余量只有 1.04 倍，
    // 高负载下 AI 的应手会落在断言中间，红在 `expect(gridcell).toHaveCount(0)` 上。
    // 那是 F-18 那一族（`waitForTimeout` / 竞态窗口）的同一个病根，记在案上。
    await page.getByRole('radio', { name: '专家' }).click()

    // 真按 Tab 进棋盘，而不是程序化 `.focus()`——这是使用说明里写给玩家的入口，
    // 也是 SVG 元素 Tab 可达性唯一会被验到的地方。
    await expect(page.getByRole('gridcell', { name: 'H8 空位' })).toHaveCount(1)
    let tabs = 0
    while (tabs < 12) {
      await page.keyboard.press('Tab')
      tabs += 1
      const onCell = await page.evaluate(
        () => document.activeElement?.getAttribute('role') === 'gridcell',
      )
      if (onCell) break
    }
    expect(tabs, '按 Tab 应该能在 12 步之内进到棋盘里').toBeLessThan(12)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'H8 空位',
    )

    await page.keyboard.press('Enter')
    await expect(page.getByTestId('stone-7-7')).toBeVisible()
    await expect(page.getByTestId('status-pill')).toHaveText('AI 思考中…')

    // 思考期间整盘退回只读：**连 role=gridcell 都不再有**，键盘用户根本落不了子。
    // 这条断言是有鉴别力的——把 BattleScreen 里 interactive 的 aiThinking 守卫去掉，
    // 格子在思考期间仍然是 gridcell，这里立刻红。
    // （原先断言的是「焦点停在刚落的那一格上、再按回车也不落子」，那是恒真的：
    //   已占用的格子在「已有子」那一支就返回了，与思考守卫无关。）
    await expect(page.getByRole('gridcell')).toHaveCount(0)

    // 键盘玩家按 Enter 没反应时，「为什么」只能从这条播报里知道
    await expect(page.getByTestId('board-announcer')).toContainText('AI 正在思考')

    const before = await page.getByTestId(/^stone-/).count()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(/^stone-/)).toHaveCount(before)

    // AI 走完，焦点要回到棋盘上。落子那一刻整盘不可聚焦、焦点会掉到 body，
    // 如果没人把它接回来，键盘玩家得从页面最开头重新 Tab 一遍。
    await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子', { timeout: 10_000 })

    // 先确认这一页还是原来那一页：被整页刷新过的话，下面那条断言测的就不是本用例的意图
    expect(
      await page.evaluate(() => performance.timeOrigin),
      '页面在这条用例跑到一半时被整页重载了（跑测期间改了源码？刷新后焦点不会自己回到棋盘，见 F-30）',
    ).toBe(pageId)

    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('role') ?? null))
      .toBe('gridcell')
  })
})

/**
 * 结果弹窗的焦点管理。
 *
 * `Modal` 声明了 `role="dialog" aria-modal="true"`，等于向读屏软件承诺
 * 「弹窗外的东西是惰性的」。这条承诺只有在**真实的 Tab 顺序**下才验得了——
 * jsdom 不做 Tab 顺序，所以组件测试只能验「循环处理器算得对」，
 * 「浏览器真的不把焦点交出去」必须在这里跑。
 */
test.describe('结果弹窗的焦点', () => {
  test('弹窗打开期间 Tab / Shift+Tab 都出不去（aria-modal 的实际含义）', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()

    // 先用认输触发终局弹窗（比对局走完快，且与另一条 e2e 的终局路径互补）
    await page.getByTestId('intersection-7-7').click()
    await page.getByRole('button', { name: '认输' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // 打开时焦点必须已经进弹窗
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)

    // 连按 8 次 Tab：每一步焦点都必须在弹窗里——这是 aria-modal 的实际含义
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      const insideDialog = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      )
      expect(insideDialog, `第 ${i + 1} 次 Tab 之后焦点跑到弹窗外面了`).toBe(true)
    }

    // Shift+Tab 同样出不去
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Tab')
      const insideDialog = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      )
      expect(insideDialog, `第 ${i + 1} 次 Shift+Tab 之后焦点跑到弹窗外面了`).toBe(true)
    }

    // Escape 关掉之后，焦点必须落到「重新开始」——对局结束后它是棋盘上唯一
    // 还有意义的操作。在此之前焦点会掉到 <body>，键盘用户得从页面最开头重新 Tab。
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? null))
      .toBe('重新开始')
  })
})
