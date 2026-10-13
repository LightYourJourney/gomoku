/**
 * UI 基线探针：`yarn ui:probe`。
 *
 * 跑在**真实 dev server + 真实 Chrome** 上，对 15 个受控界面状态 × 视口 × 主题
 * 各截一张图，并在同一时刻量一组 DOM 指标（尺寸、字号、命中区、对比度、溢出）。
 *
 * 为什么要有它：改版前后的截图必须是**同一批状态、同一批视口**拍的，否则
 * 「看起来好多了」这种结论没有可比性。把状态构造与量测都写成代码，改版之后再跑
 * 一次就是一份同口径的对照，而不是重新手工点一遍。
 *
 * 与 `render.probe.mjs` 的分工：那个量**性能**（首屏、落子耗时），这个量**外观与
 * 可达性**。两者都跑真浏览器、都在 `bench/`（`vite.config.ts` 的 watcher 白名单
 * 里已排除 `bench/**`，跑的时候不会把页面刷掉）。
 *
 * 状态构造一律走**受控夹具**：存档写 localStorage、进度与棋谱写 IndexedDB，
 * 都在应用启动之前落好，不点几十手去凑一个局面（那既慢又不可复现）。
 * 唯一的例外是提示 / 判题 / 分析这几个必须点出来的状态，它们用选择器等待。
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const PORT = 5184
const BASE_URL = `http://127.0.0.1:${PORT}`
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 输出目录。**默认是 `before/`，但改版期间必须用 `--out` 换个地方**——
 * 直接重跑会把基线覆盖掉，而基线一旦没了，「有没有变好」就没有对照物了。
 */
const outArg = process.argv.indexOf('--out')
const DEFAULT_DIR = 'before'
const OUT_DIR = resolve(
  repoRoot,
  'docs/ui-redesign/screenshots',
  outArg === -1 ? DEFAULT_DIR : (process.argv[outArg + 1] ?? 'after'),
)

// ── 受控夹具 ────────────────────────────────────────────────────
// 全部经 `bench/ui.fixtures.mjs` 的校验器验过：无重复落子、无提前成五。

/** 30 手的中局。双方都没有「下一手成五」的点，盘面看起来像一盘真下过的棋。 */
const MIDGAME = [
  [7, 7], [8, 8], [7, 8], [8, 7], [6, 6], [9, 9], [6, 8], [6, 7], [5, 7], [9, 7],
  [7, 6], [7, 9], [5, 8], [5, 9], [4, 6], [9, 6], [10, 8], [10, 7], [8, 5], [8, 4],
  [9, 5], [11, 6], [6, 5], [5, 5], [2, 7], [3, 9], [11, 8], [12, 9], [10, 9], [7, 10],
].map(([x, y]) => ({ x, y }))

/**
 * 11 手的散局，专门用来拍「AI 正在思考」。
 *
 * **为什么不能用中局那张**：中局里白棋有 3 手算杀（`threat.ts` 一走 VCF 就直接
 * 返回，整轮只花 1–4 ms），「思考中」在屏上根本留不住。散局的子两两相隔 2 格以上，
 * 构不成四，算杀无从下手，主搜索于是老老实实跑满专家档 2600 ms 的预算
 * （实测 2604 ms、深度 5、8666 个节点，见 BASELINE.md）。
 */
const SPARSE = [
  [2, 2], [5, 3], [8, 2], [11, 4], [3, 6], [6, 8], [9, 6], [12, 8], [4, 11], [7, 12], [10, 11],
].map(([x, y]) => ({ x, y }))

/** 9 手，黑在 H 列连成五子——终局弹窗与胜利连线的夹具。 */
const BLACK_WINS = [
  [7, 7], [8, 8], [7, 8], [8, 7], [7, 9], [8, 6], [7, 10], [9, 9], [7, 11],
].map(([x, y]) => ({ x, y }))

/** 10 手，白在 E 列连成五子。 */
const WHITE_WINS = [
  [3, 3], [4, 4], [3, 4], [4, 5], [3, 5], [4, 6], [5, 5], [4, 7], [6, 6], [4, 8],
].map(([x, y]) => ({ x, y }))

const session = (patch) => ({
  schemaVersion: 2,
  moves: [],
  firstPlayer: 1,
  mode: 'pve',
  humanColor: 1,
  difficulty: 'easy',
  resignedBy: null,
  ...patch,
})

const RECORDS = [
  { seq: 1, firstPlayer: 1, mode: 'pve', humanColor: 1, difficulty: 'easy', resignedBy: null, moves: BLACK_WINS },
  { seq: 2, firstPlayer: 1, mode: 'pve', humanColor: 2, difficulty: 'hard', resignedBy: null, moves: WHITE_WINS },
  { seq: 3, firstPlayer: 1, mode: 'pvp', humanColor: 1, difficulty: 'easy', resignedBy: 2, moves: MIDGAME },
].map((record) => ({ ...record, schemaVersion: 1 }))

