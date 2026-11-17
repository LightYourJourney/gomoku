/**
 * AI 请求在 Worker 里的**排队时间**探针：`yarn bench:queue`。
 *
 * 量什么：引擎只有一个 Worker、搜索是同步的、没有取消。玩家在 AI 思考中悔棋再落子时，
 * 作废的那次搜索仍然占着 Worker，新请求只能在消息队列里等。这个探针直接量这段等待：
 *
 *   排队时间 = 往返时间（postMessage → 收到响应）− 引擎自报耗时（响应里的 `elapsedMs`）
 *
 * 怎么量：页面加载前把 `window.Worker` 包一层，给每次收发打 `performance.now()`。
 * **不改任何产品代码**；应用拿到的仍是原生 Worker 的全部行为。
 *
 * 四个场景：
 *   A. 专家档：落子 → 300 ms → 悔棋 → 立刻换点落子（3 轮）
 *   B. 堆积：连续 6 次「落子 → 150 ms → 悔棋」后正常落子
 *   C. 求提示后 50 ms 落子：落子请求是否排在提示后面
 *   D. Worker「新建 + 首个请求往返」的代价（评估「取消 = 终止并重建」是否可行）
 *
 * 用法（要量的是 `dist` 里的真实产物——D 场景靠产物里的 `worker-*.js` 文件名找脚本）：
 *
 *   yarn build
 *   yarn preview --port 5192 --strictPort
 *   yarn bench:queue                 # 默认 http://127.0.0.1:5192
 *   yarn bench:queue --raw           # 额外打印逐请求的原始数据（JSON）
 *
 * **测量条件必须一起记录**：机器忙时引擎耗时会被调度放大，排队时间随之放大。
 * 结论依赖的是「排队是否存在、是否随次数累积」，不是绝对毫秒数。
 *
 * 出处与首次结果：`docs/research/REFACTORING_ASSESSMENT.md` §4.3、§13。
 * 这也是「请求调度层」（该报告的阶段 B）的验收探针：做完后 A/C 应降到与 D 同量级，B 不再累积。
 */
import { loadavg } from 'node:os'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5192'
const RAW = process.argv.includes('--raw')

/** 页面加载前注入：记录每次发往 Worker 的请求与每条响应的时刻。 */
const instrumentWorker = () => {
  const log = (window.__workerLog = [])
  const Native = window.Worker
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args)
      this.addEventListener('message', (event) => {
        const data = event.data
        log.push({
          t: performance.now(),
          dir: 'in',
          id: data.requestId,
          elapsedMs: data.elapsedMs,
          reason: data.reason,
          depth: data.depth,
        })
      })
    }
    postMessage(message, ...rest) {
      log.push({
        t: performance.now(),
        dir: 'out',
        id: message.requestId,
        purpose: message.purpose,
        difficulty: message.difficulty,
      })
      return super.postMessage(message, ...rest)
    }
  }
}

/** 把收发日志按 requestId 配对成「一次请求一行」。 */
function pairRequests(log) {
  const sent = new Map()
  const rows = []
  for (const entry of log) {
    if (entry.dir === 'out') {
      sent.set(entry.id, entry)
      continue
    }
    const request = sent.get(entry.id)
    if (request === undefined) continue
    const roundTripMs = entry.t - request.t
    rows.push({
      id: entry.id,
      purpose: request.purpose,
      difficulty: request.difficulty,
      reason: entry.reason,
      depth: entry.depth,
      roundTripMs: Math.round(roundTripMs),
      engineMs: entry.elapsedMs,
      queuedMs: Math.round(roundTripMs - entry.elapsedMs),
    })
  }
  return rows
}

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(instrumentWorker)
  await page.goto(BASE)
  await page.getByTestId('status-pill').waitFor({ timeout: 10_000 })
  return { context, page }
}

const waitForStones = (page, count, timeout = 60_000) =>
  page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid^="stone-"]').length === expected,
    count,
    { timeout, polling: 20 },
  )

/**
 * 点天元附近的第一个空点并返回它的坐标键。
 * 不写死坐标：AI 的应手位置随版本变，写死的点可能已被占，点击会静默无效。
 */
async function clickEmptyPoint(page, skip = []) {
  const key = await page.evaluate((skipped) => {
    const taken = new Set(skipped)
    for (const stone of document.querySelectorAll('[data-testid^="stone-"]')) {
      taken.add(stone.getAttribute('data-testid').slice('stone-'.length))
    }
    for (let ring = 1; ring <= 4; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
          const candidate = `${7 + dx}-${7 + dy}`
          if (!taken.has(candidate)) return candidate
        }
      }
    }
    return null
  }, skip)
  if (key === null) throw new Error('天元附近没有空点了')
  await page.getByTestId(`intersection-${key}`).click()
  return key
}

/** 专家档开局：玩家两手、AI 两手，盘上 4 子，轮到玩家。 */
async function openExpertGame(browser) {
  const session = await openApp(browser)
  const { page } = session
  await page.getByRole('radio', { name: '专家' }).click()
  await page.getByTestId('intersection-7-7').click()
  await waitForStones(page, 2)
  await clickEmptyPoint(page)
  await waitForStones(page, 4)
  return session
}

const readLog = async (page) => pairRequests(await page.evaluate(() => window.__workerLog))

