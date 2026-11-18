/**
 * 棋谱库**规模**探针：`yarn bench:library`。
 *
 * 量什么：棋谱库只增不减、列表全量渲染。库里有 N 条棋谱时，
 *   (a) 一局终了入库要多久（入库前要列全表做内容去重）；
 *   (b) 打开复盘页到第一条棋谱可见要多久、渲染出多少 DOM 节点、有没有长任务。
 *
 * 怎么量：每个 N 用一个全新的浏览器上下文（IndexedDB 互相隔离）。先让应用自己把库建好，
 * 再用原生 IndexedDB 灌入 N 条**合法且互不相同**的棋谱，刷新后操作界面。**不改任何产品代码。**
 *
 * 灌入的数据与 `src/persist/schema.ts` / `gameRecords.ts` 的形状**耦合**
 * （库名 `gomoku-lab`、仓库 `records`、`schemaVersion: 1` 的记录字段）。
 * 改了棋谱的存储形状，这里的 `seedRecords` 必须跟着改——否则灌进去的会被当成读不出来的坏记录，
 * 列表行数对不上 N（脚本会报出来）。
 *
 * 用法：
 *
 *   yarn build
 *   yarn preview --port 5192 --strictPort
 *   yarn bench:library                      # N = 0, 200, 1000, 5000
 *   SIZES=0,500 yarn bench:library          # 自定规模
 *
 * 出处与首次结果：`docs/research/REFACTORING_ASSESSMENT.md` §4.6、§13。
 */
import { loadavg } from 'node:os'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5192'
const SIZES = (process.env.SIZES ?? '0,200,1000,5000').split(',').map(Number)

const observeLongTasks = () => {
  window.__longTasks = []
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration))
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    // 不支持 longtask 的浏览器：这一列留空，其余照量
  }
}

/** 页内执行：灌入 count 条棋谱，返回耗时（毫秒）。 */
const seedRecords = async (count) => {
  // 黑子只落 (x + 2y) % 4 < 2 的格、白子落其余格：这种染色下任意方向都凑不出同色五连，
  // 所以从两组里任取前缀交替落子，一定是合法的未终局手顺；再标成认输终局。
  const black = []
  const white = []
  for (let y = 0; y < 15; y += 1) {
    for (let x = 0; x < 15; x += 1) ((x + 2 * y) % 4 < 2 ? black : white).push({ x, y })
  }
  let seed = 12345
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const shuffled = (points) => {
    const copy = points.slice()
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('gomoku-lab')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const startedAt = performance.now()
  await new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    const store = tx.objectStore('records')
    for (let i = 0; i < count; i += 1) {
      const blackOrder = shuffled(black)
      const whiteOrder = shuffled(white)
      const length = 40 + Math.floor(random() * 80)
      const moves = []
      for (let k = 0; k < length; k += 1) moves.push(k % 2 === 0 ? blackOrder[k >> 1] : whiteOrder[k >> 1])
      store.add({
        schemaVersion: 1,
        moves,
        firstPlayer: 1,
        mode: 'pve',
        humanColor: 1,
        difficulty: 'easy',
        resignedBy: 1,
        winner: 2,
      })
    }
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return Math.round(performance.now() - startedAt)
}

const drainLongTasks = (page) =>
  page.evaluate(() => {
    const tasks = window.__longTasks.slice()
    window.__longTasks.length = 0
    return tasks
  })

async function measure(browser, size) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await page.addInitScript(observeLongTasks)
    await page.goto(BASE)
    await page.getByTestId('status-pill').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(500) // 等应用自己把库建好（学习进度的首次读取会触发建库）
    const seedMs = size > 0 ? await page.evaluate(seedRecords, size) : 0
    await page.reload()
    await page.getByTestId('status-pill').waitFor()
    await drainLongTasks(page)

    // (a) 终局入库：空盘认输 → 出现「这局已存入棋谱库」
    await page.getByRole('button', { name: '认输' }).click()
    const saveStartedAt = Date.now()
    await page.getByRole('button', { name: /确认认输|确认/ }).first().click()
    await page.getByText('这局已存入棋谱库').waitFor({ timeout: 120_000 })
    const saveMs = Date.now() - saveStartedAt
    const longDuringSave = await drainLongTasks(page)
    await page.keyboard.press('Escape')

    // (b) 打开复盘页：点导航 → 第一条棋谱可见
    const openStartedAt = Date.now()
    await page.getByRole('button', { name: '复盘' }).first().click()
    await page.locator('[data-testid^="record-"]').first().waitFor({ timeout: 120_000 })
    const openMs = Date.now() - openStartedAt
    await page.waitForTimeout(300)
    const dom = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-testid^="record-"]').length,
      nodes: document.querySelectorAll('*').length,
    }))
    const longDuringOpen = await drainLongTasks(page)
    return { size, seedMs, saveMs, longDuringSave, openMs, longDuringOpen, ...dom }
  } finally {
    await context.close()
  }
}

async function run() {
  const loadBefore = loadavg()[0]
  const browser = await chromium.launch({ channel: 'chrome' })
  const results = []
  try {
    for (const size of SIZES) results.push(await measure(browser, size))
  } finally {
    await browser.close()
  }

  console.log(`\n=== 棋谱库规模（${BASE}）===`)
  console.log(`1 分钟负载：开始 ${loadBefore.toFixed(1)} / 结束 ${loadavg()[0].toFixed(1)}`)
  console.log('\n  N      入库 ms  打开复盘 ms  列表行数  DOM 节点  长任务 ms（入库 | 打开）')
  for (const row of results) {
    console.log(
      `  ${String(row.size).padEnd(6)} ${String(row.saveMs).padEnd(8)} ${String(row.openMs).padEnd(12)} ` +
        `${String(row.rows).padEnd(9)} ${String(row.nodes).padEnd(9)} ` +
        `${row.longDuringSave.join(',') || '—'} | ${row.longDuringOpen.join(',') || '—'}`,
    )
    // 灌入 N 条 + 刚认输的那一局；对不上说明灌入的形状已经跟不上存储层了。
    // 阶段 D 起列表一批只显示 50 局（之前的构建全量显示），两种都认。
    const expected = [row.size + 1, Math.min(row.size + 1, 50)]
    if (!expected.includes(row.rows)) {
      console.log(`    ⚠ 期望 ${expected.join(' 或 ')} 行：seedRecords 的记录形状可能已与 src/persist 不一致`)
    }
  }
  console.log('\n提示：数字受机器负载影响。写进文档时把上面的负载一起记下。')
}

run().catch((error) => {
  console.error(`✗ 探针失败：${error instanceof Error ? error.message : String(error)}`)
  console.error(`  先确认 ${BASE} 可访问（yarn build && yarn preview --port 5192 --strictPort）。`)
  process.exitCode = 1
})