const progress = (patch) => ({
  schemaVersion: 1,
  completedLessons: [],
  solvedPuzzles: [],
  lastVisited: null,
  lastView: 'battle',
  ...patch,
})

// ── 视口矩阵 ────────────────────────────────────────────────────

const WIDTHS = [390, 768, 1024, 1280, 1440, 1920]
const SHORT = [
  { id: '1280x680', width: 1280, height: 680 },
  { id: '1440x700', width: 1440, height: 700 },
]

function matrix() {
  const entries = []
  // 全状态 × 六档宽度（浅色）：响应式的完整证据
  for (const width of WIDTHS) {
    entries.push({ id: `${width}`, width, height: width <= 390 ? 844 : 900, theme: 'light' })
  }
  // 全状态 × 两档宽度（深色）：深浅两套主题都要看
  for (const width of [390, 1440]) {
    entries.push({ id: `${width}-dark`, width, height: width <= 390 ? 844 : 900, theme: 'dark' })
  }
  return entries
}

/** 较矮的桌面窗口只跑两个最吃高度的状态，避免上百张重复图。 */
const SHORT_FOR = new Set(['battle-empty', 'battle-midgame'])

// ── 状态 ────────────────────────────────────────────────────────

/** 等应用挂到第一帧。`board` 是四个页面共有的稳定锚点（复盘列表页除外）。 */
async function waitApp(page) {
  await page.waitForSelector('[data-testid="status-pill"], nav[aria-label="主导航"]')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(120)
}

async function seedIndexedDb(page, { records = null, learn = null }) {
  await page.evaluate(
    async ({ records, learn }) => {
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
        const tx = db.transaction(['progress', 'records'], 'readwrite')
        const progressStore = tx.objectStore('progress')
        const recordsStore = tx.objectStore('records')
        recordsStore.clear()
        if (learn !== null) progressStore.put(JSON.parse(JSON.stringify(learn)), 'learning')
        else progressStore.delete('learning')
        for (const record of records ?? []) recordsStore.put(JSON.parse(JSON.stringify(record)))
        tx.oncomplete = () => resolvePromise()
        tx.onerror = () => rejectPromise(tx.error)
      })

      db.close()
    },
    { records, learn },
  )
}

/**
 * 每个状态返回 `{ boot }`：`boot` 负责把页面带到该状态并**确认到位**。
 *
 * 确认一律用断言式的等待（等一个只在该状态下出现的元素），不用固定 sleep——
 * 状态没到位时探针要**响亮地失败**，否则会安静地拍下一张错的图。
 */
