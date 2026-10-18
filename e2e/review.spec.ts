import { expect, test, type Locator, type Page } from '@playwright/test'
import { REPLAY_STEP_MS } from '../src/store/replayStore'

/**
 * 等一段时间，用来证明「某件事没有发生」（没有遗留定时器在后台推进游标）。
 *
 * 这类等待**没有可轮询的事件**，固定驻留是正确构造；但时长必须由源码里的
 * 步进间隔推导——写死的话，将来把 `REPLAY_STEP_MS` 调大，等待就静默地不再
 * 覆盖一个周期，用例会变得什么都不证明却依然全绿。
 * 取三个周期：够让一个仍然活着的定时器推进三格，游标不可能还停在 0。
 */
const REPLAY_DWELL_MS = REPLAY_STEP_MS * 3

/**
 * 复盘流程的端到端验收。
 *
 * 成局方式用**本地双人**：没有 AI 应手，每一手都由测试点出，完全确定。
 * 黑棋第 7 行连五点、白棋在第 9 行陪走四点，第 9 手黑棋成五终局。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

/** 在本地双人模式下把一局下到黑棋五连终局。 */
async function playNineMoveWin(page: Page): Promise<void> {
  await page.getByRole('radio', { name: '本地双人' }).click()

  const moves: Array<[number, number]> = [
    [3, 7], [3, 9], [4, 7], [4, 9], [5, 7], [5, 9], [6, 7], [6, 9], [7, 7],
  ]
  for (const [x, y] of moves) {
    await page.getByTestId(`intersection-${x}-${y}`).click()
  }
}

/** 从对战页切到复盘页。终局后结果弹窗会盖住导航，先关掉它。 */
async function gotoReview(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: '看看棋盘' })
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click()
  await page.getByRole('button', { name: '复盘', exact: true }).click()
}

test('下完一局 → 弹窗说已存入 → 复盘页列出这一局', async ({ page }) => {
  await page.goto('/')
  await playNineMoveWin(page)

  // 终局弹窗如实告知入库结果
  await expect(page.getByText(/这局已存入棋谱库/)).toBeVisible()

  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)

  const records = page.getByTestId(/^record-/)
  await expect(records).toHaveCount(1)
  await expect(records.first()).toContainText('黑方胜')
  await expect(records.first()).toContainText('9 手')
})

test('回放：落子编号、走一步退一步、自动播放', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await playNineMoveWin(page)
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)
  await page.getByTestId(/^record-/).first().click()

  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')

  // 走一步：计数器前进，第 1 手的编号标记出现
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId('move-counter')).toHaveText('1 / 9')
  await expect(page.getByTestId('board-mark-3-7')).toBeVisible()

  // 退一步：回到空盘，标记消失
  await page.getByRole('button', { name: '上一步' }).click()
  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')
  await expect(page.getByTestId('board-mark-3-7')).toHaveCount(0)

  // 自动播放开着切走再切回：复盘页整个卸载重建，回到列表；
  // 重新打开时必须从 0 开始，且**不会有遗留定时器在后台自己推进**。
  await page.getByRole('button', { name: '自动播放' }).click()
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()

  await page.getByRole('button', { name: '对战', exact: true }).click()
  await page.waitForTimeout(REPLAY_DWELL_MS)
  await gotoReview(page)
  await page.getByTestId(/^record-/).first().click()

  const counter = page.getByTestId('move-counter')
  await expect(counter).toHaveText('0 / 9')
  await page.waitForTimeout(REPLAY_DWELL_MS)
  await expect(counter).toHaveText('0 / 9')
})

test('刷新后棋谱仍在（IndexedDB 持久）', async ({ page }) => {
  await page.goto('/')
  await playNineMoveWin(page)
  // 等「已存入」——它是写入落库完成的信号；不等就刷新会打断事务
  await expect(page.getByText(/这局已存入棋谱库/)).toBeVisible()
  await page.getByRole('button', { name: '看看棋盘' }).click()

  await page.reload()
  // 刷新后这局仍是终局，结果弹窗重新出现——先关掉再进复盘
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)

  await expect(page.getByTestId(/^record-/)).toHaveCount(1)
})

test('分析：逐手跑完并给出结论，标注引擎出处', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await playNineMoveWin(page)
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)
  await page.getByTestId(/^record-/).first().click()

  // 结论的出处必须写在面板上
  await expect(page.getByTestId('analysis-source')).toContainText('400ms')
  await expect(page.getByTestId('analysis-source')).toContainText('引擎 search-1')

  await page.getByRole('button', { name: '开始分析' }).click()

  // 9 手局 = 9 个局面请求，串行跑完
  await expect(page.getByTestId('analysis-progress')).toContainText('9 / 9', { timeout: 60_000 })
  // 至少给出一条结论，且带引擎推荐坐标
  await expect(page.getByTestId(/^verdict-/).first()).toContainText('引擎推荐')
})

