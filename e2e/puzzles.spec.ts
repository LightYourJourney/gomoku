import { PUZZLES } from '../src/learn/puzzles'
import { expect, test, type Page } from '@playwright/test'

/**
 * 残局挑战的端到端验收。
 *
 * Phase 05 从 `learn.spec.ts` 里搬出来单独成文件：残局是独立的产品区域
 * （探针里也自成一个 `puzzles` 分组），而教学那一份已经够长了。
 * 搬的时候**断言一条没少**，只是换了住处。
 *
 * 这个文件里**没有一处写死答案坐标**——那正是这套题库的设计：
 * 题目只声明局面与目标，解法由引擎现场算。需要落子时一律
 * `solveWithHints` 从棋盘上把标记读回来。
 */

/** 每个用例都从干净的状态开始：对局存档在 localStorage，学习进度在 IndexedDB。 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

async function gotoPuzzles(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '残局', exact: true }).click()
  await expect(page.getByRole('heading', { name: '残局挑战' })).toBeVisible()
}

async function openPuzzle(page: Page, id: string): Promise<void> {
  await page.getByTestId(`puzzle-${id}`).click()
  await expect(page.getByTestId('board')).toBeVisible()
}

/**
 * 用满三级提示，然后**从棋盘上读回**解法坐标再落子。
 *
 * 不写死答案：`solveMove` 用的就是 `judgeMove`，所以标记指的那一点必然判对
 * ——「提示指的那一手被判错」在这套模型里不可能出现。
 */
async function solveWithHints(page: Page): Promise<void> {
  const hint = page.getByRole('button', { name: /要提示|再具体一点/ })
  await hint.click()
  await hint.click()
  await hint.click()

  const mark = page.locator('[data-testid^="board-mark-"]').first()
  await mark.waitFor()
  const testId = (await mark.getAttribute('data-testid')) ?? ''
  const match = /board-mark-(\d+)-(\d+)/.exec(testId)
  expect(match, `棋盘上应该出现解法标记，实际拿到的是「${testId}」`).not.toBeNull()

  await page.getByTestId(`intersection-${match![1]}-${match![2]}`).click()
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'true')
}

test('残局页做对一题，进度计数 +1 并刷新后仍在', async ({ page }) => {
  await gotoPuzzles(page)

  await expect(page.getByTestId('puzzle-progress')).toContainText('0 / 15')
  await openPuzzle(page, 'win-h')
  // 走 `solveWithHints` 而不是点某个写死的坐标：这个文件抬头那句
  // 「没有一处写死答案坐标」原本是假的——这里和下面那条都点着 `intersection-4-7`，
  // 而它就是 `win-h` 的成五点（两轴审查抓到）。**改代码，不是改注释。**
  await solveWithHints(page)

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
  await gotoPuzzles(page)

  for (const label of ['一步获胜', '挡住直接胜着', '构造活四', '双重威胁', '连续冲四', '强制获胜路线']) {
    await expect(page.getByRole('heading', { name: label })).toBeVisible()
  }
})

/**
 * 十五道题**一道都不能进不去**。
 *
 * 循环跑完全部题目，顺带把「题名是这一页的 h1」钉住——它此前是个 `span`，
 * 于是残局详情页整页没有一级标题（与 Phase 04 修过的教学页同一个毛病）。
 * 十五次往返是重活，显式给预算。
 */
test('十五道题都进得去，而且题名是页面的一级标题', async ({ page }) => {
  test.setTimeout(90_000)
  await gotoPuzzles(page)

  for (const puzzle of PUZZLES) {
    await page.getByTestId(`puzzle-${puzzle.id}`).click()
    await expect(
      page.getByRole('heading', { level: 1, name: puzzle.title }),
      `「${puzzle.id}」这一页应该有一个写着题名的 h1`,
    ).toBeVisible()
    await page.getByRole('button', { name: '← 残局列表' }).click()
    await expect(page.getByRole('heading', { name: '残局挑战' })).toBeVisible()
  }
})

/** 首页把「练到哪了」说清楚：总数、推荐、每个分类各自的进度。 */
test('首页给出总进度、继续挑战入口与分类计数', async ({ page }) => {
  await gotoPuzzles(page)

  await expect(page.getByTestId('puzzle-progress')).toHaveText('已通过 0 / 15 题')
  await expect(page.getByRole('button', { name: '继续挑战：横向补满' })).toBeVisible()
  await expect(page.getByTestId('category-winInOne-progress')).toHaveText('0 / 3')

  // 卡片自带类别——列表滚起来之后分组标题会滚出视野
  await expect(page.getByTestId('puzzle-win-h')).toContainText('横向补满')
  await expect(page.getByTestId('puzzle-win-h')).toContainText('一步获胜')
})

test('做对之后「下一题」直接换题，上一题的反馈不跟过来', async ({ page }) => {
  await gotoPuzzles(page)
  await openPuzzle(page, 'win-h')
  await solveWithHints(page)

  await page.getByRole('button', { name: '下一题 →' }).click()

  // 换到了题库里的下一道，而且是它自己那个干净的局面
  await expect(page.getByRole('heading', { level: 1, name: '斜向补满' })).toBeVisible()
  await expect(page.getByTestId('feedback')).toHaveCount(0)
  await expect(page.locator('[data-testid^="board-mark-"]')).toHaveCount(0)
})