const STATES = [
  {
    id: 'battle-empty',
    group: 'battle',
    async boot(page) {
      await page.addInitScript((value) => localStorage.setItem('gomoku-lab:session', value), '')
      await page.goto(BASE_URL)
      await waitApp(page)
      await page.waitForSelector('[data-testid="status-pill"]:has-text("轮到你落子")')
    },
  },
  {
    id: 'battle-midgame',
    group: 'battle',
    async boot(page) {
      await seedSession(page, session({ moves: MIDGAME }))
      await page.waitForSelector('[data-testid="stone-7-10"]')
    },
  },
  {
    id: 'battle-thinking',
    group: 'battle',
    async boot(page) {
      // 11 手散局 + 专家档：既没有成五点也没有算杀，引擎会搜满 2600 ms 的预算
      await seedSession(page, session({ moves: SPARSE, difficulty: 'expert' }))
      await page.waitForSelector('[data-testid="status-pill"]:has-text("AI 思考中")')
    },
    /**
     * 拍完再确认一次「思考中」还在屏上——**这一条不能省**。
     *
     * 这是全场唯一一个会自己结束的状态：早先没有这道复核时，探针在算杀局面下
     * 拍到的其实是「AI 已经落子」的下一帧，图看着正常、状态却是错的。
     * 状态没拍到就响亮地失败，别留一张骗人的图。
     */
    async postAssert(page) {
      const pill = await page.locator('[data-testid="status-pill"]').textContent()
      if (!(pill ?? '').includes('AI 思考中')) {
        throw new Error(`截图时「AI 思考中」已经结束（当前状态条：${pill}）——这张图不是思考态`)
      }
    },
  },
  {
    id: 'battle-hint',
    group: 'battle',
    async boot(page) {
      await seedSession(page, session({ moves: MIDGAME }))
      await page.getByRole('button', { name: '求提示' }).click()
      await page.waitForSelector('[data-testid^="hint-candidate-"]')
      await page.waitForSelector('[data-testid="board-marks"]')
    },
  },
  {
    id: 'battle-confirm-restart',
    group: 'battle',
    /**
     * 防误触确认弹窗（Phase 02）。任务书 §十 点名要这张截图。
     *
     * 用**进行中且有落子**的存档：只有这种局面才会拦一道，
     * 空盘与终局都不拦——所以这张图同时是「什么时候会拦」的证据。
     */
    async boot(page) {
      await seedSession(page, session({ moves: MIDGAME }))
      await page.waitForSelector('[data-testid="stone-7-10"]')
      await page.getByRole('button', { name: '重新开始' }).click()
      await page.waitForSelector('[role="dialog"]')
    },
    async postAssert(page) {
      const text = await page.locator('[role="dialog"]').textContent()
      if (!(text ?? '').includes('会被清空')) {
        throw new Error(`确认弹窗没有说清后果（实际文案：${text}）——这张图不是确认态`)
      }
    },
  },
  {
    id: 'battle-finished',
    group: 'battle',
    async boot(page) {
      await seedSession(page, session({ moves: BLACK_WINS }))
      await page.waitForSelector('[role="dialog"]')
    },
  },
  {
    id: 'battle-ai-error',
    group: 'battle',
    async boot(page) {
      // **Worker 桩**：一 postMessage 就回一个 error 事件。截图里的 DOM 全是应用
      // 自己的错误路径渲染的，桩只负责把它触发出来（仓库自己的 e2e 也这么干）。
      await page.addInitScript(() => {
        class FailingWorker {
          listeners = {}
          addEventListener(type, handler) {
            ;(this.listeners[type] ??= []).push(handler)
          }
          removeEventListener(type, handler) {
            this.listeners[type] = (this.listeners[type] ?? []).filter((fn) => fn !== handler)
          }
          postMessage() {
            queueMicrotask(() => {
              for (const handler of this.listeners.error ?? []) {
                handler({ message: '审计用 Worker 桩：AI 引擎异常' })
              }
            })
          }
          terminate() {}
        }
        window.Worker = FailingWorker
      })
      // 29 手（奇数）→ 轮到 AI，它才会真的发请求，桩才有机可乘
      await seedSession(page, session({ moves: MIDGAME.slice(0, 29) }))
      await page.waitForSelector('[role="alert"]:has-text("AI 引擎异常")')
    },
  },
  {
    id: 'battle-finish-unsaved',
    group: 'battle',
    async boot(page) {
      // 存储不可用（隐私模式一类）：终局弹窗要如实说「没能保存这局」，
      // 同时棋盘、按钮照常可用——降级不等于不可操作。
      await page.addInitScript(() => {
        Object.defineProperty(window, 'indexedDB', {
          configurable: true,
          get() {
            return { open: () => { throw new Error('审计：IndexedDB 不可用') } }
          },
        })
      })
      // 必须让对局**在页面上真的结束**：`restore` 走的是「恢复」而不是
      // 「结束了一局」，不触发入库，弹窗上根本不会出现存档状态那一行。
      // 所以播种前 8 手，再由页面点下最后一手。
      await seedSession(page, session({ moves: BLACK_WINS.slice(0, 8) }))
      await page.getByTestId('intersection-7-11').click()
      await page.waitForSelector('[role="dialog"]:has-text("没能保存这局")')
    },
  },
  {
    id: 'learn-list',
    group: 'learn',
    async boot(page) {
      await bootLearned(page, progress({ lastView: 'learn' }))
      await page.waitForSelector('[data-testid="learn-progress"]:has-text("已完成 0 / 8 节")')
    },
  },
  {
    id: 'learn-list-done',
    group: 'learn',
    async boot(page) {
      // 做过一部分的样子：完成标记与进度计数是这一页的主要视觉状态之一。
      await bootLearned(
        page,
        progress({
          lastView: 'learn',
          completedLessons: ['rules', 'two', 'three', 'four', 'double'],
        }),
      )
      await page.waitForSelector('[data-testid="learn-progress"]:has-text("已完成 5 / 8 节")')
    },
  },
  {
    id: 'learn-diagram',
    group: 'learn',
    async boot(page) {
      // 恢复上次停留的课程，再翻到带棋盘演示的那一页
      await bootLearned(
        page,
        progress({ lastView: 'learn', lastVisited: { kind: 'lesson', id: 'rules' } }),
      )
      // 第 1 页是纯文字，第 2 页才带棋盘演示
      await page.waitForSelector('button:has-text("下一步")')
      await page.getByRole('button', { name: '下一步' }).click()
      await page.waitForSelector('[data-testid="sequence-progress"]')
    },
  },
  {
    id: 'learn-practice',
    group: 'learn',
    async boot(page) {
      await openLessonPractice(page)
      await page.waitForSelector('button:has-text("要提示")')
    },
  },
  {
    id: 'learn-practice-wrong',
    group: 'learn',
    async boot(page) {
      await openLessonPractice(page)
      // 故意走一个与目标无关的点：第一课练习是「补满这一排」，(0,0) 必错
      await page.getByTestId('intersection-0-0').click()
      await page.waitForSelector('[data-testid="feedback"][data-ok="false"]')
    },
  },
  {
    id: 'puzzle-list',
    group: 'puzzles',
    async boot(page) {
      await bootLearned(page, progress({ lastView: 'puzzles' }))
      await page.waitForSelector('[data-testid="puzzle-progress"]:has-text("已通过 0 / 15 题")')
    },
  },
  {
    id: 'puzzle-wrong',
    group: 'puzzles',
    async boot(page) {
      await bootLearned(
        page,
        progress({ lastView: 'puzzles', lastVisited: { kind: 'puzzle', id: 'win-h' } }),
      )
      await page.waitForSelector('[data-testid="board"]')
      await page.getByTestId('intersection-0-0').click()
      await page.waitForSelector('[data-testid="feedback"][data-ok="false"]')
    },
  },
  {
    id: 'puzzle-correct',
    group: 'puzzles',
    async boot(page) {
      await bootLearned(
        page,
        progress({ lastView: 'puzzles', lastVisited: { kind: 'puzzle', id: 'win-h' } }),
      )
      await page.waitForSelector('[data-testid="board"]')
      // 三级提示之后棋盘上会标出解法——**从标记上读坐标，不写死答案**
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: /要提示|再具体一点/ }).click()
      }
      const mark = page.locator('[data-testid^="board-mark-"]').first()
      await mark.waitFor()
      const testId = await mark.getAttribute('data-testid')
      const [, x, y] = /board-mark-(\d+)-(\d+)/.exec(testId)
      await page.getByTestId(`intersection-${x}-${y}`).click()
      await page.waitForSelector('[data-testid="feedback"][data-ok="true"]')
    },
  },
  {
    id: 'review-empty',
    group: 'review',
    async boot(page) {
      await bootLearned(page, progress({ lastView: 'review' }), { records: [] })
      await page.waitForSelector('text=还没有保存的对局')
    },
  },
  {
    id: 'review-library',
    group: 'review',
    async boot(page) {
      await bootLearned(page, progress({ lastView: 'review' }), { records: RECORDS })
      await page.waitForSelector('[data-testid="record-3"]')
    },
  },
  {
    id: 'review-replay',
    group: 'review',
    async boot(page) {
      await bootLearned(page, progress({ lastView: 'review' }), { records: RECORDS })
      await page.getByTestId('record-1').click()
      // 打开时游标在第 0 手，一路走到终局：编号徽标与胜利连线都在这一帧上
      await stepReplayToEnd(page, BLACK_WINS.length)
    },
  },
  {
    id: 'review-analysis',
    group: 'review',
    async boot(page) {
      await bootLearned(page, progress({ lastView: 'review' }), { records: RECORDS })
      await page.getByTestId('record-1').click()
      await stepReplayToEnd(page, BLACK_WINS.length)
      await page.getByRole('button', { name: '开始分析' }).click()
      // 分析逐手串行（9 手 × 400ms 预算）。等它**跑完**而不是等第一条结论——
      // 全部与引擎一致时一张结论卡都不会出现，等 verdict 会永远等不到。
      await page.waitForSelector('[data-testid="analysis-progress"]:has-text("已完成 9 / 9 手")', {
        timeout: 90_000,
      })
    },
  },
]

