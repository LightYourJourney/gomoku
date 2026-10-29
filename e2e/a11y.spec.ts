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
 * 按 Tab 直到焦点落到满足 `hit` 的控件上，返回按了几次；找不到返回 `limit + 1`。
 *
 * 用**真键盘**而不是程序化 `.focus()`——那是使用说明里写给玩家的入口，
 * 程序化聚焦证明不了键盘用户到得了。
 *
 * 这个走法在本文件里已经出现了**六处**，只有谓词、上限和那句失败提示不同。
 * `FINDINGS.md` §10.3 裁定过「e2e 之间的小重复不值得抽跨 spec 的共享文件」——
 * 那是**跨文件**的取舍，同一个文件内部没有这个成本，所以它住在这里。
 *
 * 焦点元素的 `textContent` 取 `trim()` 后返回：按钮上常有无障碍用的前后空白，
 * 不 trim 的话 `startsWith` 会莫名其妙地判假。
 */
async function tabUntil(
  page: import('@playwright/test').Page,
  limit: number,
  hit: (focus: { readonly text: string; readonly role: string | null }) => boolean,
): Promise<number> {
  for (let tabs = 1; tabs <= limit; tabs += 1) {
    await page.keyboard.press('Tab')
    const focus = await page.evaluate(() => ({
      text: (document.activeElement?.textContent ?? '').trim(),
      // 没有 activeElement 时也要给 `null`，不能漏成 `undefined`——签名里只有两种值
      role: document.activeElement?.getAttribute('role') ?? null,
    }))
    if (hit(focus)) return tabs
  }
  return limit + 1
}

/** 按 Tab 走进棋盘，直到焦点落在某一格上。 */
async function tabIntoBoard(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('gridcell', { name: 'H8 空位' })).toHaveCount(1)

  const tabs = await tabUntil(page, 18, (focus) => focus.role === 'gridcell')
  expect(tabs, '按 Tab 应该能在 18 步之内进到棋盘里').toBeLessThanOrEqual(18)
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

    const tabs = await tabUntil(page, 20, (focus) => focus.text.includes('下一步'))
    expect(tabs, '按 Tab 应该能在 20 步之内走到「下一步」').toBeLessThanOrEqual(20)

    await page.keyboard.press('Enter')

    /*
      `exact: true` 不能少：讲解面板的标题写的是「讲解 2 / 3」，
      按子串找会同时命中它和工具栏的计数器（strict mode 直接报两个元素）。
    */
    await expect(page.getByText(`2 / ${LESSONS[0]!.steps.length}`, { exact: true })).toBeVisible()
    // 走到第二步之后，「上一步」就该能用了——Tab 得能摸到它
    await expect(page.getByRole('button', { name: '上一步' })).toBeEnabled()
  })

  test('进练习之后，用键盘也能回到讲解（回到的是最后一页）', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '教学', exact: true }).click()
    await page.getByTestId('lesson-rules').click()

    // 先翻到练习——这一段别的用例已经覆盖，这里只为走到那个状态
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '进入练习 →' }).click()
    await expect(page.getByRole('heading', { name: '练习' })).toBeVisible()

    /*
      「回到讲解」是**本次新增、任务书 §六 点名**的控件，而 e2e 里此前一次都没点过它
      （独立验收时发现的：文档声称覆盖了，实际 `grep 回到讲解 e2e/` 是零）。
      仍然用真键盘 Tab 过去——程序化 `.focus()` 证明不了键盘用户到得了。
    */
    const tabs = await tabUntil(page, 25, (focus) => focus.text.includes('回到讲解'))
    expect(tabs, '按 Tab 应该能在 25 步之内走到「回到讲解」').toBeLessThanOrEqual(25)
    await page.keyboard.press('Enter')

    // 回到的是**最后一页**（玩家是从那儿过来的），不是第一页
    await expect(
      page.getByText(`${LESSONS[0]!.steps.length} / ${LESSONS[0]!.steps.length}`, { exact: true }),
    ).toBeVisible()
  })

  test('列表页那颗「继续学习」用键盘也能按', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '教学', exact: true }).click()

    const cta = page.getByRole('button', { name: /^继续学习：/ })
    await expect(cta).toBeVisible()

    const tabs = await tabUntil(page, 25, (focus) => focus.text.startsWith('继续学习：'))
    expect(tabs, '按 Tab 应该能在 25 步之内走到「继续学习」').toBeLessThanOrEqual(25)

    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: LESSONS[0]!.steps[0]!.title })).toBeVisible()
  })
})

