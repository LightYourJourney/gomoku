import { expect, test, type Page } from '@playwright/test'
import { DIFFICULTY_PARAMS } from '../src/ai/difficulty'

/**
 * 等一次在飞的异步工作彻底跑完所需的**驻留时间**。
 *
 * 这里等的是「某件事**没有**发生」（迟到的响应不会把棋子补回来）——
 * 没有可轮询的事件，固定等待在这个场合是正确构造，不是同步点缺失。
 *
 * 但**必须由源码里的预算推导**，不能写死：写死的话，将来把某一档的预算调大，
 * 这个等待会静默地变得不够长，用例不再证明任何东西、却依然全绿。
 */
const EXPERT_DWELL_MS = DIFFICULTY_PARAMS.expert.budgetMs + 1_000

/**
 * 每个用例都从干净的存档开始。
 *
 * 只在本次标签页的第一次导航时清一次：addInitScript 每次导航都会执行，
 * 若无条件清空，「刷新后恢复」这类用例刚写进去的存档会被 reload 自己抹掉。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem('e2e-fresh', '1')
    }
  })
})

async function stones(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId(/^stone-/).count()
}

test('人机对战：玩家落子后 AI 自动应手', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)

  await page.getByTestId('intersection-7-7').click()

  // 玩家这一手立刻出现
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')

  // AI 应手后轮次交还玩家
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
  await expect(page.getByTestId('stone-7-7')).not.toHaveAttribute('data-last', 'true')
})

test('落子位置与点击的交叉点一致', async ({ page }) => {
  await page.goto('/')

  // 命中区是按格铺开的，点在格子正中必须落在该交叉点上，
  // 不能因为命中区互相重叠而跑到相邻格。
  for (const [x, y] of [
    [0, 0],
    [14, 0],
    [0, 14],
    [14, 14],
    [7, 7],
  ] as const) {
    await page.getByTestId(`intersection-${x}-${y}`).click()
    await expect(page.getByTestId(`stone-${x}-${y}`)).toBeVisible()
  }
})

test('悔棋撤销双方各一手', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

  await page.getByRole('button', { name: '悔棋' }).click()

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '悔棋' })).toBeDisabled()
})

test('重新开始会清空棋盘', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

  // 盘上已经有子，所以会先拦一道确认（Phase 02）
  await page.getByRole('button', { name: '重新开始' }).click()
  await page.getByRole('button', { name: '确认重新开始' }).click()

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('刷新页面后棋局恢复，且 AI 思考中的那一手会被补完', async ({ page }) => {
  await page.goto('/')

  // 直接写入一份「玩家刚落子、AI 还没应手」的存档。
  // 这里的字段必须与 src/persist/storage.ts 的 PersistedSession 一致——
  // 少一个字段存档就会被安全丢弃，这条用例会立刻失败（这正是我们要的）。
  await page.evaluate(() => {
    window.localStorage.setItem(
      'gomoku-lab:session',
      JSON.stringify({
        schemaVersion: 2,
        moves: [{ x: 7, y: 7 }],
        firstPlayer: 1,
        mode: 'pve',
        humanColor: 1,
        difficulty: 'easy',
        resignedBy: null,
      }),
    )
  })
  await page.reload()

  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('认输后刷新页面，对局不会复活成进行中', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

  await page.getByRole('button', { name: '认输' }).click()
  await page.getByRole('button', { name: '确认认输' }).click()
  await expect(page.getByRole('dialog')).toContainText('你认输了')

  await page.reload()

  // 手顺还原不出认输，所以它必须单独存档；否则刷新后这局会重新变得可以继续下。
  await expect(page.getByTestId('status-pill')).toHaveText('你认输了')
  await expect(page.getByRole('button', { name: '认输' })).toBeDisabled()
  await expect(page.getByRole('dialog')).toContainText('你认输了')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
})

test('认输弹出结果弹窗，且此后再点棋盘无效', async ({ page }) => {
  await page.goto('/')

  // 空盘也拦——任务书对认输没有「空棋盘免确认」的豁免（只有重新开始有）
  await page.getByRole('button', { name: '认输' }).click()
  await page.getByRole('button', { name: '确认认输' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('你认输了')
  await expect(page.getByRole('button', { name: '认输' })).toBeDisabled()

  await page.getByRole('button', { name: '看看棋盘' }).click()
  await expect(dialog).toBeHidden()

  await page.getByTestId('intersection-3-3').click()
  expect(await stones(page)).toBe(0)
})

test('本地双人模式不触发 AI，黑白轮流落子', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('radio', { name: '本地双人' }).click()

  /*
   * 双人时**不能出现「你」**（任务书 §三：同一块屏幕上坐着两个人，
   * 单人对 AI 的视角在这里指谁都是错的）。单测里已经钉住，这里在真实浏览器
   * 再确认一遍——状态条是这一阶段新加的，读它的是用户的眼睛。
   */
  const bar = page.getByLabel('对局状态')
  await expect(bar).toContainText('黑方')
  await expect(bar).toContainText('白方')
  await expect(bar).not.toContainText('你')

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId('status-pill')).toHaveText('轮到白棋')

  await page.getByTestId('intersection-7-8').click()
  await expect(page.getByTestId('status-pill')).toHaveText('轮到黑棋')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
})