/**
 * 换题时的**临时状态清理**：上一题的判错反馈、已经揭开的提示，
 * 都不许出现在新题上——它们是「那一次答题」的状态，不是题目的属性。
 */
test('判错之后换一道题，反馈与提示都不跟过来', async ({ page }) => {
  await gotoPuzzles(page)
  await openPuzzle(page, 'win-h')

  await page.getByRole('button', { name: '要提示' }).click()
  await expect(page.getByTestId('hint')).toBeVisible()
  await page.getByTestId('intersection-0-0').click() // 离四连十万八千里
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'false')

  await page.getByRole('button', { name: '← 残局列表' }).click()
  await openPuzzle(page, 'block-h')

  await expect(page.getByTestId('feedback')).toHaveCount(0)
  await expect(page.getByTestId('hint')).toHaveCount(0)
  // 提示级数也回到零：按钮上是第一级那句话
  await expect(page.getByTestId('ask-hint')).toHaveText('要提示')
})

/**
 * 分类完成提示走的是**真实路径**：连做三道题，其中两次是点「下一题」过去的。
 * 用提示反解坐标，不写死答案。
 */
test('把「一步获胜」做完，出现分类完成提示', async ({ page }) => {
  test.setTimeout(90_000) // 三道题，每道都要跑一次求解器
  await gotoPuzzles(page)

  // 题单从题库里取，不写死 id：换了题目这道用例不会假装还在测同一件事
  const [first, ...rest] = PUZZLES.filter((puzzle) => puzzle.category === 'winInOne')

  // 只有第一道是从列表点进去的，其余靠「下一题」串下去——那正是这条用例顺带要走的路径
  await openPuzzle(page, first!.id)
  await solveWithHints(page)

  for (const puzzle of rest) {
    await page.getByRole('button', { name: '下一题 →' }).click()
    await expect(page.getByRole('heading', { level: 1, name: puzzle.title })).toBeVisible()
    await solveWithHints(page)
  }

  await expect(page.getByText('「一步获胜」这一类全部通过了。')).toBeVisible()
})

/**
 * 题库的**最后一道**：给结束状态，不给「下一题」。
 *
 * 而且它**不许谎称「全都通过了」**——列表不锁顺序，玩家可以直接来做这一道。
 * 这条断言是一次真实的返工换来的：初版把「走到最后一道」与「全部做完」
 * 混成了一个状态，写 e2e 时才看出来（Phase 04 在教学页上抓过同形的缺陷）。
 */
test('做到最后一道：给结束状态，也不谎称全部通过', async ({ page }) => {
  test.setTimeout(60_000)
  await gotoPuzzles(page)

  const last = PUZZLES[PUZZLES.length - 1]!
  await openPuzzle(page, last.id)
  await solveWithHints(page)

  await expect(page.getByText(/这是题库里的最后一道/)).toBeVisible()
  await expect(page.getByRole('button', { name: '下一题 →' })).toHaveCount(0)
  await expect(page.getByText(/道题都通过了/)).toHaveCount(0)
})

/**
 * 「带着错误反馈点下一题」这条**现场路径**。
 *
 * 判错之后 footer 本来是不显示的（出口的闸门是「本次判对 或 此前已通过」），
 * 所以这条路径只有**重进一道已通过的题**才走得到：那时出口一开始就在，
 * 而玩家可能先走错一手、再换题。切题必须清干净——错的那条反馈与揭开过的提示
 * 都是「那一次答题」的状态，不是题目的属性。
 *
 * 两轴审查指出：这条现场路径此前没有 e2e（已有那条走的是「返回列表再进另一题」）。
 */
test('重进已通过的题、走错一手，再点「下一题」——新题是干净的', async ({ page }) => {
  await gotoPuzzles(page)

  // 先做对一道，返回列表，再重进它——这时出口一开始就在
  await openPuzzle(page, 'win-h')
  await solveWithHints(page)
  await page.getByRole('button', { name: '← 残局列表' }).click()
  await openPuzzle(page, 'win-h')
  await expect(page.getByText('这一题已经通过。')).toBeVisible()

  // 重进之后先要点一级提示，再走错一手
  await page.getByRole('button', { name: '要提示' }).click()
  await page.getByTestId('intersection-0-0').click() // 题面第一行是空的
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-ok', 'false')
  await expect(page.getByTestId('hint')).toBeVisible()

  await page.getByRole('button', { name: '下一题 →' }).click()

  // 新题上不该有任何上一题留下的东西
  await expect(page.getByRole('heading', { level: 1, name: '斜向补满' })).toBeVisible()
  await expect(page.getByTestId('feedback')).toHaveCount(0)
  await expect(page.getByTestId('hint')).toHaveCount(0)
  await expect(page.getByTestId('ask-hint')).toHaveText('要提示')
})
