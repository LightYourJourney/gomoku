import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * 棋盘本身的真实浏览器验收（Phase 03）。
 *
 * **为什么这些用例只能在 Playwright 里跑**（`CLAUDE.md` 第 2 条）：
 *
 * - `getBBox()` 是 **SVG 的布局 API，jsdom 没有实现**——标记文字到底有没有超出底色，
 *   在组件测试里量不出来；
 * - 命中区、`touch-action`、页面滚动这些是**浏览器行为**，jsdom 不做命中测试也不滚动。
 *
 * 引子里的两条判据都来自任务书：
 * - §六「多字标签是否超出背景」；
 * - §四「触控落子必须保留原有整格命中区域……必须实际测试边缘格子、相邻交叉点
 *   以及页面滚动行为」。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

/** 进入教学页的第一课。那一课有「可长」这样的两字标记，第三课有「补这里」。 */
async function gotoLesson(page: Page, index: number): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '教学', exact: true }).click()
  await expect(page.getByRole('heading', { name: '互动教学' })).toBeVisible()
  await page.getByTestId(/^lesson-/).nth(index).click()
  await expect(page.locator('[data-testid="board"]')).toBeVisible()
}

/** 取一个标记的底色形状（圆或 pill）与文字的实际渲染盒。 */
async function markBoxes(mark: Locator) {
  return mark.evaluate((group) => {
    const text = group.querySelector('text')
    const shape = group.querySelector('circle, rect')
    if (text === null || shape === null) return null
    const t = (text as SVGGraphicsElement).getBBox()
    const s = (shape as SVGGraphicsElement).getBBox()
    return {
      text: { w: t.width, h: t.height, x: t.x, y: t.y },
      shape: { w: s.width, h: s.height, x: s.x, y: s.y },
    }
  })
}

test('标记的文字完全落在底色里，一个像素都不出框', async ({ page }) => {
  await gotoLesson(page, 2) // 第三课「活三与眠三」

  // 走到「中间隔一格也算数」那一页——它的标记是三个字的「补这里」
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '下一步' }).click()

  /*
   * **用标记自己的文字钉住「现在在哪一页」。**
   *
   * 初稿是 `marks.first()` + `toHaveCount(1)`，在 CI 上偶发失败。
   * 复现（`--repeat-each=20`）后量到两件事：
   *   - 每次打印出来 DOM 都是对的（`board-mark-6-7` / `pill` / `补这里`）；
   *   - 失败时 Playwright 报的是 `Test ended.` 而**不是** `Received:`——
   *     说明那一刻定位器**一个元素都取不到**，不是取到了形状不对的那个。
   *
   * 病根是这两条断言都**没有身份**：这一课的第 2 步（冲四）和第 3 步（补这里）
   * 都只有一个标记，`toHaveCount(1)` 分不出它们；而再往前一步是练习页，
   * 练习页在没点提示时**一个标记都没有**。于是任何一次「翻页翻多了/翻少了」
   * 都表现为「标记忽然没了」，还说不清停在哪。
   *
   * 「补这里」这三个字是那一页唯一的身份，而且是自动重试的——
   * 停在 2 / 3 或练习页都会直接报出来。
   *
   * （别拿工具栏的页码当锚点：`3 / 3` 在页面上有两处——工具栏的 span 与
   * 步骤标题的 h2——`getByText` 会撞 strict mode。这条是我改的时候真踩的。）
   */
  const mark = page.getByTestId('board-mark-6-7')
  await expect(mark).toHaveText('补这里')
  await expect(mark).toHaveAttribute('data-shape', 'pill')

  const boxes = await markBoxes(mark)
  expect(boxes).not.toBeNull()
  if (boxes === null) return

  // 文字必须整个落在底色里，**方向是硬的**
  expect(boxes.text.w).toBeLessThanOrEqual(boxes.shape.w)
  expect(boxes.text.h).toBeLessThanOrEqual(boxes.shape.h)
  expect(boxes.text.x).toBeGreaterThanOrEqual(boxes.shape.x)
  expect(boxes.text.x + boxes.text.w).toBeLessThanOrEqual(boxes.shape.x + boxes.shape.w)
})

test('两字标记的底色也不比文字窄', async ({ page }) => {
  await gotoLesson(page, 1) // 第二课「活二与眠二」，标记是「可长」

  const marks = page.locator('[data-testid^="board-mark-"]')
  await expect(marks).toHaveCount(2)

  for (const mark of await marks.all()) {
    const boxes = await markBoxes(mark)
    expect(boxes).not.toBeNull()
    if (boxes === null) continue
    expect(boxes.text.w).toBeLessThanOrEqual(boxes.shape.w)
  }
})

test('标记底色永远盖不到相邻交叉点的中心', async ({ page }) => {
  await gotoLesson(page, 2)
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '下一步' }).click()

  const width = await page.locator('[data-testid^="board-mark-"] rect').evaluate(
    (rect) => Number(rect.getAttribute('width')),
  )

  // 相邻交叉点在 1 格之外；半宽不到一格，就永远盖不到它的中心
  expect(width / 2).toBeLessThan(1)
})

/** 进本地双人模式：没有 AI 应手，「最新一手」在断言前不会被抢走。 */
async function gotoPvp(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('radio', { name: '本地双人' }).click()
}

