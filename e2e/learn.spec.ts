import { DB_NAME } from '../src/persist/schema'
import { expect, test, type Page } from '@playwright/test'

/**
 * 每个用例都从干净的状态开始：对局存档在 localStorage，学习进度在 IndexedDB，
 * 两样都要清。只在本次标签页的第一次导航时清一次——`addInitScript` 每次导航
 * 都会执行，无条件清空会把「刷新后进度还在」这类用例刚写进去的数据抹掉。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

/** 进入课程页。 */
async function gotoLearn(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()
  await expect(page.getByRole('heading', { name: '互动教学' })).toBeVisible()
}

/**
 * 翻过全部讲解页，停在练习上。
 *
 * **最后一步点的是「进入练习 →」**（Phase 04 改的）：原先一路都写「下一步」，
 * 可最后那一点下去直接跳到练习——动作发生了，按钮却没说实话。
 * 所以这里按标签点，顺带把这条文案变化也测了。
 */
async function gotoPractice(page: Page, steps: number): Promise<void> {
  for (let i = 0; i < steps - 1; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }
  await page.getByRole('button', { name: '进入练习 →' }).click()
}

test('从对战页进入课程页，打开一节课并走到练习', async ({ page }) => {
  await gotoLearn(page)

  await expect(page.getByTestId(/^lesson-/)).toHaveCount(8)
  await page.getByTestId('lesson-rules').click()

  // 第一页讲解
  await expect(page.getByRole('heading', { name: '轮流落子，黑棋先行' })).toBeVisible()

  await gotoPractice(page, 3)

  await expect(page.getByText(/补上哪一点能让它变成五子/)).toBeVisible()
})

test('练习做对：出现通过反馈与解法说明', async ({ page }) => {
  await gotoLearn(page)
  await page.getByTestId('lesson-rules').click()
  await gotoPractice(page, 3)

  await page.getByTestId('intersection-4-7').click()

  const feedback = page.getByTestId('feedback')
  await expect(feedback).toHaveAttribute('data-ok', 'true')
  await expect(feedback).toContainText('补上任意一端就连成五子')
})

test('练习做错：给出理由，重试之后还能再走', async ({ page }) => {
  await gotoLearn(page)
  await page.getByTestId('lesson-rules').click()
  await gotoPractice(page, 3)

  await page.getByTestId('intersection-0-0').click()

  const feedback = page.getByTestId('feedback')
  await expect(feedback).toHaveAttribute('data-ok', 'false')
  await expect(feedback).toContainText('没有连成五子')

  // 判错之后锁盘，必须重试才能再走
  await page.getByTestId('intersection-4-7').click()
  await expect(feedback).toHaveAttribute('data-ok', 'false')

  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByTestId('feedback')).toHaveCount(0)

  await page.getByTestId('intersection-4-7').click()
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')
})

test('三级提示：第三次才在棋盘上标出点位', async ({ page }) => {
  await gotoLearn(page)
  await page.getByTestId('lesson-rules').click()
  await gotoPractice(page, 3)

  await page.getByRole('button', { name: '要提示' }).click()
  await expect(page.getByTestId('hint')).toContainText('两头')
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(0)

  await page.getByRole('button', { name: /再具体一点/ }).click()
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(0)

  await page.getByRole('button', { name: /再具体一点/ }).click()
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(1)

  // 标出点位不等于替玩家通关
  await expect(page.getByTestId('feedback')).toHaveCount(0)
})

test('做完一节课刷新页面，完成标记还在', async ({ page }) => {
  await gotoLearn(page)
  await page.getByTestId('lesson-rules').click()
  await gotoPractice(page, 3)
  await page.getByTestId('intersection-4-7').click()
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')

  await page.reload()

  // 刷新后回到课程页，而且直接停在刚才那节课里（从第一页讲解重新讲起）——
  // 视图与位置都记下来了
  await expect(page.getByRole('heading', { name: '轮流落子，黑棋先行' })).toBeVisible()

  await page.getByRole('button', { name: '← 课程列表' }).click()
  await expect(page.getByTestId('learn-progress')).toContainText('1 / 8')
  await expect(page.getByTestId('lesson-rules')).toHaveAttribute('data-done', 'true')
})

