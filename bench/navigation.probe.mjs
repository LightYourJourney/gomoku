/**
 * 应用内导航与浏览器历史的行为探针：`yarn bench:navigation`。
 *
 * 记录两件事（都是**行为事实**，不是耗时指标）：
 *   1. 后退键：从对战页点进「教学」后按浏览器后退，落在哪里。
 *      应用内导航若不进历史，`history.length` 不增长，后退会直接离开应用。
 *   2. 冷启动：上次停在「复盘」页时刷新，是否先渲染对战页再切过去
 *      （页面位置存在 IndexedDB 里，要等异步读取回来才知道该显示哪一页）。
 *
 * **不改任何产品代码**：第 2 项靠页面加载前注入的 MutationObserver 记录出现过的页面标识。
 *
 * 用法：
 *
 *   yarn build
 *   yarn preview --port 5192 --strictPort
 *   yarn bench:navigation
 *
 * 出处与首次结果：`docs/research/REFACTORING_ASSESSMENT.md` §4.5、§13。
 * 这也是「导航进浏览器历史」（该报告的阶段 C）的对照基线。
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5192'

/** 页面加载前注入：每当「是否有对战页的状态条 | 一级标题」变化，就记一笔。 */
const recordScreens = () => {
  window.__screens = []
  const startedAt = performance.now()
  const check = () => {
    const battle = document.querySelector('[data-testid="status-pill"]') !== null
    const heading = document.querySelector('h1')?.textContent ?? null
    if (!battle && heading === null) return // 应用还没挂载出任何页面
    const state = `${battle ? '对战' : '其它'}｜${heading}`
    const last = window.__screens[window.__screens.length - 1]
    if (last === undefined || last.state !== state) {
      window.__screens.push({ atMs: Math.round(performance.now() - startedAt), state })
    }
  }
  new MutationObserver(check).observe(document, { childList: true, subtree: true })
}

async function backButton(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await page.goto(BASE)
    await page.getByTestId('status-pill').waitFor({ timeout: 10_000 })
    const lengthBefore = await page.evaluate(() => history.length)
    await page.getByRole('button', { name: '教学' }).first().click()
    await page.waitForTimeout(300)
    const heading = await page.locator('h1').first().textContent()
    const urlAfterNavigate = page.url()
    const lengthAfter = await page.evaluate(() => history.length)
    await page.goBack().catch(() => {})
    await page.waitForTimeout(300)
    return { lengthBefore, lengthAfter, heading, urlAfterNavigate, urlAfterBack: page.url() }
  } finally {
    await context.close()
  }
}

async function reloadOnReview(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await page.addInitScript(recordScreens)
    await page.goto(BASE)
    await page.getByTestId('status-pill').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: '复盘' }).first().click()
    await page.getByRole('heading', { name: '复盘' }).waitFor()
    await page.waitForTimeout(600) // 等页面位置写进 IndexedDB
    const runs = []
    for (let i = 0; i < 3; i += 1) {
      await page.reload()
      await page.getByRole('heading', { name: '复盘' }).waitFor()
      await page.waitForTimeout(200)
      runs.push(await page.evaluate(() => window.__screens))
    }
    return runs
  } finally {
    await context.close()
  }
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome' })
  let back, reloads
  try {
    back = await backButton(browser)
    reloads = await reloadOnReview(browser)
  } finally {
    await browser.close()
  }

  console.log(`\n=== 导航与浏览器历史（${BASE}）===`)
  console.log('\n1. 点进「教学」后按后退')
  console.log(`  history.length：${back.lengthBefore} → ${back.lengthAfter}（进了历史应当 +1）`)
  console.log(`  点进去之后：标题「${back.heading}」，URL ${back.urlAfterNavigate}`)
  console.log(`  后退之后的 URL：${back.urlAfterBack}`)
  console.log(
    back.urlAfterBack.startsWith(BASE)
      ? '  → 仍在应用内'
      : '  → 已离开应用（应用内导航没有进浏览器历史）',
  )

  console.log('\n2. 停在「复盘」页刷新 3 次，依次出现过的页面（毫秒为距脚本注入的时间）')
  reloads.forEach((screens, index) => {
    console.log(`  第 ${index + 1} 次：${screens.map((s) => `${s.state} @${s.atMs}`).join(' → ')}`)
  })
}

run().catch((error) => {
  console.error(`✗ 探针失败：${error instanceof Error ? error.message : String(error)}`)
  console.error(`  先确认 ${BASE} 可访问（yarn build && yarn preview --port 5192 --strictPort）。`)
  process.exitCode = 1
})
