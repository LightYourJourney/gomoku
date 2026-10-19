/**
 * 教学/残局交互的**页内**主线程耗时探针：`yarn bench:blocking`。
 *
 * 与 `bench/learn.measure.ts` 的分工：
 *   - 那个量纯函数（CPU / wall），回答「这段计算本身有多重」；
 *   - 这个量**真实浏览器里从点击到 DOM 出现**的耗时，回答「用户等多久」。
 * 两者不能互相替代：Phase 08 曾把「Playwright 点击 + 固定等待 + 读取」当成同步阻塞，
 * 得出 60–132 ms 的错误结论；页内派发 + MutationObserver 才能把应用自身的提交隔离出来。
 *
 * 用法（需要先起一个能访问的产物服务器）：
 *
 *   yarn build
 *   yarn preview --port 5192 --strictPort
 *   yarn bench:blocking                 # 默认 http://127.0.0.1:5192
 *   BASE=http://127.0.0.1:5190 yarn bench:blocking   # 也可以对 dev server 跑
 *
 * **测量条件必须一起记录**：这台机器忙时（load average 远大于核数），wall 时间会被
 * 调度放大，数字只用于量级判断；要写进文档的数字应在空载时取。
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5192'
const PUZZLES = ['vcf-basic', 'forced-counter', 'win-h']

/** 页内点击一次提示，记录同步处理、微任务提交与 DOM 变更的相对时刻。 */
const measureHint = () =>
  (async () => {
    const stage = document.querySelector('[data-testid="board"]')?.parentElement?.parentElement
    if (!stage) throw new Error('找不到棋盘容器')
    const t0 = performance.now()
    const seen = { task: null, micro: null, mutate: null }
    const observer = new MutationObserver(() => {
      if (seen.mutate === null) seen.mutate = performance.now() - t0
    })
    observer.observe(stage, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
    const button = document.querySelector('[data-testid="ask-hint"]')
    if (!(button instanceof HTMLElement)) throw new Error('找不到提示按钮')
    button.click()
    seen.task = performance.now() - t0
    await new Promise((resolve) => queueMicrotask(resolve))
    seen.micro = performance.now() - t0
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    observer.disconnect()
    return { ...seen, marks: document.querySelectorAll('[data-testid="board-marks"] > *').length }
  })()

async function run() {
  const browser = await chromium.launch({ channel: 'chrome' })
  const results = []
  try {
    for (const id of PUZZLES) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const page = await context.newPage()
      await page.goto(BASE)
      await page.waitForSelector('[data-testid="board"]', { timeout: 10_000 })
      await page.getByRole('button', { name: '残局', exact: true }).click()
      await page.getByTestId(`puzzle-${id}`).click()
      await page.waitForSelector('[data-testid="ask-hint"]')

      const hints = []
      for (let level = 0; level < 3; level += 1) {
        hints.push(await page.evaluate(measureHint))
        await page.waitForTimeout(60)
      }
      results.push({ id, hints })
      await context.close()
    }
  } finally {
    await browser.close()
  }

  console.log(`\n=== 页内点击 → DOM 变更（${BASE}）===`)
  for (const { id, hints } of results) {
    const last = hints[hints.length - 1]
    console.log(
      `${id}: 第 3 级提示 同步 ${last.task.toFixed(1)} ms / ` +
        `提交 ${last.micro.toFixed(1)} ms / DOM ${last.mutate === null ? '—' : last.mutate.toFixed(1)} ms；` +
        `标记 ${last.marks} 个`,
    )
  }
  console.log(
    '\n提示：数字受机器负载影响。要写进文档时，请在空载时跑，并把负载条件一起记下。',
  )
}

run().catch((error) => {
  console.error(`✗ 探针失败：${error instanceof Error ? error.message : String(error)}`)
  console.error(`  先确认 ${BASE} 可访问（yarn preview --port 5192 --strictPort）。`)
  process.exitCode = 1
})