test('空状态那颗「开始一局对战」真的切到对战页', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()

  // 全新会话（beforeEach 清过库）→ 空状态
  await expect(page.getByText('还没有保存的对局')).toBeVisible()
  await page.getByRole('button', { name: '开始一局对战' }).click()

  // 真的落在对战页上：状态条与棋盘都在，而不是只换了个界面外观
  await expect(page.getByTestId('status-pill')).toBeVisible()
  await expect(page.getByTestId('board')).toBeVisible()
})

/** 开一局、打完、进复盘、点开第一条。四条新用例开头都是这套，抽出来。 */
async function openFirstRecord(page: Page): Promise<void> {
  await page.goto('/')
  await playNineMoveWin(page)
  await page.getByRole('button', { name: '看看棋盘' }).click()
  await gotoReview(page)
  await page.getByTestId(/^record-/).first().click()
  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')
}

test('时间轴：拖到任意一手，棋盘与两个计数一起走', async ({ page }) => {
  await openFirstRecord(page)

  const slider = page.getByRole('slider', { name: '回放手数' })
  await expect(slider).toHaveValue('0')

  await slider.fill('5')
  await expect(page.getByTestId('move-counter')).toHaveText('5 / 9')
  await expect(page.getByTestId('timeline-counter')).toHaveText('5 / 9 手')
  // **棋盘也要跟着走**——只改数字不算数
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(5)

  // 边界：到终局
  await slider.fill('9')
  await expect(page.getByTestId('move-counter')).toHaveText('9 / 9')
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(9)

  // 两个跳跃按钮
  await page.getByRole('button', { name: '开局' }).click()
  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')
  await page.getByRole('button', { name: '终局' }).click()
  await expect(page.getByTestId('move-counter')).toHaveText('9 / 9')
})

test('播放速度：切到快速后，按新间隔走完', async ({ page }) => {
  await openFirstRecord(page)

  // 默认标准档
  await expect(page.getByTestId('replay-speed-normal')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('replay-speed-fast').click()
  await expect(page.getByTestId('replay-speed-fast')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('replay-speed-normal')).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: '自动播放' }).click()
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()

  // 快速档 400ms/手：9 手 3.6 秒。给到 8 秒，比标准档（8.1 秒）短，
  // 所以这条**能区分**两档——若速度没生效，标准档跑不完。
  await expect(page.getByTestId('move-counter')).toHaveText('9 / 9', { timeout: 8_000 })
  // 到尾自动停：按钮弹回「自动播放」
  await expect(page.getByRole('button', { name: '自动播放' })).toBeVisible()
})

test('点分析结论里的关键手：棋盘跳到那一手，卡片高亮', async ({ page }) => {
  test.setTimeout(90_000)
  await openFirstRecord(page)

  await page.getByRole('button', { name: '开始分析' }).click()
  await expect(page.getByTestId('analysis-progress')).toContainText('9 / 9', { timeout: 60_000 })

  const first = page.getByTestId(/^verdict-/).first()
  await expect(first).toContainText('第')

  // 从卡片自己写的「第 N 手」里取出 N——**这就是 off-by-one 的判据**：
  // 卡片上是 1-based，游标是「已看到第几手」，第 N 手之后就该是 N。
  const label = (await first.textContent()) ?? ''
  const moveNo = Number(/第\s*(\d+)\s*手/.exec(label)?.[1])
  expect(moveNo, `没能从「${label}」里读出第几手`).toBeGreaterThan(0)

  await first.click()

  await expect(page.getByTestId('move-counter')).toHaveText(`${moveNo} / 9`)
  await expect(first).toHaveAttribute('data-selected', 'true')
  // 棋盘真的落到那一手：编号数 = N
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(moveNo)
})

