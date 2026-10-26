import { LESSONS } from '../src/learn/lessons'
import { expect, test } from '@playwright/test'
import { BLACK } from '../src/core/types'
import { seedGameRecords } from './helpers/seed'

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
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
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
    await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')

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
  // 最后一步的按钮写的是「进入练习 →」（Phase 04 改的），不是「下一步」
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }
  await page.getByRole('button', { name: '进入练习 →' }).click()

  const box = await page.getByTestId('board').boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return

  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1)
  expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})

/**
 * 走到「规则」那节课的练习盘。
 *
 * 练习页的棋盘是**另一个实例**，`touch-action` 与命中区都得在它自己身上验一遍。
 */
async function gotoPracticeBoard(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()
  await page.getByTestId('lesson-rules').click()
  // 最后一步的按钮写的是「进入练习 →」（Phase 04 改的），不是「下一步」
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }
  await page.getByRole('button', { name: '进入练习 →' }).click()
}

test('学习页的棋盘：手指拖动不滚页面，也不误落子', async ({ page }) => {
  await gotoPracticeBoard(page)

  // 练习页的棋盘是另一个实例，`touch-action` 得在它自己身上验一遍。
  await expect(page.getByTestId('board')).toHaveCSS('touch-action', 'none')

  const target = await page.getByTestId('intersection-4-7').boundingBox()
  expect(target).not.toBeNull()
  if (target === null) return

  const startX = target.x + target.width / 2
  const startY = target.y + target.height / 2

  // 练习盘自带局面，所以数「拖完之后有没有多出来」而不是数绝对颗数。
  const stones = page.getByTestId(/^stone-/)
  const stonesBefore = await stones.count()

  // 光断言 computed style 证明不了「不滚页面」——那条规则实际生效才算数。
  // 只有派发真实的触摸序列验得了：mouse 拖动根本不触发页面滚动。
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

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  // 拖动不该被当成落子：手指划过去就落一颗，是误触而不是交互。
  await expect(stones).toHaveCount(stonesBefore)
})

/**
 * 点按那条**单独一个测试**，不与上面的拖动合在一起。
 *
 * 为什么不能合：合起来就是「同一个测试里先用 CDP 注入拖动、再用 `touchscreen.tap` 点按」，
 * 而这两种输入通道混在同一段手势序列里，在 CI runner 的 Chrome 上**第二次不产生 click**
 * ——`touchscreen.tap` 静默不生效，`feedback` 于是根本不存在（本机 macOS 上则通过）。
 * 真实手指不会这样：它两次都走同一条系统通道。所以这是脚手架的产物，不是产品缺陷。
 * （排查过程见 docs/TEST_REPORT.md「〇之十一」：诊断打印过该处元素，
 *  确认落点就是 `rect#intersection-4-7`、那一格也是空的。）
 */
test('学习页的棋盘：点按命中正确，判定结果对得上', async ({ page }) => {
  await gotoPracticeBoard(page)

  const target = await page.getByTestId('intersection-4-7').boundingBox()
  expect(target).not.toBeNull()
  if (target === null) return

  const x = target.x + target.width / 2
  const y = target.y + target.height / 2

  // 点之前先把**前提**写死并验掉。`Board.tsx` 的 handleClick 对已占的格子直接 return
  // （`if (board[idx(x, y)] !== 0) return`），那样点上去不会产生任何反馈，
  // 失败信息只会是「feedback 不存在」——看不出是前提不成立还是点按失灵。
  expect(
    await page.getByTestId('stone-4-7').count(),
    '4-7 已经有子了：handleClick 会对它直接 return，点不出反馈。多半是没走到预期的那一步',
  ).toBe(0)
  expect(await page.getByTestId('feedback').count(), '还没点就已经有判定结果了？').toBe(0)

  await page.touchscreen.tap(x, y)

  // 点到哪就落在哪：落点必须是这一手本身，判定结果也得对上
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')
})

/**
 * Phase 04：触屏点顶部那颗「继续学习」。
 *
 * 它是列表页**唯一的主操作**（一屏最多一个 `primary`），也是窄屏下最好按的那颗——
 * 列表一长，第一屏看到的往往就是它。命中区大小由 `Button` 的档位保证，
 * 这里验的是**真的点得中、点完真的进了那一节**。
 */
test('触屏点「继续学习」能直接进推荐的课', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()

  await page.getByRole('button', { name: /^继续学习：/ }).click()

  await expect(page.getByRole('heading', { name: LESSONS[0]!.steps[0]!.title })).toBeVisible()
})

/**
 * Phase 05：残局在窄屏上的两条。
 *
 * 与上面教学页那两条同一条纪律——**移动端的布局与命中只有真浏览器说得清**
 * （`AGENTS.md` 第 2 条），而这两页共用同一套练习组件与外壳，
 * 教学页验过不等于残局页也对（它们的外层工具栏与侧栏内容都不同）。
 */
