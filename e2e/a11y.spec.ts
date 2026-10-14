import { LESSONS } from '../src/learn/lessons'
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

/**
 * 把 Worker 换成一个**永不回应**的桩，于是「AI 思考中」这个窗口不会自己关上。
 *
 * 为什么需要它：这一条要证的是「思考期间**界面**是什么样」，而窗口能开多久由
 * 专家档的 2600ms 预算决定。要让断言在窗口内做完，就得赌那几次 CDP 往返加起来
 * 不超过 2600ms——实测高负载下每次往返能到 870ms，这个赌注输过（F-18：
 * 余量只有 1.04 倍，8 实例 / 6 worker 下红过 6/8）。桩掉 Worker 之后，
 * 断言做多久都无所谓：**窗口根本不关**。
 *
 * 与「用 mock 换掉有效断言」不是一回事：被测的性质（`aiThinking` 为真时整盘
 * 退回只读、播报说出原因）完全由 store 的状态驱动，与引擎回得多快无关。
 * 真实 Worker 的往返由 `battle.spec.ts` 与 `e2e:prod` 端到端覆盖。
 *
 * 必须在 `page.goto` **之前**调用：`appEngine` 是在模块导入时创建 Worker 的。
 * （`tablet.spec.ts` 里有一份同样的桩，两处各自独立——见 FINDINGS 的 F-19：
 * 这一层的小重复不值得抽一个跨 spec 的共享文件。）
 */
async function holdAiInThinking(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    class StubWorker {
      postMessage(): void {}
      addEventListener(): void {}
      terminate(): void {}
    }
    Object.assign(globalThis, { Worker: StubWorker })
  })
}

/**
 * 按 Tab 走进棋盘，直到焦点落在某一格上。
 *
 * 用**真键盘**而不是程序化 `.focus()`——这是使用说明里写给玩家的入口，也是 SVG
 * 元素 Tab 可达性唯一会被验到的地方。
 *
 * 抽出来是因为它在本文件里出现了两次（思考期间那条、思考结束后那条），连魔数 `12`
 * 和那句失败提示都是逐字重复的。`FINDINGS.md` §10.3 裁定过「e2e 之间的小重复不值得
 * 抽跨 spec 的共享文件」——那是**跨文件**的取舍，同一个文件内部没有这个成本。
 */