/** 走到回放终局。`下一步` 到末手会自动禁用，所以按手数点即可。 */
async function stepReplayToEnd(page, total) {
  await page.waitForSelector('[data-testid="move-counter"]')
  for (let i = 0; i < total; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }
  await page.waitForSelector(`[data-testid="move-counter"]:has-text("${total} / ${total}")`)
}

/** 打开第一课的练习页：第 1 页纯文字 → 第 2、3 页图解 → 练习。 */
async function openLessonPractice(page) {
  await bootLearned(
    page,
    progress({ lastView: 'learn', lastVisited: { kind: 'lesson', id: 'rules' } }),
  )
  await page.waitForSelector('button:has-text("下一步")')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一步' }).click()
  await page.waitForSelector('[data-testid="board"]')
}

/** 对战页的存档走 localStorage，在导航之前落好。 */
async function seedSession(page, value) {
  await page.addInitScript(
    (payload) => localStorage.setItem('gomoku-lab:session', payload),
    JSON.stringify(value),
  )
  await page.goto(BASE_URL)
  await waitApp(page)
}

/** 教学 / 残局 / 复盘三页的状态在 IndexedDB 里，落库之后必须重载才生效。 */
async function bootLearned(page, learn, extra = {}) {
  await page.goto(BASE_URL)
  await seedIndexedDb(page, { learn, records: extra.records ?? [] })
  await page.reload()
  await waitApp(page)
}