test('残局页在窄屏上不横向溢出，棋盘是正方形', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '残局', exact: true }).click()
  await expect(page.getByRole('heading', { name: '残局挑战' })).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)

  // 列表页本身也要能滚到底、每张卡都在视口内
  await page.getByTestId('puzzle-win-h').click()
  await expect(page.getByTestId('board')).toBeVisible()

  const box = await page.getByTestId('board').boundingBox()
  expect(box).not.toBeNull()
  // 正方形（四舍五入到整数像素，允许 1px 的取整误差）
  expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(1)
  // 完整落在视口宽度内，而且没被挤到最小尺寸以下
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  expect(box!.width).toBeGreaterThanOrEqual(320)
})

/**
 * 与上面「学习页的点按」同样**单独一个测试**，不与拖动合在一起
 * （理由见那一条的注释：两条输入通道混在同一段手势序列里，
 *  CI 的 Chrome 上第二次不产生 click）。
 */
test('残局的棋盘：触摸点按命中正确，判定结果对得上', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '残局', exact: true }).click()
  await page.getByTestId('puzzle-win-h').click()
  await expect(page.getByTestId('board')).toBeVisible()

  // 坐标从**棋盘上的标记**反解，不写死答案——与 `e2e/puzzles.spec.ts` 同一条纪律
  const hint = page.getByRole('button', { name: /要提示|再具体一点/ })
  await hint.click()
  await hint.click()
  await hint.click()

  const mark = page.locator('[data-testid^="board-mark-"]').first()
  await mark.waitFor()
  const testId = (await mark.getAttribute('data-testid')) ?? ''
  const match = /board-mark-(\d+)-(\d+)/.exec(testId)
  expect(match, `棋盘上应该出现解法标记，实际拿到的是「${testId}」`).not.toBeNull()
  const [, x, y] = match!

  const target = await page.getByTestId(`intersection-${x}-${y}`).boundingBox()
  expect(target).not.toBeNull()
  if (target === null) return

  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2)

  // 点到哪就落在哪：判定为对，而且「对」的标记就画在那一格上
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')
  await expect(page.getByTestId(`board-mark-${x}-${y}`)).toHaveText('对')
})

test('局面研究：窄屏触摸放子/擦除，且不横向溢出', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()
  await expect(page.getByRole('heading', { name: '局面研究' })).toBeVisible()

  await page.getByTestId('intersection-7-7').tap()
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')

  await page.getByRole('button', { name: '工具：白棋' }).tap()
  await page.getByTestId('intersection-8-8').tap()
  await expect(page.getByTestId('stone-8-8')).toHaveAttribute('data-player', '2')

  await page.getByRole('button', { name: '工具：擦除' }).tap()
  await page.getByTestId('intersection-8-8').tap()
  await expect(page.getByTestId('stone-8-8')).toHaveCount(0)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
})


test('棋谱分支：移动端确认框不溢出，能进入探索对战', async ({ page }) => {
  await seedGameRecords(page, [
    {
      schemaVersion: 1,
      moves: [
        { x: 3, y: 7 },
        { x: 3, y: 9 },
        { x: 4, y: 7 },
      ],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    },
  ])
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByTestId(/^record-/).first().click()

  const slider = page.getByLabel('回放手数')
  await slider.focus()
  await slider.press('Home')
  await slider.press('ArrowRight')
  await page.getByRole('button', { name: '从这里继续对弈' }).tap()
  await expect(page.getByTestId('branch-dialog')).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)

  await page.getByRole('button', { name: '开始探索' }).tap()
  await expect(page.getByTestId('branch-banner')).toContainText('从第 1 手继续')
  await expect(page.getByTestId('board')).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0)
})


test('分享：移动端生成链接并打开只读预览，无横向溢出', async ({ page }) => {
  await seedGameRecords(page, [
    {
      schemaVersion: 1,
      moves: [
        { x: 3, y: 7 }, { x: 3, y: 9 },
        { x: 4, y: 7 }, { x: 4, y: 9 },
        { x: 5, y: 7 }, { x: 5, y: 9 },
        { x: 6, y: 7 }, { x: 6, y: 9 },
        { x: 7, y: 7 },
      ],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    },
  ])
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByTestId(/^record-/).first().click()
  await page.getByRole('button', { name: '分享棋谱' }).tap()
  await page.getByRole('button', { name: '分享整盘' }).tap()
  const link = await page.getByTestId('share-link').inputValue()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0)
  await page.getByRole('button', { name: '关闭' }).tap()

  await page.goto(link)
  await expect(page.getByTestId('share-kind')).toContainText('单盘棋谱')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0)
})
