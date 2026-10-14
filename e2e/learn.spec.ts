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
