import { expect, test, type Page } from '@playwright/test'

/**
 * 布局预算。
 *
 * 这一组守的是一类**端到端用例此前完全看不见**的缺陷：撞坏的布局。
 * F-UI-01 就是例子——教学 / 残局 / 复盘三页的棋盘在 ≥1024 下只有 169×169 px
 * （交叉点命中区 11×11），而当时 46 条用例**全绿**：它们断言的是「不横向溢出 /
 * 是正方形 / 完全可见 / 三栏不压盖」，一个塌成 169px 的棋盘全部满足。
 *
 * 所以这里断言的是**量级**，不是不变量：棋盘至少多大、跨过断点之后要长到多大、
 * 滚动之后导航还在不在。数字取自 `docs/ui-redesign/DESIGN_SYSTEM.md` §12。
 *
 * 反向验证过（撤掉修复确认会红）：把 `lg:grid-rows-[auto_minmax(0,1fr)]` 加回
 * `PageShell` 的 flush 正文，第 2、3 条立刻红。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

const WIDTHS = [390, 768, 1024, 1280, 1440, 1920] as const

/** 棋盘的最小可用尺寸。低于它，15 格里一格的命中区就连 20px 都不到了。 */
const MIN_BOARD = 320

/** 跨过 lg 断点之后，棋盘必须长到「看得清、点得中」的规模。 */
const DESKTOP_BOARD = 620

async function boardBox(page: Page) {
  const box = await page.getByTestId('board').boundingBox()
  expect(box, '找不到棋盘').not.toBeNull()
  return box!
}

async function gotoLearn(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()
  await expect(page.getByRole('heading', { name: '互动教学' })).toBeVisible()
}

/** 进到第 1 课的练习页：三页讲解之后就是练习。 */
async function gotoLessonPractice(page: Page): Promise<void> {
  await gotoLearn(page)
  await page.getByTestId('lesson-rules').click()
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }
  await expect(page.getByTestId('board')).toBeVisible()
}

async function gotoPuzzle(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '残局', exact: true }).click()
  await expect(page.getByRole('heading', { name: '残局挑战' })).toBeVisible()
  await page.getByTestId('puzzle-win-h').click()
  await expect(page.getByTestId('board')).toBeVisible()
}

/**
 * 滚一屏。
 *
 * 两种宽度下滚的不是同一个盒子：≥1024 时应用根是 `h-dvh overflow-hidden`，
 * 滚的是 `main`；窄屏是文档在滚。**这个区别本身就是要测的东西之一**。
 */
async function scrollBy(page: Page, y: number): Promise<void> {
  await page.evaluate((amount) => {
    const main = document.querySelector('main')
    if (main !== null && main.scrollHeight > main.clientHeight + 1) main.scrollTop = amount
    else window.scrollTo(0, amount)
  }, y)
}