// ── 量测 ────────────────────────────────────────────────────────

/**
 * 在页面里跑的一组量测。**全部输出数字与选择器，不输出判断**——
 * 判断留在报告里写，探针只负责把事实带回来。
 */
const MEASURE = () => {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight

  const parse = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value ?? '')
    if (match === null) return null
    const [r, g, b, a = 1] = match[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { r, g, b, a }
  }
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  })
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const contrast = (a, b) => {
    const la = luminance(a)
    const lb = luminance(b)
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }

  /** 元素的有效背景：沿祖先链把半透明背景合成到底，遇到渐变就认输。 */
  const effectiveBackground = (element) => {
    const stack = []
    let node = element
    while (node !== null && node instanceof Element) {
      const style = getComputedStyle(node)
      if (style.backgroundImage !== 'none') return null
      const color = parse(style.backgroundColor)
      if (color !== null && color.a > 0) {
        stack.push(color)
        if (color.a >= 1) break
      }
      node = node.parentElement
    }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
    return base
  }

  const describe = (element) => {
    const testId = element.getAttribute('data-testid')
    const tag = element.tagName.toLowerCase()
    const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${tag}${testId === null ? '' : `[${testId}]`}${text === '' ? '' : `{${text}}`}`
  }

  const rectOf = (element) => {
    if (element === null) return null
    const r = element.getBoundingClientRect()
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    }
  }

  const all = [...document.querySelectorAll('*')]
  const visible = (element) => {
    const r = element.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const style = getComputedStyle(element)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }

  /**
   * 纵向装不下的滚动容器。
   *
   * 侧栏是 `overflow-y-auto`，装不下时**界面看起来完全正常**——只是有几块
   * 面板落在折线以下。不量它，「右栏四块面板在 900px 高度下要滚」这件事
   * 在截图上很难看出来。
   */
  const scrollContainers = []
  for (const element of all) {
    if (!visible(element)) continue
    const style = getComputedStyle(element)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    if (element.scrollHeight <= element.clientHeight + 1) continue
    scrollContainers.push({
      element: describe(element),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      hidden: element.scrollHeight - element.clientHeight,
    })
  }

  const overflowing = []
  const clipped = []
  for (const element of all) {
    if (!visible(element)) continue
    // `sr-only` 那类元素是 1×1 且刻意裁掉的（例如棋盘播报），不是布局问题
    if (element.clientWidth <= 2 || element.clientHeight <= 2) continue
    const r = element.getBoundingClientRect()
    if (r.right > vw + 0.5 || r.left < -0.5) {
      overflowing.push({ element: describe(element), ...rectOf(element) })
    }
    if (
      element.scrollWidth > element.clientWidth + 1 &&
      ['hidden', 'clip'].includes(getComputedStyle(element).overflowX)
    ) {
      clipped.push({
        element: describe(element),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })
    }
  }

  // 字号直方图：只看真正承载文字的节点，避免把容器算进去
  const fontHistogram = {}
  const typeSamples = new Map()
  const contrastRows = []
  for (const element of all) {
    if (!visible(element)) continue
    const hasText = [...element.childNodes].some(
      (node) => node.nodeType === 3 && node.textContent.trim() !== '',
    )
    if (!hasText) continue

    const style = getComputedStyle(element)
    const size = style.fontSize
    fontHistogram[size] = (fontHistogram[size] ?? 0) + 1

    const key = `${size}|${style.lineHeight}|${style.color}|${style.fontWeight}`
    if (!typeSamples.has(key)) {
      typeSamples.set(key, {
        fontSize: size,
        lineHeight: style.lineHeight,
        color: style.color,
        weight: style.fontWeight,
        sample: describe(element),
        count: 0,
      })
    }
    typeSamples.get(key).count++

    // 棋盘上的 SVG 文字（坐标、编号徽标）底色是木纹渐变，量不了，如实跳过
    if (element instanceof SVGElement) continue
    const foreground = parse(style.color)
    const background = foreground === null || foreground.a === 0 ? null : effectiveBackground(element)
    if (foreground === null || background === null) continue

    const composited = foreground.a < 1 ? over(foreground, background) : foreground
    const ratio = contrast(composited, background)
    const px = Number.parseFloat(size)
    const large = px >= 24 || (px >= 18.66 && Number(style.fontWeight) >= 700)
    const threshold = large ? 3 : 4.5

    if (ratio < threshold) {
      contrastRows.push({
        element: describe(element),
        fontSize: size,
        weight: style.fontWeight,
        color: style.color,
        ratio,
        threshold,
      })
    }
  }

  // 命中区：WCAG 2.5.8 的 24px 下限，以及移动端常用的 44px 建议值
  const targets = []
  const interactive =
    'button, a[href], input, select, textarea, [role="radio"], [role="switch"], [tabindex]:not([tabindex="-1"])'
  for (const element of document.querySelectorAll(interactive)) {
    if (!visible(element)) continue
    const r = element.getBoundingClientRect()
    const w = Math.round(r.width)
    const h = Math.round(r.height)
    if (w < 44 || h < 44) {
      targets.push({ element: describe(element), w, h, under24: w < 24 || h < 24 })
    }
  }

  const headings = [...document.querySelectorAll('h1, h2, h3, h4')]
    .filter(visible)
    .map((element) => ({
      level: element.tagName.toLowerCase(),
      text: (element.textContent ?? '').trim().replace(/\s+/g, ' '),
    }))

  const buttons = [...document.querySelectorAll('button')]
    .filter(visible)
    .map((element) => (element.textContent ?? '').trim().replace(/\s+/g, ' '))
    .filter((text) => text !== '')

  const main = document.querySelector('main')
  const board = document.querySelector('[data-testid="board"]')
  const header = document.querySelector('header')
  const asides = [...document.querySelectorAll('aside')].filter(visible)

  // 棋盘上的小字与命中区：坐标标签是个 SVG <text>，字号按用户坐标算，
  // 换算成 CSS 像素才知道它到底几 px；命中区同理。
  const coord = document.querySelector('[data-testid="coord"]')
  const intersection = document.querySelector('[data-testid="intersection-0-0"]')
  const counterRect = (element) => {
    if (element === null) return null
    const r = element.getBoundingClientRect()
    return {
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
    }
  }

  // 状态药丸里那个转圈。`animate-spin` 是 Tailwind 的动画，不在
  // index.css 的 `prefers-reduced-motion` 名单里——把动画名带回来，
  // 「减少动态下它照转」这句话才有据可查。
  const spinner = document.querySelector('[data-testid="status-pill"] .animate-spin')

  return {
    boardDetails: {
      coordText: counterRect(coord),
      intersectionHit: counterRect(intersection),
    },
    spinner: spinner === null ? null : {
      animationName: getComputedStyle(spinner).animationName,
      animationDuration: getComputedStyle(spinner).animationDuration,
    },
    metaThemeColor:
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    scrollContainers,
    viewport: { vw, vh },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > vw,
      bodyScrollHeight: document.body.scrollHeight,
    },
    regions: {
      header: rectOf(header),
      main: rectOf(main),
      asides: asides.map(rectOf),
      mainGridTemplate: main === null ? null : getComputedStyle(main).gridTemplateColumns,
    },
    board: rectOf(board),
    boardRatioOfViewport:
      board === null ? null : Math.round(((board.getBoundingClientRect().width / vw) * 100 + Number.EPSILON) * 10) / 10,
    statusPill: document.querySelector('[data-testid="status-pill"]')?.textContent?.trim() ?? null,
    fontHistogram,
    typeSamples: [...typeSamples.values()].sort(
      (a, b) => Number.parseFloat(b.fontSize) - Number.parseFloat(a.fontSize),
    ),
    contrastViolations: contrastRows,
    smallTargets: targets,
    headings,
    buttons,
    overflowing: overflowing.slice(0, 40),
    clipped: clipped.slice(0, 40),
    counts: {
      elements: all.length,
      overflowing: overflowing.length,
      clipped: clipped.length,
      contrastViolations: contrastRows.length,
      smallTargets: targets.length,
    },
  }
}

// ── 主流程 ──────────────────────────────────────────────────────

function startDevServer() {
  return spawn(
    'yarn',
    ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: repoRoot, stdio: 'ignore' },
  )
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
  throw new Error(`dev server 在 ${BASE_URL} 上没起来`)
}

const args = process.argv.slice(2)
/**
 * `--merge`：把本次结果并回已有的 `measurements.json`，而不是整份覆盖。
 *
 * 修好某一个状态之后只想重拍它，不该被迫把一百多张都重来一遍。
 */
const merge = args.includes('--merge')
/** 位置参数即状态名，留空表示全部（`--out` 的值要被排掉）。 */
const only = args.filter(
  (value, index) => !value.startsWith('-') && args[index - 1] !== '--out',
)

const server = startDevServer()
let browser
const measurements = []
let shot = 0

/*
 * **别让一次手滑毁掉基线。**
 *
 * `--out` 只是「可以换个目录」，不带它跑一次照样整份覆写 `before/`——
 * 而基线一旦没了，「改好了没有」就没有对照物了，这是不可逆的损失。
 * 所以默认目录已存在量测报告时必须显式 `--force`，否则直接拒绝开跑。
 * 这道闸门是量出来的教训：光在文档里写「记得加 --out」挡不住手滑。
 */
if (OUT_DIR.endsWith(`/${DEFAULT_DIR}`) && !process.argv.includes('--force')) {
  const existing = await readFile(resolve(OUT_DIR, 'measurements.json'), 'utf8').catch(() => null)
  if (existing !== null) {
    console.error(
      `拒绝覆盖基线：${resolve(OUT_DIR, 'measurements.json')} 已存在。\n` +
        `  · 改版之后重拍请用：yarn ui:probe --out after-phaseNN\n` +
        `  · 确实要重拍基线（例如基线本身拍错了）才加 --force`,
    )
    process.exit(2)
  }
}

try {
  await waitForServer()
  await mkdir(OUT_DIR, { recursive: true })

  browser = await chromium.launch({ channel: 'chrome' })

  const states = only.length > 0 ? STATES.filter((state) => only.includes(state.id)) : STATES

  for (const state of states) {
    for (const entry of matrix()) {
      const sizes = [{ id: entry.id, width: entry.width, height: entry.height }]
      // 矮窗口的补充采样只在浅色的 1440 那一档加，别在每个主题里重复一遍
      if (SHORT_FOR.has(state.id) && entry.theme === 'light' && entry.id === '1440') {
        sizes.push(...SHORT)
      }

      for (const size of sizes) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1,
        })
        const page = await context.newPage()

        // 主题通过设置里的偏好落地，不靠 colorScheme——应用的两套主题就是由它切的
        await page.addInitScript(
          (theme) =>
            localStorage.setItem(
              'gomoku-lab:settings',
              JSON.stringify({ state: { theme, showCoords: true, soundEnabled: true }, version: 0 }),
            ),
          entry.theme,
        )

        const startedAt = Date.now()
        try {
          await state.boot(page)
        } catch (error) {
          // 带上当时的界面事实再抛：只有一句「等待超时」的诊断价值等于零
          const seen = await page
            .evaluate(() => ({
              pill: document.querySelector('[data-testid="status-pill"]')?.textContent ?? null,
              alerts: [...document.querySelectorAll('[role="alert"]')].map((el) =>
                (el.textContent ?? '').slice(0, 80),
              ),
              testIds: [...document.querySelectorAll('[data-testid]')]
                .slice(0, 12)
                .map((el) => el.getAttribute('data-testid')),
            }))
            .catch(() => null)
          await context.close()
          throw new Error(
            `状态 ${state.id} 在 ${size.id}/${entry.theme} 下没能就位：${error.message}\n` +
              `  当时界面：${JSON.stringify(seen)}`,
          )
        }

        const name = `${state.group}-${state.id}__${size.id}-${entry.theme}.png`
        await page.screenshot({
          path: resolve(OUT_DIR, name),
          fullPage: false,
          animations: 'disabled',
        })
        shot++

        if (typeof state.postAssert === 'function') await state.postAssert(page)

        const metrics = await page.evaluate(MEASURE)
        measurements.push({
          state: state.id,
          group: state.group,
          // 视口标签。页面里量到的 `viewport: {vw, vh}` 在 `...metrics` 里，
          // 两者不要同名，否则后者会把前者盖掉。
          size: size.id,
          theme: entry.theme,
          file: name,
          setupMs: Date.now() - startedAt,
          ...metrics,
        })

        const where = `${state.id} @ ${size.id} ${entry.theme}`
        const flags = []
        if (metrics.document.horizontalOverflow) flags.push('横向溢出')
        if (metrics.counts.contrastViolations > 0) flags.push(`对比度 ${metrics.counts.contrastViolations}`)
        if (metrics.counts.overflowing > 0) flags.push(`越界 ${metrics.counts.overflowing}`)
        if (metrics.counts.clipped > 0) flags.push(`裁切 ${metrics.counts.clipped}`)
        console.log(
          `✓ ${where.padEnd(46)} 棋盘 ${String(metrics.boardRatioOfViewport ?? '—').padStart(5)}%  ` +
            `${flags.length === 0 ? '—' : flags.join(' · ')}`,
        )

        await context.close()
      }
    }
  }

  /*
   * 减少动态效果下的实际行为。
   *
   * `index.css` 的 `prefers-reduced-motion` 名单只关了四个 `.motion-*` 自定义动画，
   * 而状态药丸里的转圈是 Tailwind 的 `animate-spin`。**名单之外的东西还转不转**，
   * 只能在真浏览器里开着 reducedMotion 问一句——顺带把全场所有还在跑的动画
   * 一起列出来，免得只盯着一处。
   */
  let reducedMotion = null
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await STATES.find((state) => state.id === 'battle-thinking').boot(page)
    reducedMotion = await page.evaluate(() => {
      const running = []
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element)
        if (style.animationName !== 'none' && style.animationPlayState === 'running') {
          const r = element.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          running.push(`${element.tagName.toLowerCase()}.${element.className || '(无类名)'}`.slice(0, 60))
        }
      }
      return {
        mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        stillAnimating: running,
      }
    })
    await context.close()
    console.log(
      `\n减少动态效果：媒体查询命中=${reducedMotion.mediaMatches}，仍在播放动画的元素 ` +
        `${reducedMotion.stillAnimating.length} 个 ${JSON.stringify(reducedMotion.stillAnimating)}`,
    )
  }

  const reportPath = resolve(OUT_DIR, 'measurements.json')
  let all = measurements
  if (merge) {
    const previous = JSON.parse(await readFile(reportPath, 'utf8'))
    const shotStates = new Set(measurements.map((row) => row.state))
    all = [...previous.measurements.filter((row) => !shotStates.has(row.state)), ...measurements]
  }
  const covered = [...new Set(all.map((row) => row.state))].sort()

  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        generatedFrom: { baseUrl: BASE_URL, devServer: 'vite dev', deviceScaleFactor: 1 },
        states: covered,
        reducedMotion,
        measurements: all,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`\n本次 ${states.length} 个状态、${shot} 张截图 → ${OUT_DIR}`)
  console.log(`量测报告共 ${covered.length} 个状态 / ${all.length} 条`)
  console.log(`量测数据 → ${reportPath}`)

  /*
   * ── 五条量化判据的自检闸门 ──────────────────────────────────
   *
   * `DESIGN_SYSTEM.md` §12 的五条判据此前只是「量得到」：探针把它们写进
   * `measurements.json`，人再去翻。于是代码注释里「由探针守着」这句话是假的——
   * 采集不等于判定。**一条永远不红的判据等于没有判据**，这个仓库已经为此吃过亏
   * （F-UI-01 就是这么活下来的：169px 的棋盘在 46 条 e2e 全绿的状态下存在了两天）。
   *
   * 所以在这里真的判一次，不合格就响亮地退出。
   * **只判本次跑到的状态**，不判 merge 进来的历史快照——
   * 重拍修好之前的基线（`--force` 拍 `before/`）本来就应该红，那是它的意义。
   */
  const violations = checkCriteria(measurements)
  if (violations.length > 0) {
    console.error(`\n✗ ${violations.length} 处违反 DESIGN_SYSTEM.md §12 的量化判据：`)
    for (const line of violations.slice(0, 20)) console.error(`   ${line}`)
    if (violations.length > 20) console.error(`   ……另有 ${violations.length - 20} 处`)
    process.exitCode = 1
  } else {
    console.log(`\n✓ 五条量化判据全部通过（本次 ${measurements.length} 条量测）`)
  }
} finally {
  if (browser !== undefined) await browser.close()
  server.kill('SIGTERM')
}

/**
 * `DESIGN_SYSTEM.md` §12 的五条量化判据，逐条判真假，返回人话形式的违规清单。
 *
 * 判据的口径与那份文档逐条一致，**改一处要同步另一处**：
 *
 * 1. `contrastViolations` 全 0；
 * 2. `board` 宽高 ≥ 320（任何状态、任何视口）；
 * 3. `boardRatioOfViewport` 在任何 ≥1024 的视口下 ≥ 35%；
 * 4. `document.horizontalOverflow` 全 false；
 * 5. `smallTargets.under24` 只允许剩下棋盘交叉点（`rect[intersection-*]`）——
 *    一格 = 棋盘/16，390 屏幕满幅也只有约 24px，棋盘永远过不了这条线，
 *    而规范又明令不许放大命中区；棋盘的安全由判据 2、3 单独守。
 */
function checkCriteria(rows) {
  const bad = []

  for (const row of rows) {
    const where = `${row.state} @ ${row.size}`

    for (const violation of row.contrastViolations ?? []) {
      bad.push(`[1 对比度] ${where}：${violation.element} ${violation.ratio}:1 < ${violation.threshold}`)
    }

    const board = row.board
    if (board !== null && board !== undefined && (board.w < 320 || board.h < 320)) {
      bad.push(`[2 棋盘] ${where}：${board.w}×${board.h}，低于 320`)
    }

    const vw = row.viewport?.vw
    if (vw !== undefined && vw >= 1024 && row.boardRatioOfViewport !== null) {
      if (row.boardRatioOfViewport !== undefined && row.boardRatioOfViewport < 35) {
        bad.push(`[3 占比] ${where}：棋盘只占视口宽 ${row.boardRatioOfViewport}%，低于 35%`)
      }
    }

    if (row.document?.horizontalOverflow) {
      bad.push(`[4 横向溢出] ${where}：文档横向溢出 ${row.document.scrollWidth - row.document.clientWidth}px`)
    }

    for (const target of row.smallTargets ?? []) {
      if (target.under24 && !String(target.element).includes('intersection-')) {
        bad.push(`[5 命中区] ${where}：${target.element} 只有 ${target.w}×${target.h}`)
      }
    }
  }

  return bad
}