async function undoDuringThinking(browser) {
  const runs = []
  for (let round = 0; round < 3; round += 1) {
    const { context, page } = await openExpertGame(browser)
    const first = await clickEmptyPoint(page)
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '悔棋' }).click()
    await waitForStones(page, 4, 3_000)
    await clickEmptyPoint(page, [first])
    await waitForStones(page, 6)
    runs.push(await readLog(page))
    await context.close()
  }
  return runs
}

async function pileUp(browser) {
  const { context, page } = await openExpertGame(browser)
  const used = []
  for (let i = 0; i < 6; i += 1) {
    used.push(await clickEmptyPoint(page, used))
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: '悔棋' }).click()
    await waitForStones(page, 4, 3_000)
  }
  await clickEmptyPoint(page, used)

  // 应用给 AI 响应设了 15 秒超时：超时会出现 alert 而不是第 6 颗子，两种结局都要认。
  const startedAt = Date.now()
  const alerts = []
  let replied = false
  while (Date.now() - startedAt < 45_000) {
    for (const text of await page.getByRole('alert').allTextContents()) {
      if (!alerts.includes(text)) alerts.push(text)
    }
    if ((await page.getByTestId(/^stone-/).count()) === 6) {
      replied = true
      break
    }
    await page.waitForTimeout(250)
  }
  const result = { replied, waitedMs: Date.now() - startedAt, alerts, rows: await readLog(page) }
  await context.close()
  return result
}

async function hintThenPlay(browser) {
  const { context, page } = await openApp(browser)
  await page.getByRole('radio', { name: '专家' }).click()
  await page.getByTestId('intersection-7-7').click()
  await waitForStones(page, 2)
  await page.getByRole('button', { name: /提示/ }).first().click()
  await page.waitForTimeout(50)
  await clickEmptyPoint(page)
  await waitForStones(page, 4)
  const rows = await readLog(page)
  await context.close()
  return rows
}

async function respawnCost(browser) {
  const { context, page } = await openApp(browser)
  const result = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /worker-.*\.js/.test(name))
    if (url === undefined) return null

    // 盘上只有一颗子、入门档搜 1 层：引擎耗时可忽略，剩下的就是新建与往返的代价。
    const board = new Uint8Array(225)
    board[112] = 1
    const once = () =>
      new Promise((resolve) => {
        const startedAt = performance.now()
        const worker = new Worker(url, { type: 'module' })
        worker.onmessage = (event) => {
          const total = performance.now() - startedAt
          worker.terminate()
          resolve(Math.round(total - event.data.elapsedMs))
        }
        worker.postMessage({
          requestId: 1,
          gameVersion: 0,
          board,
          player: 2,
          difficulty: 'beginner',
          purpose: 'play',
        })
      })
    const samples = []
    for (let i = 0; i < 12; i += 1) samples.push(await once())
    return samples.sort((a, b) => a - b)
  })
  await context.close()
  return result
}

const describe = (row) =>
  `排队 ${row.queuedMs} ms（往返 ${row.roundTripMs} / 引擎 ${row.engineMs}，${row.reason} 深度 ${row.depth}）`

async function run() {
  const loadBefore = loadavg()[0]
  const browser = await chromium.launch({ channel: 'chrome' })
  let undo, pile, hint, respawn
  try {
    undo = await undoDuringThinking(browser)
    pile = await pileUp(browser)
    hint = await hintThenPlay(browser)
    respawn = await respawnCost(browser)
  } finally {
    await browser.close()
  }

  console.log(`\n=== AI 请求排队时间（${BASE}）===`)
  console.log(`1 分钟负载：开始 ${loadBefore.toFixed(1)} / 结束 ${loadavg()[0].toFixed(1)}`)

  console.log('\nA. 思考中悔棋再落子（看每轮最后一个请求）')
  undo.forEach((rows, index) => console.log(`  第 ${index + 1} 轮：${describe(rows[rows.length - 1])}`))

  console.log('\nB. 连续 6 次「落子 → 悔棋」后落子')
  const lastPile = pile.rows[pile.rows.length - 1]
  console.log(
    pile.replied
      ? `  AI 在 ${pile.waitedMs} ms 后应手；最后一个请求：${describe(lastPile)}`
      : `  45 秒内 AI 没有应手（已完成的请求 ${pile.rows.length} 个）`,
  )
  if (pile.alerts.length > 0) console.log(`  期间出现的提示：${pile.alerts.join(' / ')}`)

  console.log('\nC. 求提示后 50 ms 落子')
  for (const row of hint.filter((entry) => entry.purpose !== undefined).slice(-2)) {
    console.log(`  ${row.purpose}：${describe(row)}`)
  }

  console.log('\nD. Worker 新建 + 首个请求往返（扣除引擎耗时，12 次，升序）')
  console.log(
    respawn === null
      ? '  没找到 worker-*.js：这一项只能对生产构建量（yarn build && yarn preview）'
      : `  ${respawn.join(', ')} ms；中位 ${respawn[Math.floor(respawn.length / 2)]} ms`,
  )

  if (RAW) console.log(`\n${JSON.stringify({ undo, pile, hint, respawn }, null, 1)}`)
  console.log('\n提示：数字受机器负载影响。写进文档时把上面的负载一起记下。')
}

run().catch((error) => {
  console.error(`✗ 探针失败：${error instanceof Error ? error.message : String(error)}`)
  console.error(`  先确认 ${BASE} 可访问（yarn build && yarn preview --port 5192 --strictPort）。`)
  process.exitCode = 1
})