async function tabIntoBoard(page: import('@playwright/test').Page): Promise<void> {
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
}

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
    await holdAiInThinking(page)
    await page.goto('/')
    await page.getByRole('radio', { name: '人机对战' }).click()
    // 选最慢的一档不是为了让窗口更长（桩掉 Worker 之后它根本不关），而是万一将来
    // 这个桩失效了（引擎换成别的机制创建 Worker），剩下的余量仍是最宽的那一档。
    await page.getByRole('radio', { name: '专家' }).click()

    await tabIntoBoard(page)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'H8 空位',
    )

    await page.keyboard.press('Enter')
    await expect(page.getByTestId('stone-7-7')).toBeVisible()
    await expect(page.getByTestId('status-pill')).toHaveText('AI 思考中…')

    // 思考期间整盘退回只读：**连 role=gridcell 都不再有**，键盘用户根本落不了子。
    //
    // 这条断言确实有鉴别力，但**抓手是「整盘可交互与否」，不是 `canHumanPlay` 里的
    // 哪一项**：实测把 `!aiThinking` 那一项删掉，这条**不会**红——AI 回合时
    // `game.current` 本来就不是人，`game.current === humanColor` 已经把这一档排除了。
    // 真正会让它红的是「思考期间整盘仍被算成可交互」（实测：把 `interactive` 算成
    // `… || aiThinking`，立刻红 `Expected: 0 / Received: 225`）。
    //
    // （原先断言的是「焦点停在刚落的那一格上、再按回车也不落子」，那是恒真的：
    //   已占用的格子在「已有子」那一支就返回了，与思考守卫无关。）
    await expect(page.getByRole('gridcell')).toHaveCount(0)

    // 键盘玩家按 Enter 没反应时，「为什么」只能从这条播报里知道
    await expect(page.getByTestId('board-announcer')).toContainText('AI 正在思考')

    const before = await page.getByTestId(/^stone-/).count()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(/^stone-/)).toHaveCount(before)
  })

  /**
   * 与上一条**刻意分开**：上一条要的是「思考期间」，用桩把窗口钉住才测得准；
   * 这一条要的是「思考**结束**之后」，必须让真实的 AI 走完那一手。
   *
   * 合成一条的话，「等 AI 走完」这个硬同步点会把前一半也拖进窗口竞速里
   * ——那正是 F-18 的成因。
   */
  test('AI 走完那一手之后，焦点回到棋盘上', async ({ page }) => {
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
     * `vite.config.ts` 已经把 `.md` 那一类排除在 watcher 之外（实测只有它会触发刷新）；
     * 这一句兜住剩下的情况（改源码）。
     */
    const pageId = await page.evaluate(() => performance.timeOrigin)
    await page.getByRole('radio', { name: '人机对战' }).click()
    await page.getByRole('radio', { name: '专家' }).click()

    // 棋盘必须先**拿到过**焦点，否则「把焦点接回来」这件事无从谈起
    await tabIntoBoard(page)

    await page.keyboard.press('Enter')
    await expect(page.getByTestId('stone-7-7')).toBeVisible()

    // 硬同步点：状态条翻回「轮到你落子」＝ AI 那一手真的落下了。
    // 断言在这之后，所以与窗口长度无关。
    await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子', { timeout: 10_000 })

    // 先确认这一页还是原来那一页：被整页刷新过的话，下面那条断言测的就不是本用例的意图
    expect(
      await page.evaluate(() => performance.timeOrigin),
      '页面在这条用例跑到一半时被整页重载了（跑测期间改了源码？刷新后焦点不会自己回到棋盘，见 F-30）',
    ).toBe(pageId)

    // 落子那一刻整盘不可聚焦、焦点掉到 body；没人接回来的话，键盘玩家
    // 得从页面最开头重新 Tab 一遍
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

    // 先用认输触发终局弹窗（比对局走完快，且与另一条 e2e 的终局路径互补）。
    // 认输要先过一道防误触确认（Phase 02）。
    await page.getByTestId('intersection-7-7').click()
    await page.getByRole('button', { name: '认输' }).click()
    await page.getByRole('button', { name: '确认认输' }).click()
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

/**
 * Phase 04：教学页的键盘通路。
 *
 * 与上面那条落子用例同一条纪律：**用真键盘 Tab 过去，不调 `.focus()`**——
 * 程序化定位只能证明「这个元素存在」，证明不了「键盘用户到得了它」。
 */
test.describe('键盘操作 · 教学页', () => {
  test('Tab 就能走到「下一步」，回车翻页；第一步的「上一步」是禁用的', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '教学', exact: true }).click()
    await page.getByTestId('lesson-rules').click()

    // 第 0 步：渲染但禁用——键盘走不到它，这正是判据（不是隐藏，隐藏会让工具栏跳动）
    await expect(page.getByRole('button', { name: '上一步' })).toBeDisabled()

    let tabs = 0
    while (tabs < 20) {
      await page.keyboard.press('Tab')
      tabs += 1
      const text = await page.evaluate(() => document.activeElement?.textContent ?? '')
      if (text.includes('下一步')) break
    }
    expect(tabs, '按 Tab 应该能在 20 步之内走到「下一步」').toBeLessThan(20)

    await page.keyboard.press('Enter')

    /*
      `exact: true` 不能少：讲解面板的标题写的是「讲解 2 / 3」，
      按子串找会同时命中它和工具栏的计数器（strict mode 直接报两个元素）。
    */
    await expect(page.getByText(`2 / ${LESSONS[0]!.steps.length}`, { exact: true })).toBeVisible()
    // 走到第二步之后，「上一步」就该能用了——Tab 得能摸到它
    await expect(page.getByRole('button', { name: '上一步' })).toBeEnabled()
  })

  test('列表页那颗「继续学习」用键盘也能按', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '教学', exact: true }).click()

    const cta = page.getByRole('button', { name: /^继续学习：/ })
    await expect(cta).toBeVisible()

    let tabs = 0
    while (tabs < 25) {
      await page.keyboard.press('Tab')
      tabs += 1
      const text = await page.evaluate(() => document.activeElement?.textContent ?? '')
      if (text.startsWith('继续学习：')) break
    }
    expect(tabs, '按 Tab 应该能在 25 步之内走到「继续学习」').toBeLessThan(25)

    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: LESSONS[0]!.steps[0]!.title })).toBeVisible()
  })
})
