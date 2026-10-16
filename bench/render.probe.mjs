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
/** 长棋谱的手数。真人很少下到 100 手以上，200 是压力档。 */
const LONG_RECORD_MOVES = 200
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 200 手的合法手顺。
 *
 * 用 `src/core/game.test.ts` 的 `drawOrder()` 同款填充模式（`(x + 2y) % 4 < 2`
 * 决定黑子）：横、竖、两条对角线上的最长同色连续都只有 2，而且
 * **无五连局面的任意前缀仍无五连**——所以取前 200 手直接就是合法局面，不用挑。
 */
const LONG_MOVES = (() => {
  const black = []
  const white = []
  for (let y = 0; y < 15; y += 1) {
    for (let x = 0; x < 15; x += 1) {
      ;((x + 2 * y) % 4 < 2 ? black : white).push({ x, y })
    }
  }
  const moves = []
  for (let i = 0; i < black.length && moves.length < LONG_RECORD_MOVES; i += 1) {
    moves.push(black[i])
    if (white[i] !== undefined && moves.length < LONG_RECORD_MOVES) moves.push(white[i])
  }
  return moves
})()

/**
 * 把一条棋谱写进 IndexedDB。
 *
 * **直接写库，不下一局棋**：200 手在界面上点不完；而复盘页的数据本来就来自库。
 * 库名与 store 结构跟 `bench/ui.probe.mjs` 的 `seedIndexedDb` 同源，
 * 这里只写 `records`（渲染性能不关心学习进度），所以没有把那 30 行抽出来共享。
 */
async function seedRecord(page, record) {
  await page.evaluate(async (value) => {
    const db = await new Promise((resolvePromise, rejectPromise) => {
      const request = indexedDB.open('gomoku-lab', 2)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('progress')) database.createObjectStore('progress')
        if (!database.objectStoreNames.contains('records')) {
          database.createObjectStore('records', { keyPath: 'seq', autoIncrement: true })
        }
      }
      request.onsuccess = () => resolvePromise(request.result)
      request.onerror = () => rejectPromise(request.error)
    })

    await new Promise((resolvePromise, rejectPromise) => {
      const tx = db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      store.clear()
      store.put(value)
      tx.oncomplete = () => resolvePromise()
      tx.onerror = () => rejectPromise(tx.error)
    })

    db.close()
  }, record)
}

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

  /*
   * 拖动回放时间轴的成本。
   *
   * 回放位置是**纯派生**的——`replay(moves.slice(0, cursor))` 每次重算，
   * 棋盘还要为落过的每一手渲染一个编号徽标。9 手局的成本量不出来，
   * 所以这里造一条 200 手的（任务书 §十 点名的「长棋谱播放」）。
   */
  await page.goto(BASE_URL)
  await seedRecord(page, {
    seq: 1,
    schemaVersion: 1,
    firstPlayer: 1,
    mode: 'pvp',
    humanColor: 1,
    difficulty: 'easy',
    resignedBy: null,
    moves: LONG_MOVES,
  })
  await page.reload()
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByTestId('record-1').click()
  await page.waitForSelector(`[data-testid="move-counter"]:has-text("0 / ${LONG_RECORD_MOVES}")`)

  const seeks = [10, 50, 90, 130, 170, LONG_RECORD_MOVES - 1]
  const seekSamples = []
  for (const target of seeks) {
    seekSamples.push(
      await page.evaluate(
        ([value]) => {
          const slider = document.querySelector('input[type="range"][aria-label="回放手数"]')
          if (slider === null) throw new Error('找不到回放时间轴')
          /*
           * React 的受控 input 把实例上的 value setter 换掉了，直接
           * `slider.value = x` **不会**触发 onChange——必须走**原型上**的原生
           * setter，再把 input 事件派发出去。少了这一步，下面量到的会是一串 0，
           * 而 0 看起来像「性能极好」。
           */
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          ).set
          const start = performance.now()
          setter.call(slider, String(value))
          slider.dispatchEvent(new Event('input', { bubbles: true }))
          return performance.now() - start
        },
        [target],
      ),
    )
  }

  const sortedSeeks = [...seekSamples].sort((a, b) => a - b)
  // 顺带把「真的走到了」印出来：拖动没生效时上面那串数全是 0，
  // 而这一行会让它现形（落点会停在 0 / 200）
  const landed = (await page.textContent('[data-testid="move-counter"]')) ?? ''
  console.log(`\n拖动回放时间轴（${LONG_RECORD_MOVES} 手棋谱，${seeks.length} 次）`)
  console.log(
    `  中位 ${sortedSeeks[Math.floor(sortedSeeks.length / 2)].toFixed(2)} ms   ` +
      `最小 ${sortedSeeks[0].toFixed(2)}   最大 ${sortedSeeks.at(-1).toFixed(2)}`,
  )
  console.log(`  末次落点 ${landed.replace(/\s+/g, ' ').trim()}`)
} finally {
  if (browser !== undefined) await browser.close()
  server.kill()
}