/**
 * `--c-danger` **渲染出来的**颜色。
 *
 * 拿它去比，而不是在测试里写死 `rgb(184, 65, 44)`——令牌改过色值的话，
 * 写死的那份会静默失效（断言仍然通过，但它已经不再检查任何东西）。
 */
async function dangerRgb(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--c-danger)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
}

/**
 * 最后一手必须在**两种棋子**上都清楚（任务书 §四：「标记应当适用于黑棋和白棋」）。
 *
 * 初版只走了一手白子，却挂着「黑子上也清楚」的标题；断言还是
 * `fill !== dangerRgb`——而点的填色是 `--c-stone-black-b`，这条**近乎恒真**。
 * 现在两色各测一次，判据是**可观察的**：点与所在棋子必须反色，
 * 也就是「点在黑子上要亮、在白子上要暗」。
 */
for (const { name, moves, player, side } of [
  { name: '黑子', moves: ['intersection-7-7'], player: '1', side: 'light' },
  { name: '白子', moves: ['intersection-7-7', 'intersection-7-8'], player: '2', side: 'dark' },
] as const) {
  test(`最后一手在${name}上清楚：点与棋子反色`, async ({ page }) => {
    await gotoPvp(page)
    for (const id of moves) await page.getByTestId(id).click()

    const dot = page.getByTestId('last-move-dot')
    await expect(dot).toBeVisible()

    const painted = await dot.evaluate((element) => {
      const [r, g, b] = (getComputedStyle(element).fill.match(/[\d.]+/g) ?? []).map(Number)
      const lin = (c: number): number => {
        const v = (c ?? 0) / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return {
        luminance: 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0),
        player: element.closest('[data-testid^="stone-"]')?.getAttribute('data-player') ?? null,
      }
    })

    expect(painted.player).toBe(player)
    // 相对亮度 0.5 是明暗分界：#fff ≈ 1，#0b0b0d ≈ 0.003，两头都离它很远
    if (side === 'light') expect(painted.luminance).toBeGreaterThan(0.5)
    else expect(painted.luminance).toBeLessThan(0.5)
  })
}

test('棋盘上不出现 danger 色（判错标记只在残局练习页，对战棋盘上没有它）', async ({ page }) => {
  await gotoPvp(page)
  await page.getByTestId('intersection-7-7').click()

  const danger = await dangerRgb(page)
  const painted = await page
    .locator('[data-testid="board"] *')
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const style = getComputedStyle(node)
        return [style.fill, style.stroke]
      }),
    )

  expect(painted).not.toContain(danger)
})

test.describe('移动端触控（任务书 §四）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  /**
   * 「**棋盘上**拖动不滚页面」那一半**已经有人做了**，而且做得比我这里更好：
   * `mobile.spec.ts` 用 CDP 派发**真实的触摸序列**再断言 `scrollY` 不变。
   * 这里不复制一份——重复的用例只会让两处各错各的（`mouse` 拖动根本不触发页面滚动，
   * 拿它当判据是一条恒真的空断言）。
   *
   * 这里补的是**另一半**：锁死棋盘**不能**牺牲整页的可滚动性。
   * 棋盘在 390 下最多占半屏高，下面的面板仍然要能滚。
   */
  test('锁死棋盘之后，棋盘下方的面板照常能滚', async ({ page }) => {
    await gotoPvp(page)

    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 4,
    )
    expect(scrollable, '页面本身滚不动的话，这条用例证明不了任何事').toBe(true)

    await page.mouse.move(195, 800)
    await page.mouse.wheel(0, 400)

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })
})

/**
 * 终局的两张脸：弹窗关掉之后，五颗获胜子与连线必须都看得见。
 *
 * `battle-finished`（弹窗开着）那张图里，五颗获胜子有 **2 颗**被居中弹窗压住
 * ——H 列正好穿过棋盘中线，这是几何上的必然，不是 bug（见 `PHASE_03.md` §3.3）。
 * 所以「连线清晰」这条要求只能在这个状态上验：**关掉弹窗看棋盘**。
 */
test('关掉终局弹窗后，五颗获胜子全部可见且连线端点正确', async ({ page }) => {
  await page.goto('/')

  // 9 手黑胜，与探针的 `BLACK_WINS` 同一局：黑在 H 列连成五子。
  await page.evaluate(() => {
    window.localStorage.setItem(
      'gomoku-lab:session',
      JSON.stringify({
        schemaVersion: 2,
        moves: [
          { x: 7, y: 7 },
          { x: 8, y: 8 },
          { x: 7, y: 8 },
          { x: 8, y: 7 },
          { x: 7, y: 9 },
          { x: 8, y: 6 },
          { x: 7, y: 10 },
          { x: 9, y: 9 },
          { x: 7, y: 11 },
        ],
        firstPlayer: 1,
        mode: 'pve',
        humanColor: 1,
        difficulty: 'easy',
        resignedBy: null,
      }),
    )
  })
  await page.reload()

  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '看看棋盘' }).click()

  const winners = page.locator('[data-testid="board"] [data-win]')
  await expect(winners).toHaveCount(5)
  for (const stone of await winners.all()) {
    await expect(stone).toBeVisible()
  }

  // 连线两端就是获胜列的头尾：H 列（x=7）的 y=7 与 y=11
  const line = page.getByTestId('win-line-segment')
  await expect(line).toHaveAttribute('x1', '7')
  await expect(line).toHaveAttribute('y1', '7')
  await expect(line).toHaveAttribute('x2', '7')
  await expect(line).toHaveAttribute('y2', '11')
})