test('请求提示后棋盘上出现候选标记，且棋局一手未变', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()

  // **不能拿「轮到你落子」当同步点**：开局空盘时它也是这句话，于是在
  // 「点击已派发、React 还没把状态条翻成『AI 思考中』」的那个窗口里，
  // 断言会立刻通过，而盘上还是 0 子。全量并发跑里就是这么失败的。
  // 要等的是「这一手真的落下去了」，所以先锚棋子。
  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')

  const before = await stones(page)
  expect(before).toBeGreaterThan(0)

  /*
   * 任务书 §四：**同一个请求不得有多个入口**。入口从 `HintPanel` 搬进工具栏时，
   * 一边加、另一边没删就会留下两个「求提示」——点哪颗都像对的，
   * 而它们迟早会在某一处行为不同。这里显式数一次，别只靠「点击没撞上 strict mode」。
   */
  await expect(page.getByRole('button', { name: '求提示' })).toHaveCount(1)

  await page.getByRole('button', { name: '求提示' }).click()

  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(3)
  // 提示只做分析：手数、轮次都不许变，也不能多出棋子
  await expect(page.getByTestId(/^stone-/)).toHaveCount(before)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('提示之后落子，提示标记消失', async ({ page }) => {
  await page.goto('/')
  // 本地双人：没有 AI 随机应手，落点完全可控
  await page.getByRole('radio', { name: '本地双人' }).click()

  await page.getByTestId('intersection-7-7').click()
  await page.getByRole('button', { name: '求提示' }).click()
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(3)

  await page.getByTestId('intersection-3-3').click()

  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(0)
  await expect(page.getByTestId('stone-3-3')).toBeVisible()
})

test('收起提示只清标记，不动棋局', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: '本地双人' }).click()

  await page.getByTestId('intersection-7-7').click()
  await page.getByRole('button', { name: '求提示' }).click()
  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(3)

  await page.getByRole('button', { name: '收起提示' }).click()

  await expect(page.getByTestId(/^board-mark-/)).toHaveCount(0)
  await expect(page.getByTestId(/^stone-/)).toHaveCount(1)
})

test('专家档深算期间悔棋，迟到的 AI 响应不会把棋子补回来', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('radio', { name: '专家' }).click()
  await page.getByTestId('intersection-7-7').click()

  // AI 正在深算时悔棋
  await page.getByRole('button', { name: '悔棋' }).click()

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)

  // 等过专家档的时间预算，确认那一手确实作废了，而不是只是慢了一步
  await page.waitForTimeout(EXPERT_DWELL_MS)

  await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

/**
 * 防误触确认（Phase 02）。任务书 §五。
 *
 * 这一组守的是**两条容易做反的边**：取消必须什么都不改（连 store 都不许碰），
 * 而空盘与终局不能打扰。
 */