test('移动端 390：棋盘优先、控制可达、不出现嵌套滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openFirstRecord(page)

  /*
   * 任务书 §四 的第一条是「**棋盘优先**」——棋盘必须在首屏视口内。
   *
   * 这里**不能用 `toBeVisible()`**：它只判元素渲染出来了（非 `display:none`、
   * 非零尺寸），**不判视口相交**——被推到屏幕外的元素照样 "visible"。
   */
  const boardInViewport = await page.getByTestId('board').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return (
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.left >= 0 &&
      rect.right <= window.innerWidth
    )
  })
  expect(boardInViewport, '棋盘不在首屏视口内').toBe(true)

  /*
   * 手数计数与「下一步」**不必都在首屏**——§四 第二条只要求「容易触达」，
   * 滚动得到就算。但「可达」得真的走到那一步：`toBeVisible()` 只证明元素
   * 渲染出来了（非 `display:none`、非零尺寸），**不证明滚得到**。
   * 所以先 `scrollIntoViewIfNeeded()`，再判它确实进了视口。
   * 横向不出界由下面那条 scrollWidth 断言守。
   */
  const reachable = async (locator: Locator) => {
    await locator.scrollIntoViewIfNeeded()
    return locator.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= window.innerHeight
    })
  }
  expect(await reachable(page.getByTestId('move-counter')), '手数计数滚不到视口里').toBe(true)
  expect(
    await reachable(page.getByRole('button', { name: '下一步' })),
    '「下一步」滚不到视口里',
  ).toBe(true)

  // 横向不溢出（390 是最窄的真实手机）
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `回放页在 390 下横向溢出了 ${overflow}px`).toBeLessThanOrEqual(0)

  /*
   * 任务书 §四：「不制造多重滚动陷阱」。
   *
   * 判据是 `main` 内部**没有**出现第二个纵向滚动区——手机上手指落在内层
   * 滚动区、页面不跟手，就是「滚不动」的常见成因，而这类问题 jsdom
   * 完全看不见（没有布局）。整页滚动本身是允许的：390 下应用根是
   * `min-h-dvh`，滚的就是文档。
   */
  const nested = await page.evaluate(() => {
    const found: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('main, main *')) {
      const style = getComputedStyle(el)
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
      if (el.scrollHeight <= el.clientHeight + 1) continue
      found.push(`${el.tagName.toLowerCase()}[${el.className.slice(0, 48)}]`)
    }
    return found
  })
  expect(nested, `main 内部出现了嵌套滚动区：${nested.join(' | ')}`).toHaveLength(0)

  // 分析面板在下方，滚得到、点得到
  const analyze = page.getByRole('button', { name: '开始分析' })
  await analyze.scrollIntoViewIfNeeded()
  await expect(analyze).toBeVisible()
})

test('回放编号在最窄视口下不小于 10px（F-UI-14）', async ({ page }) => {
  // 先在默认视口下开局、进回放（390 下点九手棋容易被布局变化干扰），
  // 再切到最窄视口量——布局一变，用户单位对应的像素就变了
  await openFirstRecord(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(1)

  /*
   * 判据来自 `DESIGN_SYSTEM.md` §8.2：**棋盘文字在最小支持视口下不得小于 10px**。
   *
   * 换算：棋盘 viewBox 是 16 个用户单位（1 边距 + 14 格 + 1 边距），
   * 所以 1 用户单位 = 棋盘宽 / 16（与 `bench/ui.probe.mjs` 的 `unitPx` 同一手法）。
   * 读**原始属性**而不是 computed style：SVG 里无单位的长度就是用户单位，
   * 让浏览器替我们解释它只会多一层不确定。
   */
  const size = await page.evaluate(() => {
    const board = document.querySelector('[data-testid="board"]')
    const label = document.querySelector('[data-testid^="board-mark-"] text')
    if (board === null || label === null) return null
    const unitPx = board.getBoundingClientRect().width / 16
    const fontSize = Number.parseFloat(label.getAttribute('font-size') ?? '0')
    return fontSize * unitPx
  })

  expect(size, '没量到回放编号的文字').not.toBeNull()
  expect(size!, `编号字号 ${size!.toFixed(2)}px，低于 §8.2 的 10px 下限`).toBeGreaterThanOrEqual(10)
})

test('点开一局棋谱之后，焦点落在回放页的正文上', async ({ page }) => {
  /*
   * 复盘页是「一个页面、两种形态」：列表与回放返回的都是 `<PageShell>`
   * （**同类型、同位置**），React 会复用实例——`useFocusOnMount` 的 effect
   * 不重跑，于是点开棋谱之后焦点照样掉回 `<body>`，和没修一样。
   * 两个 `<PageShell>` 各带一个 `key` 才把它们拆成两棵树。
   *
   * 顶层的换页由 `a11y.spec.ts` 的「换页时的焦点」守着，这里是页面**内部**的那一半。
   */
  await openFirstRecord(page)

  await expect
    .poll(() =>
      page.evaluate(() => {
        const main = document.querySelector('main')
        return main !== null && document.activeElement === main
      }),
    )
    .toBe(true)
})