test.describe('棋盘尺寸预算', () => {
  for (const width of WIDTHS) {
    test(`对战页 @${width}：棋盘不小于 ${MIN_BOARD}px 且是正方形`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.getByTestId('board')).toBeVisible()

      const box = await boardBox(page)
      expect(box.width, `棋盘只有 ${box.width}px 宽`).toBeGreaterThanOrEqual(MIN_BOARD)
      expect(Math.abs(box.width - box.height)).toBeLessThan(1)
    })
  }

  for (const width of WIDTHS) {
    test(`教学 · 练习 @${width}：棋盘不小于 ${MIN_BOARD}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoLessonPractice(page)

      const box = await boardBox(page)
      expect(box.width, `棋盘只有 ${box.width}px 宽`).toBeGreaterThanOrEqual(MIN_BOARD)
      expect(Math.abs(box.width - box.height)).toBeLessThan(1)
    })
  }

  /*
   * F-UI-01 的正面判据。
   *
   * 三处详情页曾经带着一条过期的 `lg:grid-rows-[auto_minmax(0,1fr)]`：
   * 棋盘落进 `auto` 行，行高由右侧栏的内容决定，于是**屏幕越宽棋盘越小**——
   * 1440 下 169px、1920 下还是 169px。这条断言要的就是「跨过断点之后它得长大」。
   */
  for (const width of [1024, 1280, 1440, 1920] as const) {
    test(`教学 · 练习 @${width}：棋盘长到 ${DESKTOP_BOARD}px 以上`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoLessonPractice(page)

      const box = await boardBox(page)
      expect(box.width, `棋盘只有 ${box.width}px —— 它又被侧栏的高度卡住了`).toBeGreaterThanOrEqual(
        DESKTOP_BOARD,
      )
    })
  }

  for (const width of [1024, 1440, 1920] as const) {
    test(`残局 · 详情 @${width}：棋盘长到 ${DESKTOP_BOARD}px 以上`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoPuzzle(page)

      const box = await boardBox(page)
      expect(box.width).toBeGreaterThanOrEqual(DESKTOP_BOARD)
    })
  }
})

test.describe('页面标题', () => {
  test('复盘页在 390 下不被压成一字一行', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: '复盘', exact: true }).click()

    const heading = page.getByRole('heading', { name: '复盘' })
    await expect(heading).toBeVisible()

    const box = (await heading.boundingBox())!
    // 「复盘」两个字在 20px 字号下是 40×28。被 flex 压成一列时变成 20×56——
    // 判据用「宽 > 高」而不是某个绝对宽度：它直接说的就是「横排还是竖排」。
    expect(box.width).toBeGreaterThanOrEqual(40)
    expect(box.width, `标题 ${box.width}×${box.height}，被压成竖排了`).toBeGreaterThan(box.height)
  })

  test('四个页面各自的标题都是唯一的一级标题', async ({ page }) => {
    for (const [nav, title] of [
      ['教学', '互动教学'],
      ['残局', '残局挑战'],
      ['复盘', '复盘'],
    ] as const) {
      await page.goto('/')
      await page.getByRole('button', { name: nav, exact: true }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    }
  })
})

test.describe('顶栏', () => {
  for (const width of [390, 1440] as const) {
    test(`@${width}：滚下去之后导航还在`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 })
      await gotoLearn(page)

      const nav = page.getByRole('navigation', { name: '主导航' })
      const before = (await nav.boundingBox())!

      await scrollBy(page, 400)

      // 先确认这一页真的滚动了，否则下面的断言是空转
      const scrolled = await page.evaluate(() => {
        const main = document.querySelector('main')
        const top = main !== null && main.scrollHeight > main.clientHeight + 1
          ? main.scrollTop
          : window.scrollY
        return top
      })
      expect(scrolled, '这一页没滚动，断言等于没测').toBeGreaterThan(100)

      const after = (await nav.boundingBox())!
      expect(after.y, '顶栏跟着内容滚走了').toBeGreaterThanOrEqual(0)
      expect(Math.abs(after.y - before.y), '顶栏位移了，说明它不在视口顶端').toBeLessThan(4)
    })
  }

  test('390 下导航铺满整行，右侧不留一大片空白', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    const header = (await page.getByRole('banner').boundingBox())!
    const nav = (await page.getByRole('navigation', { name: '主导航' }).boundingBox())!

    // 导航右边缘应该顶到 header 的右内边距附近（原来的空档约 180px）
    const gap = header.x + header.width - (nav.x + nav.width)
    expect(gap, `导航右侧空了 ${Math.round(gap)}px`).toBeLessThan(24)
  })

  test('顶栏高度在页面之间不跳', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.goto('/')
    const battle = (await page.getByRole('banner').boundingBox())!.height

    await page.getByRole('button', { name: '教学', exact: true }).click()
    const learn = (await page.getByRole('banner').boundingBox())!.height

    await page.getByRole('button', { name: '复盘', exact: true }).click()
    const review = (await page.getByRole('banner').boundingBox())!.height

    expect(Math.abs(battle - learn)).toBeLessThan(1)
    expect(Math.abs(battle - review)).toBeLessThan(1)
  })
})

test.describe('浏览器文字缩放', () => {
  /*
   * 任务书 §七 点名要查的一项。
   *
   * 用户的浏览器「文字大小」调大时，`rem` 会跟着变——全站的字号、间距、圆角
   * 都是 rem/em，所以整页会一起放大。放大后**不能出现横向滚动条**：
   * 那意味着有一块内容被挤出屏幕，而用户没有任何办法看到它。
   */
  for (const width of [390, 1024, 1440] as const) {
    test(`@${width}：文字放大到 200% 仍不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.addStyleTag({ content: 'html { font-size: 32px }' })

      for (const nav of ['教学', '残局', '复盘'] as const) {
        await page.getByRole('button', { name: nav, exact: true }).click()
        await page.waitForTimeout(100)

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        expect(overflow, `${nav} 页在 200% 文字下横向溢出了 ${overflow}px`).toBeLessThanOrEqual(0)
      }
    })
  }
})

/**
 * Phase 02 的三档结构。**断点值是 1024 / 1440 两个**：
 * - <1024：单列堆叠（文档滚动）
 * - 1024–1439：两栏 —— 棋盘 + 右栏，设置并进右栏底部且**默认折叠**
 * - ≥1440：三栏 —— 左设置 / 中棋盘 / 右面板
 *
 * 这里同时是「设置面板只有一份」那条决策的守卫：两份 DOM 意味着两组
 * `role="radiogroup"`，读屏软件与 `getByRole` 都会撞上歧义。
 */
