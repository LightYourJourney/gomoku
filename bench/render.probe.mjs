/**
 * 渲染性能探针：`yarn bench:render`。
 *
 * 跑在**生产构建**上（自己拉起 vite preview），量三件事：
 *   1. 首屏：TTFB / FCP / LCP，以及「应用自己的活」——从响应结束到
 *      `DOMContentLoaded`，也就是解析 HTML、执行 JS、挂载 React 这一段的耗时
 *   2. 落子一手的成本：从派发 click 到 React 提交完成的**同步**耗时
 *   3. DOM 元素总数
 *
 * 为什么同步计时就够：React 对离散事件（click）是同步刷新的，所以
 * `dispatchEvent` 返回时这一帧已经渲染完。机器负载只会把数字抬高，
 * 因此量出来的是**保守上界**——上界都很小的话，「不是热点」这个结论就成立。
 *
 * 与 `yarn bench` 分开：那个是引擎的纯计算基准，跑在 Node 里；
 * 这个要真浏览器，且只在改了棋盘/首屏渲染时才需要重跑。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const PORT = 5183
const BASE_URL = `http://127.0.0.1:${PORT}`
const MOVES = 30
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function startPreview() {
  const child = spawn(
    'yarn',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: repoRoot, stdio: 'ignore' },
  )
  return child
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(BASE_URL)
      if (response.ok) return
    } catch {
      // 还没起来
    }
    await delay(500)
  }
  throw new Error(`预览服务器在 ${BASE_URL} 上没起来——先跑一次 yarn build`)
}

const server = startPreview()
let browser
try {
  await waitForServer()

  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  // LCP 要在导航之前就开始观察，否则条目已经错过了
  await page.addInitScript(() => {
    window.__lcp = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  })

  await page.goto(BASE_URL, { waitUntil: 'load' })
  // LCP 在最后一次布局后才定稿，等一拍再读
  await delay(500)

  const navigation = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation')
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    return {
      ttfb: Math.round(entry.responseStart),
      appWork: Math.round(entry.domContentLoadedEventEnd - entry.responseEnd),
      fcp: fcp === undefined ? null : Math.round(fcp.startTime),
      lcp: Math.round(window.__lcp ?? 0),
    }
  })

  console.log(`首屏（${BASE_URL}）`)
  console.log(`  TTFB                 ${navigation.ttfb} ms`)
  console.log(`  应用自身（响应→DCL）  ${navigation.appWork} ms`)
  console.log(`  FCP                  ${navigation.fcp ?? '—'} ms`)
  console.log(`  LCP                  ${navigation.lcp} ms`)

  await page.getByRole('radio', { name: '本地双人' }).click()

  // 互不相邻的空位，避免落在同一片区域上
  const points = []
  for (let y = 2; y <= 12 && points.length < MOVES; y += 2) {
    for (let x = 1; x <= 13 && points.length < MOVES; x += 3) points.push([x, y])
  }

  const samples = []
  for (const [x, y] of points) {
    samples.push(
      await page.evaluate(([px, py]) => {
        const cell = document.querySelector(`[data-testid="intersection-${px}-${py}"]`)
        const start = performance.now()
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return performance.now() - start
      }, [x, y]),
    )
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log(`\n落子一手（click → React 提交，${samples.length} 手）`)
  console.log(`  中位 ${median.toFixed(2)} ms   最小 ${sorted[0].toFixed(2)}   最大 ${sorted.at(-1).toFixed(2)}`)

  const elements = await page.evaluate(() => document.getElementsByTagName('*').length)
  console.log(`\nDOM 元素总数  ${elements}`)
} finally {
  if (browser !== undefined) await browser.close()
  server.kill()
}