test('残局页做对一题，进度计数 +1 并刷新后仍在', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '残局', exact: true }).click()

  await expect(page.getByTestId('puzzle-progress')).toContainText('0 / 15')
  await page.getByTestId('puzzle-win-h').click()
  await page.getByTestId('intersection-4-7').click()
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')

  await page.reload()

  // 刷新后回到残局页，而且直接停在刚才那道题里（位置也记下来了）。
  await expect(page.getByText('横向补满')).toBeVisible()
  await expect(page.getByRole('button', { name: '← 残局列表' })).toBeVisible()

  // 但**反馈条不该跟着活下来**：它是这一次答题才产生的状态，
  // 重建出来的棋盘是干净的。留下来的只有进度。
  await expect(page.getByTestId('feedback')).toHaveCount(0)
  await expect(page.getByText('做对的题会记在进度里，刷新也不会丢。')).toBeVisible()

  await page.getByRole('button', { name: '← 残局列表' }).click()
  await expect(page.getByTestId('puzzle-progress')).toContainText('1 / 15')
  await expect(page.getByTestId('puzzle-win-h')).toHaveAttribute('data-done', 'true')
})

test('六个分类都有题，且分类标题是中文', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '残局', exact: true }).click()

  for (const label of ['一步获胜', '挡住直接胜着', '构造活四', '双重威胁', '连续冲四', '强制获胜路线']) {
    await expect(page.getByRole('heading', { name: label })).toBeVisible()
  }
})

test('点「下一节」换课，从头讲起而不是停在上一课的页码', async ({ page }) => {
  await gotoLearn(page)
  await page.getByTestId('lesson-rules').click()
  await gotoPractice(page, 3)
  await page.getByTestId('intersection-4-7').click()
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')

  await page.getByRole('button', { name: '下一节 →' }).click()

  // 必须回到讲解的第一页，而不是直接跳到第二课的练习
  await expect(page.getByRole('heading', { name: '活二：两头都能长' })).toBeVisible()
})

/**
 * 载入态（任务书 §三）：「未加载时显示加载/占位，不得错误显示『已完成 0 节』」。
 *
 * **必须让它稳定地停在载入态**。真实载入只有几毫秒，Playwright 抓不到那一帧——
 * 写一条「碰运气看它闪不闪」的用例等于没写。做法：把 `indexedDB.open` 对**本应用那个库**
 * 换成永不兑现的请求（其余库照常放行），`loadProgress()` 就永远悬着，占位一直在。
 *
 * 顺带把「占位与读出来之后差不多高、不会把下面的内容整体推下去」也量了——
 * 那是**布局**声称，只在 jsdom 里断个文本不算验过（`AGENTS.md` 第 2 条）。
 */
test('进度没读出来时给占位：不出现任何数字，也不提前推荐', async ({ browser }) => {
  /*
    这条要开**两个上下文、两次完整加载**（一个挂住 IndexedDB 看占位，一个正常看真身，
    再比高度），全量并行跑时 30 s 不够——**这正是我刚在 `tablet.spec` 修过的同一类毛病，
    自己写新用例时又犯了一次**。给它 60 s。
  */
  test.setTimeout(60_000)
  const stall = async (context: import('@playwright/test').BrowserContext): Promise<void> => {
    await context.addInitScript((dbName: string) => {
      const real = indexedDB.open.bind(indexedDB)
      indexedDB.open = ((name: string, version?: number) =>
        name === dbName
          ? // 只挂住这一个库；别的照常。返回一个空壳：调用方只会往上挂回调，不会有人回调它
            ({} as IDBOpenDBRequest)
          : real(name, version)) as typeof indexedDB.open
    }, DB_NAME)
  }

  const stalled = await browser.newContext()
  await stall(stalled)
  const page = await stalled.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()

  const placeholder = page.getByTestId('learn-loading')
  await expect(placeholder).toBeVisible()
  await expect(placeholder).toHaveAttribute('aria-busy', 'true')
  // 一个数字都不许出现——那是在说一件还不知道的事
  await expect(page.getByTestId('learn-progress')).toHaveCount(0)
  await expect(page.getByText(/已完成/)).toHaveCount(0)
  // 也还没有推荐：推谁要等进度读出来才知道
  await expect(page.getByRole('button', { name: /继续学习/ })).toHaveCount(0)
  const loadingBox = await placeholder.boundingBox()
  await stalled.close()

  const fresh = await browser.newContext()
  const loadedPage = await fresh.newPage()
  await loadedPage.setViewportSize({ width: 1440, height: 900 })
  await loadedPage.goto('/')
  await loadedPage.getByRole('button', { name: '教学', exact: true }).click()
  await expect(loadedPage.getByTestId('learn-progress')).toBeVisible()
  // 比的是**整块**：learn-progress 只是里头那个 span，拿它比等于拿一行字比一整块
  const loadedBox = await loadedPage.getByTestId('learn-progress-block').boundingBox()
  await fresh.close()

  expect(loadingBox).not.toBeNull()
  expect(loadedBox).not.toBeNull()
  if (loadingBox === null || loadedBox === null) return
  // 差在 8px 以内就不会看出跳动
  expect(Math.abs(loadingBox.height - loadedBox.height)).toBeLessThanOrEqual(8)
})