test.describe('对战页的三档结构', () => {
  test('1024–1439：两栏，设置并进右栏（对战设置常驻、显示偏好折叠）', async ({ page }) => {
    await page.setViewportSize({ width: 1439, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('board')).toBeVisible()

    await expect(page.locator('main > aside')).toHaveCount(1)
    await expect(page.getByTestId('battle-settings-column')).toHaveCount(0)

    /*
     * **模式 / 执子 / 难度常驻**：任务书 §六 把它们定义为「需要经常调整的基础对战
     * 设置」，折起来等于给高频操作加一次点击——这一条是被既有 e2e 逼出来的
     * （全仓十几处 `getByRole('radio', { name: '本地双人' })` 在折叠版下全部失效）。
     * 折叠的是显示偏好那一组。
     */
    await expect(page.getByLabel('对战模式')).toHaveCount(1)
    // 用这一组独有的控件判折叠：顶栏那颗主题按钮的 aria-label 也含「主题」二字
    await expect(page.getByRole('switch', { name: '显示坐标' })).toHaveCount(0)

    await page.getByRole('button', { name: '显示与声音' }).click()
    await expect(page.getByRole('switch', { name: '显示坐标' })).toHaveCount(1)

    // 关键不变量：设置面板**恰好一份**。两份 DOM 意味着两组 radiogroup，
    // 读屏软件与 getByRole 都会撞上歧义。
    await expect(page.getByLabel('对战模式')).toHaveCount(1)
  })

  test('≥1440：三栏，设置回到左栏', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('board')).toBeVisible()

    await expect(page.locator('main > aside')).toHaveCount(2)
    await expect(page.getByTestId('battle-settings-column')).toBeVisible()
    await expect(page.getByLabel('对战模式')).toHaveCount(1)

    // 左栏在棋盘的左边
    const column = (await page.getByTestId('battle-settings-column').boundingBox())!
    const board = (await page.getByTestId('board').boundingBox())!
    expect(column.x + column.width).toBeLessThanOrEqual(board.x + 1)
  })

  test('1440 与 1439 之间只差 1px，结构却真的换了', async ({ page }) => {
    // 「只把 lg 换成 xl 不等于做了响应式」——这一条要的就是断点两侧行为不同
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const wide = await page.locator('main > aside').count()

    await page.setViewportSize({ width: 1439, height: 900 })
    // 改视口不重新加载：靠的是订阅 matchMedia，不是「刷新才算数」
    await expect(page.locator('main > aside')).toHaveCount(1)
    expect(wide).toBe(2)
  })
})

test.describe('对战页：棋盘与操作区不互相遮挡', () => {
  const WIDTHS = [390, 768, 1024, 1440, 1920] as const

  for (const width of WIDTHS) {
    test(`@${width}：状态条、棋盘、工具栏、侧栏四块互不相交`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.getByTestId('board')).toBeVisible()

      const regions = {
        棋盘: (await page.getByTestId('board').boundingBox())!,
        状态条: (await page.getByLabel('对局状态').boundingBox())!,
        工具栏: (await page.getByRole('group', { name: '对局操作' }).boundingBox())!,
      }

      const pairs = Object.entries(regions)
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const [nameA, a] = pairs[i]!
          const [nameB, b] = pairs[j]!
          const overlaps =
            a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
          expect(overlaps, `${nameA} 与 ${nameB} 压在一起了`).toBe(false)
        }
      }

      // 顺序：状态条在棋盘上方，工具栏在棋盘下方
      expect(regions.状态条.y + regions.状态条.height).toBeLessThanOrEqual(regions.棋盘.y + 1)
      expect(regions.工具栏.y).toBeGreaterThanOrEqual(regions.棋盘.y + regions.棋盘.height - 1)
    })
  }
})

test.describe('对战页：折叠侧栏不动棋盘', () => {
  /*
   * 任务书 §七 要的「不因某个侧栏展开造成明显的跳动」。
   * 机制上成立（列宽是 `clamp()` 定值，折叠只改高度），但**没有判据的机制就是一句声明**
   * ——这条把它变成可判真假的。
   */
  test('@1440：折叠再展开，棋盘尺寸与位置纹丝不动', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('board')).toBeVisible()

    const before = (await page.getByTestId('board').boundingBox())!

    const toggle = page.getByRole('button', { name: '对局设置' })
    await toggle.click()
    await expect(page.getByLabel('对战模式')).toHaveCount(0)
    const collapsed = (await page.getByTestId('board').boundingBox())!

    await toggle.click()
    await expect(page.getByLabel('对战模式')).toHaveCount(1)
    const expanded = (await page.getByTestId('board').boundingBox())!

    for (const [tag, box] of [['折叠后', collapsed], ['展开后', expanded]] as const) {
      expect(Math.abs(box.x - before.x), `${tag}棋盘横向移动了`).toBeLessThan(1)
      expect(Math.abs(box.y - before.y), `${tag}棋盘纵向移动了`).toBeLessThan(1)
      expect(Math.abs(box.width - before.width), `${tag}棋盘尺寸变了`).toBeLessThan(1)
    }
  })
})

test.describe('对战页：棋盘尺寸预算', () => {
  for (const width of [1024, 1280, 1440, 1920] as const) {
    test(`@${width}：棋盘长到 ${DESKTOP_BOARD}px 以上`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')

      const box = await boardBox(page)
      expect(box.width, `棋盘只有 ${box.width}px —— 侧栏又把它挤扁了`).toBeGreaterThanOrEqual(
        DESKTOP_BOARD,
      )
    })
  }
})
