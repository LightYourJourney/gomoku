import { expect, test } from '@playwright/test'
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