/**
 * Phase 05：残局的键盘通路。
 *
 * 与教学页那一组同一条纪律：**用真键盘 Tab 过去，不调 `.focus()`**——
 * 程序化定位只能证明「这个元素存在」，证明不了「键盘用户到得了它」。
 *
 * 本阶段给残局加了「继续挑战」「下一题 →」「再做一次」三个新控件，
 * 而这一组此前**一条都没有**（`grep 残局 e2e/a11y.spec.ts` 是零）：
 * 教学页在 Phase 04 补过同样的缺口，残局这边是顺着新功能一起漏掉的。
 */
test.describe('键盘操作 · 残局', () => {
  test('列表页那颗「继续挑战」用键盘也能按', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '残局', exact: true }).click()

    const cta = page.getByRole('button', { name: /^继续挑战：/ })
    await expect(cta).toBeVisible()

    const tabs = await tabUntil(page, 30, (focus) => focus.text.startsWith('继续挑战：'))
    expect(tabs, '按 Tab 应该能在 30 步之内走到「继续挑战」').toBeLessThanOrEqual(30)

    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: '横向补满' })).toBeVisible()
  })

  test('做对之后，用键盘也能走到「下一题 →」并回车换题', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '残局', exact: true }).click()
    await page.getByTestId('puzzle-win-h').click()

    // 用满三级提示，从**棋盘上的标记**反解坐标再落子——不写死答案
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: /要提示|再具体一点/ }).click()
    }
    const mark = page.locator('[data-testid^="board-mark-"]').first()
    await mark.waitFor()
    const testId = (await mark.getAttribute('data-testid')) ?? ''
    const match = /board-mark-(\d+)-(\d+)/.exec(testId)
    expect(match, `棋盘上应该出现解法标记，实际拿到「${testId}」`).not.toBeNull()
    await page.getByTestId(`intersection-${match![1]}-${match![2]}`).click()
    await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')

    const tabs = await tabUntil(page, 30, (focus) => focus.text.includes('下一题'))
    expect(tabs, '按 Tab 应该能在 30 步之内走到「下一题」').toBeLessThanOrEqual(30)

    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: '斜向补满' })).toBeVisible()
  })
})

/**
 * 焦点**正落在当前页面的 `<main>` 上**。
 *
 * 不能只判 `tagName === 'MAIN'`：换页前焦点就在上一页的 main 上时，那句在
 * 换页前后**都成立**——测试会假通过。比的是同一个元素。
 */
function focusIsOnMain(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    return main !== null && document.activeElement === main
  })
}

test.describe('换页时的焦点', () => {
  /*
   * 换页之后焦点会掉回 `<body>`：被点的那颗导航按钮连同整棵树一起卸载，
   * 浏览器就把焦点丢给了 body——读屏不播报新页面，键盘用户也不知道自己
   * 到了哪，得从头 Tab 一遍。`useFocusOnMount` 把它接回正文，
   * `PageShell` 与 `BattleScreen`（不用外壳）各接一次。
   */
  test('四个页面换过去之后，焦点都落在新页面的正文上', async ({ page }) => {
    for (const nav of ['教学', '残局', '复盘', '对战'] as const) {
      await page.goto('/')
      /*
       * `lastView` 会持久化，`goto('/')` 未必停在对战页——先点一个**不是目标**
       * 的页，保证接下来那一击真的换页。
       * （点当前页是空操作，组件不会重挂载，那时焦点**本该**留在按钮上——
       * 用户并没有换页。所以这里必须绕开它，否则测的是另一回事。）
       */
      const other = nav === '对战' ? '教学' : '对战'
      await page.getByRole('button', { name: other, exact: true }).click()
      await page.getByRole('button', { name: nav, exact: true }).click()

      await expect
        .poll(() => focusIsOnMain(page), { message: `切到「${nav}」之后焦点没落在 main 上` })
        .toBe(true)

      /*
       * 聚焦**不能把页面滚下去**。正文容器从顶栏**之后**才开始，而 `focus()`
       * 默认会把焦点元素滚进视口——页面当场滚过顶栏（移动端约 113px）。
       * 这条是 `mobile.spec.ts` 的两条触摸用例先抓住的：一条报
       * `window.scrollY` 是 113，另一条因为整页位移把触摸坐标打偏、棋子没落下去。
       * 在这里也钉一遍，是为了失败时**直接指向根因**，而不用绕道触摸用例去猜。
       */
      expect(
        await page.evaluate(() => window.scrollY),
        `切到「${nav}」之后页面被滚动了`,
      ).toBe(0)
    }
  })
})