test.describe('防误触确认', () => {
  test('取消重新开始，棋局一手不动', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()
    await page.getByTestId('intersection-7-7').click()
    await page.getByTestId('intersection-3-3').click()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

    await page.getByRole('button', { name: '重新开始' }).click()
    await expect(page.getByRole('dialog')).toContainText('已经下的 2 手会被清空')
    await page.getByRole('button', { name: '取消' }).click()

    // 棋局完整保留：两颗子还在、没有弹窗、轮次也没变
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
    await expect(page.getByTestId('stone-7-7')).toBeVisible()
    // 两手之后轮到黑棋（黑先）
    await expect(page.getByTestId('status-pill')).toHaveText('轮到黑棋')
  })

  /**
   * **点「已经选中的那一项」什么都不该发生。**
   *
   * 少了这条判断，会重建棋局的调用方就会出事：`setMode('pve')` 在已经是人机模式时
   * 仍然走 `newGame()`，于是「点一下当前高亮的选项」把进行中的棋局清掉——
   * 而本阶段加了确认之后，它还会先弹一句「切换对战模式？」，用户根本没切换什么。
   * 键盘路径一直是判的（`moveTo`），漏的是点击路径。
   */
  test('点已选中的模式：不弹确认，棋局也不动', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('intersection-7-7').click()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(2)

    await page.getByRole('radio', { name: '人机对战' }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
    await expect(page.getByTestId('stone-7-7')).toBeVisible()
  })

  test('空棋盘重新开始不弹确认', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '重新开始' }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
  })

  test('切换模式：取消则原样，确认才重建棋局', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()
    await page.getByTestId('intersection-7-7').click()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(1)

    // —— 取消：模式不变、选中项不变、棋盘不变
    await page.getByRole('radio', { name: '人机对战' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('radio', { name: '本地双人' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByTestId(/^stone-/)).toHaveCount(1)

    // —— 确认：模式真的换了，棋盘重建
    await page.getByRole('radio', { name: '人机对战' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    await expect(page.getByRole('radio', { name: '人机对战' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  })

  /**
   * 任务书 §八 第 5 条的**取消那一半**：认输也要能取消，取消之后这一局必须原样。
   *
   * 这条是验收自审时补上的——原来只测了「确认认输 → 终局」，
   * 而「取消认输 → 什么都不变」一次都没验过。取消路径不碰 store 是结构性成立的，
   * 但**结构性成立不等于验过**：有人在取消分支里加一行副作用，只有这条会红。
   */
  test('取消认输，棋局一手不动', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()
    await page.getByTestId('intersection-7-7').click()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(1)

    await page.getByRole('button', { name: '认输' }).click()
    await expect(page.getByRole('dialog')).toContainText('认输不能撤销')
    await page.getByRole('button', { name: '取消' }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(1)
    await expect(page.getByTestId('status-pill')).toHaveText('轮到白棋')
    // 还能接着下——对局没有被结束掉
    await page.getByTestId('intersection-3-3').click()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
  })

  /**
   * 任务书 §八 第 7 条：**执子**变更的取消与确认。
   *
   * `setHumanColor` 与 `setMode` 一样会重建棋局（`newGame`），所以两者都该拦。
   * 这条同样是验收自审时补的——原先只测了模式那一半，
   * 执子的拦截分支（`beforeHumanColorChange`）**一行都没被验过**。
   */
  test('切换执子：取消则原样，确认才重建棋局', async ({ page }) => {
    await page.goto('/')
    // 落在 3-3 而不是天元：确认重建之后 AI（执黑）会开盘于天元，
    // 拿天元当「玩家那一手还在不在」的锚点会自己骗自己。
    await page.getByTestId('intersection-3-3').click()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(2)
    await expect(page.getByTestId('stone-3-3')).toBeVisible()

    // —— 取消：执子不变、选中项不变、棋盘不变
    await page.getByRole('radio', { name: '执白后行' }).click()
    await expect(page.getByRole('dialog')).toContainText('切换执子会开一局新的')
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('radio', { name: '执黑先行' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByTestId('stone-3-3')).toBeVisible()
    // 取消之后焦点回到**选中项**上，不是那个没被选中的选项
    const focusedChecked = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-checked') ?? null,
    )
    expect(focusedChecked, '取消之后焦点落在了没被选中的选项上').toBe('true')

    // —— 确认：执子真的换了，棋盘重建（玩家那一手没了），而且轮到 AI 先走
    await page.getByRole('radio', { name: '执白后行' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    await expect(page.getByRole('radio', { name: '执白后行' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByTestId('stone-3-3')).toHaveCount(0)
    /*
     * 「切换生效」要看的是**状态条上玩家换到了白方**，不是轮次文案——
     * 切换前后都会出现「轮到你落子」（AI 应完手就轮到玩家），拿它当判据会假绿。
     */
    const bar = page.getByLabel('对局状态')
    await expect(bar).toContainText('你 · 白')
    await expect(bar).not.toContainText('你 · 黑')
  })

  /**
   * 「AI 正在思考时，取消不应意外中断原来的 AI 请求」（任务书 §五 点名）。
   * 取消路径一次都不碰 store，所以这一手必须照样落下来。
   */
  test('AI 思考期间取消重新开始，AI 那一手照样落下', async ({ page }) => {
    await page.goto('/')
    // 专家档 2600ms 的预算把窗口撑开（同 `专家档深算期间悔棋` 的做法）。
    // 简易档 250ms：点两下就过去了，这条会变成在赌手速。
    await page.getByRole('radio', { name: '专家' }).click()

    await page.getByTestId('intersection-7-7').click()
    await expect(page.getByTestId('status-pill')).toHaveText('AI 思考中…')

    await page.getByRole('button', { name: '重新开始' }).click()
    await page.getByRole('button', { name: '取消' }).click()

    // 不靠时长当同步点：等的是结果本身（专家档那一手最长 2.6s，给足超时）
    await expect(page.getByTestId(/^stone-/)).toHaveCount(2, { timeout: 15_000 })
    await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
    await expect(page.getByTestId('stone-7-7')).toBeVisible()
  })

  /**
   * **验收自审抓到的真 bug 的回归用例**：认输确认框会说「记为谁获胜」，
   * 而人机模式下「认输的是玩家」**与轮到谁走无关**（`resignerFor`）。
   * 在此之前所有认输用例都发生在「轮到玩家」时，`game.current === humanColor`，
   * 文案恰好是对的——**轮到 AI 时它会写成「记为你获胜」，按下去却变成「你认输了」**。
   *
   * 触发条件不罕见：玩家执白时，开局第一屏就是「轮到 AI」。
   */
  test('轮到 AI 时点认输，确认框说的赢家是 AI 而不是玩家', async ({ page }) => {
    /*
     * **桩掉 Worker**，让「轮到 AI」这个状态永不结束（同 `e2e/a11y.spec.ts` 的
     * `holdAiInThinking`，也是 F-18 的结论：别跟 AI 赛跑，把赛道拆了）。
     *
     * 不桩的话这条**抓不住它要抓的东西**：AI 一落子 `game.current` 就变，
     * 而确认框的文案每次渲染都重算——读到手里已经是「自我修正」之后的文本了。
     * 这一点是反向验证时发现的：把判据退回 `game.current`，用例照样绿。
     */
    await page.addInitScript(() => {
      class StubWorker {
        postMessage(): void {}
        addEventListener(): void {}
        terminate(): void {}
      }
      Object.assign(globalThis, { Worker: StubWorker })
    })
    await page.goto('/')

    await page.getByTestId('intersection-7-7').click()
    await expect(page.getByTestId('status-pill')).toHaveText('AI 思考中…')

    await page.getByRole('button', { name: '认输' }).click()
    const dialog = page.getByRole('dialog')
    // 人机模式下认输的**永远是玩家**（与轮到谁走无关），所以赢家是 AI
    await expect(dialog).toContainText('记为AI获胜')
    await expect(dialog).not.toContainText('记为你获胜')

    await page.getByRole('button', { name: '确认认输' }).click()
    await expect(page.getByTestId('status-pill')).toHaveText('你认输了')
  })

  test('终局之后的「重新开始」与「再来一局」都不弹确认', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '认输' }).click()
    await page.getByRole('button', { name: '确认认输' }).click()
    const result = page.getByRole('dialog')
    await expect(result).toContainText('你认输了')

    // 终局弹窗里的「再来一局」直接开新局
    await page.getByRole('button', { name: '再来一局' }).click()
    await expect(result).toBeHidden()
    await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')

    // 终局之后再点工具栏的「重新开始」也不问
    await page.getByTestId('intersection-3-3').click()
    await page.getByRole('button', { name: '认输' }).click()
    await page.getByRole('button', { name: '确认认输' }).click()
    await page.getByRole('button', { name: '看看棋盘' }).click()

    await page.getByRole('button', { name: '重新开始' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByTestId(/^stone-/)).toHaveCount(0)
  })
})

test.describe('键盘操作工具栏', () => {
  /**
   * 用**真键盘**走到「求提示」，而不是程序化 `.focus()`。
   *
   * 循环里有界 + 失败断言是刻意的：目标够不着时用例必须**响亮地红**，
   * 而不是走满次数之后若无其事地通过（F-18/F-30 那类「断言在空转」）。
   */
  async function tabTo(page: import('@playwright/test').Page, name: string): Promise<void> {
    let tabs = 0
    while (tabs < 20) {
      await page.keyboard.press('Tab')
      tabs += 1
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
      if (focused === name) break
    }
    expect(tabs, `按 Tab 应该在 20 步之内到「${name}」`).toBeLessThan(20)
  }

  test('Tab 走到求提示，回车能触发', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()
    // 得先有一手：空盘上引擎没有威胁可算，候选本来就是空的（这不是工具栏的问题）
    await page.getByTestId('intersection-7-7').click()
    await expect(page.getByTestId('stone-7-7')).toBeVisible()

    await tabTo(page, '求提示')
    await page.keyboard.press('Enter')

    await expect(page.getByTestId(/^board-mark-/)).toHaveCount(3)
  })

  test('键盘打开确认、Escape 取消，焦点回到触发它的按钮', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '本地双人' }).click()
    await page.getByTestId('intersection-7-7').click()

    await tabTo(page, '重新开始')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    // 「取消后焦点回到原操作位置」——真实浏览器里才验得了
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    expect(focused).toBe('重新开始')
    await expect(page.getByTestId(/^stone-/)).toHaveCount(1)
  })

  test('确认弹窗打开期间 Tab 出不去', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('intersection-7-7').click()
    await page.getByRole('button', { name: '重新开始' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      )
      expect(inside, `第 ${i + 1} 次 Tab 之后焦点跑到确认弹窗外面了`).toBe(true)
    }
  })
})

/**
 * AI 面板的两级信息（Phase 03，任务书 §七）。
 *
 * **为什么这条判据必须在真实文本上做，而不是靠探针的 `typeSamples`**：
 * `typeSamples` 按「字号|行高|颜色|字重」去重，每个样式只留**第一个**元素的文本，
 * 同一样式的另一个元素会被折进 `count` 里、字符串根本不出现在样本中。
 * 实测过一次：`battle-midgame` 的截图里明明印着「尚未产生分析结果。」，
 * 而 `typeSamples` 里查不到它。拿这种字段当门禁，判据会**悄悄停止生效**。
 */
test.describe('AI 面板的两级信息', () => {
  /** 走一手人棋，等 AI 应手并给出分析结果。 */
  async function playUntilAiAnalysed(page: Page): Promise<void> {
    await page.goto('/')
    await page.getByTestId('intersection-7-7').click()
    await expect(page.getByTestId('ai-player-view')).toBeVisible({ timeout: 20_000 })
  }

  test('默认层说人话，不出现算法名词与实现细节', async ({ page }) => {
    await playUntilAiAnalysed(page)

    await expect(page.getByTestId('ai-player-view')).toBeVisible()
    // 这三段此前分别出现在默认界面 / 默认界面上
    await expect(page.getByText(/引擎跑在/)).toHaveCount(0)
    await expect(page.getByText(/Web Worker/)).toHaveCount(0)
    await expect(page.getByText(/Negamax/)).toHaveCount(0)
    // 搜索指标也不在默认层
    await expect(page.getByText('搜索深度')).toHaveCount(0)
    await expect(page.getByText('局面评分')).toHaveCount(0)
  })

  test('「?」能用键盘打开，展开后读得到技术详情', async ({ page }) => {
    await playUntilAiAnalysed(page)

    const button = page.getByRole('button', { name: 'AI 引擎的技术详情' })
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).not.toHaveAttribute('aria-controls')

    await button.focus()
    await page.keyboard.press('Enter')

    await expect(button).toHaveAttribute('aria-expanded', 'true')
    const controls = await button.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    await expect(page.locator(`#${controls}`)).toBeVisible()
    // `exact` 不能少：算法说明那段散文里也出现了「搜索深度」四个字，
    // 不加精确匹配会撞上 strict mode（一条用例拦到两个元素）。
    await expect(page.getByText('搜索深度', { exact: true })).toBeVisible()
    await expect(page.getByText('局面评分', { exact: true })).toBeVisible()
    await expect(page.getByText(/Negamax/)).toBeVisible()
  })

  test('展开状态刷新后不保留', async ({ page }) => {
    await playUntilAiAnalysed(page)

    await page.getByRole('button', { name: 'AI 引擎的技术详情' }).click()
    await expect(page.getByText(/Negamax/)).toBeVisible()

    await page.reload()

    /*
     * 只断言「技术详情没有跟着回来」。
     *
     * **不要顺带去断言那颗「?」还在**：刷新后 `aiInfo` 不持久化
     * （它是这一局运行时才产生的分析结果），面板回到「尚未产生分析结果。」，
     * 于是按钮**本来就不该在**——初稿断言了它，红得毫无道理。
     * 展开状态不持久化的判据是**详情有没有回来**，不是按钮在不在。
     */
    await expect(page.getByText(/Negamax/)).toHaveCount(0)
    await expect(page.getByTestId('ai-player-view')).toHaveCount(0)
  })
})
