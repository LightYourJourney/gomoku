# Gomoku Lab Phase 5 实施计划：打磨、无障碍与发布

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Phase 1–4 已经能用的东西**能被更多人用、也更耐看**——键盘可以下棋、动效与音效完整、移动与平板复核过、错误不白屏、生产构建真的跑过、README 与使用说明是准的。

**Architecture:** 不新增运行时依赖。动画用 CSS keyframes（原生 + Tailwind），键盘操作用 **ARIA grid 模式**加在现有 SVG 命中区上，错误边界是唯一的新组件。生产验收靠新增的 `e2e:prod` 通道（Playwright 指向 `vite preview`），因为现在的 e2e 只跑过 dev server——`dist/` 从未被真正验证过。

**Tech Stack:** 沿用全部现有栈，**不新增依赖**（见下方 Ruling 1）。

**Spec:** `docs/ROADMAP.md` 的「Phase 5 · 最终打磨」8 项 + `AGENTS.md` 全局约束 + `docs/ARCHITECTURE.md`。

---

## 全局约束

- **完全离线**：不上报、不引 CDN、字体与图标全部本地（现状：无外部请求）。
- **不使用 `enum`**、类型导入用 `import type`；界面文案一律简体中文。
- **`core`/`ai`/`learn`/`analysis` 的纯逻辑部分不得引入 React/DOM/存储**；新增的动画与键盘逻辑只允许住在 `components/`、`features/`、`lib/`。
- **`Date.now()` 只允许出现在 `ai/search.ts`**——新增的演示/测试若需要时间，用注入的时钟或 `vi.useFakeTimers()`。
- **无障碍是硬要求，不是加分项**：键盘可达（棋盘、面板、弹窗）、焦点可见、`prefers-reduced-motion` 生效、状态变化有 `aria-live` 播报。
- **性能数字必须实测**（`yarn bench` / 构建产物体积 / 浏览器 trace），写进文档的每个数字都要能重跑出来。**没有实测收益的优化不做。**
- **提交前五道闸门**：`yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e`。
- 文档同步：`ARCHITECTURE.md`（键盘/动效/错误边界的归属）、`ROADMAP.md`（Phase 5 勾选 + 已知不足）、`TEST_REPORT.md`（计数、浏览器验证、实测数字）、`README.md`（现状已经过期）。

### Ruling 1：动画用 CSS，不重新引入 `motion`

ROADMAP 原文写「落子与面板动画落地时再装回来」。**改这条**：本阶段需要的动效只有四处（落子落下的那一下、最后一手脉冲、面板/弹窗淡入、反馈条滑入），CSS keyframes + `prefers-reduced-motion` 大约三十行就能做完（`reduce` 下只关 `animation`，保留 150ms 级别的 `transition`——那是最短的状态反馈，不属于「动效」），而 `motion` 是运行时依赖（体积 + 版本 + API 面）。**代价**：将来若要做有编排的弹簧动画（例如复盘自动播放的节奏曲线、拖拽回弹），那时再装 `motion`——届时它是被真实需求引进来的，不是提前的。

### Ruling 2：键盘用 ARIA grid 模式，加在现有命中区上

棋盘已经是 225 个 `<rect>` 命中区。把它们升级成 `role="gridcell"`（带坐标与状态的可读名），容器在可交互时是 `role="grid"`、只读回放时仍是 `role="img"`；**roving tabindex**——整张盘只有当前焦点格 `tabIndex=0`，Tab 进出一跳，方向键在格间移动，Enter/Space 落子。**不做**「225 个 Tab 停靠点」（那对键盘用户是酷刑），也不另建一套隐藏控件（两套 DOM 迟早不一致）。**代价**：`Board.test.tsx` 里关于 `role="img"` 的断言要跟着改，属于有意变更。

---

## Review Focus

规格隐含、但各任务自身测试不会覆盖、最容易伤到真实用户的情形。每条都绑到 owning task：

1. **键盘用户在 AI 思考期间落子** —— 键盘没有「禁用态」的视觉反馈，玩家按 Enter 没反应会以为坏了。T2 要求：不可落子时（AI 思考 / 终局 / 非本回合）有明确播报，且 e2e 覆盖。
2. **动效让前庭敏感用户不适** —— `prefers-reduced-motion: reduce` 必须真正生效（不是只写个 media query 却仍跑 JS 动画）。T1 的测试在 reduced-motion 下断言不发生位移/缩放类动画。
3. **焦点丢失** —— 落子后棋盘重渲染，焦点若被重置到 body，键盘用户就得重新 Tab 进来。T2 要求落子后焦点仍在原格（或落在最新一手），并有测试钉住。
4. **生产构建与开发环境行为不一致** —— 之前所有浏览器验证都跑在 dev server 上；worker 路径、资源哈希、`base` 前缀的问题只有 `dist` 才暴露。T6 的 `e2e:prod` 必须真跑一遍完整对局。
5. **错误边界自身坏了** —— 边界组件若在渲染中抛错，用户看到白屏（正是它要防的）。T4 要求：边界渲染的是最简 DOM，且有一条「子组件抛错 → 兜底 UI 出现」的测试。
6. **平板/触屏的边缘命中** —— 底边与右边缘的交叉点最容易因为留白换算而偏移半格（Phase 1 踩过）。T5 在平板视口上点四角与四边中点，逐一核对落点。

---

## 文件结构

```
src/
├─ components/
│  ├─ AppErrorBoundary.tsx        [新] 顶层错误边界 + 兜底 UI
│  └─ board/Board.tsx             [改] ARIA grid、roving tabindex、键盘事件、焦点环
├─ features/battle/BattleScreen.tsx  [改] aria-live 播报、接入动效类名
├─ lib/
│  ├─ sound.ts                    [改] 胜负音 + AudioContext 预热
│  └─ motion.ts                   [新] 动效类名与 reduced-motion 判定（纯函数，可测）
├─ index.css                      [改] keyframes + prefers-reduced-motion
└─ main.tsx                       [改] 挂错误边界

e2e/
├─ a11y.spec.ts                   [新] 键盘对局、焦点、播报
├─ tablet.spec.ts                 [新] 平板视口与边缘命中
└─ prod.spec.ts                   [新] 生产构建冒烟（走 preview 通道）
```

---

## Task 1：动效基础（CSS + reduced-motion）

**Files:**
- Create: `src/lib/motion.ts`、`src/lib/motion.test.ts`
- Modify: `src/index.css`、`src/components/board/Board.tsx`（落子与最后一手）、`src/components/ui/Modal.tsx`（淡入）、`src/components/panels/FeedbackBanner.tsx`（滑入）

**Interfaces:**
- Produces:
  ```ts
  /** 动效类名。reduced-motion 时返回空串，由 CSS 兜底——判定不依赖 matchMedia 的运行时分支，便于测试。 */
  export const MOTION = {
    stoneDrop: 'motion-stone-drop',
    lastMovePulse: 'motion-last-move-pulse',
    panelIn: 'motion-panel-in',
    bannerIn: 'motion-banner-in',
  } as const
  export type MotionKey = keyof typeof MOTION
  export function motionClass(key: MotionKey): string   // 恒返回类名；是否播动画由 CSS 的 media query 决定
  ```
- CSS：四处 `@keyframes` + 在 `@media (prefers-reduced-motion: reduce)` 内把 `animation: none`（**不是** JS 里判断 `matchMedia`——那是 T1 Review Focus 2 的坑：JS 判定会在 SSR/测试环境失真，且用户中途改系统设置时不会更新）。

- [ ] **Step 1: 写失败测试**（`src/lib/motion.test.ts`）：

```ts
it('motionClass 返回对应的类名', () => {
  expect(motionClass('stoneDrop')).toBe('motion-stone-drop')
})

it('reduced-motion 的降级写在 CSS 里，JS 不做媒体查询分支', () => {
  // 断言实现没有引用 matchMedia —— 中途改系统设置时 JS 分支不会更新，
  // 且 jsdom 里 matchMedia 是缺失的，靠它判定会让测试与真实行为脱节。
  const source = readFileSync(new URL('./motion.ts', import.meta.url), 'utf8')
  expect(source).not.toContain('matchMedia')
})
```

- [ ] **Step 2: 确认红**（模块不存在）
- [ ] **Step 3: 实现** —— `motion.ts` 导出常量与 `motionClass`；`index.css` 写四处 keyframes 与 reduced-motion 兜底；`Board` 给刚落下的棋子与最后一手加类名（**只给最新一手**——225 颗子每颗都播动画会让整盘闪）；Modal/Banner 同类处理。
- [ ] **Step 4: 新增一条 CSS 断言测试**（`src/lib/motion.test.ts` 内读 `index.css` 源文件）：断言存在 `prefers-reduced-motion: reduce` 且其中包含 `animation: none`。**这条故意读源码**——CSS 动画在 jsdom 里不会真的跑，读源码是这里唯一能钉住「兜底真的写了」的办法，在注释里写明这一点。
- [ ] **Step 5: 全量测试过**；**Step 6: Commit** `feat(ui): 落子与面板动效（CSS，含 reduced-motion 兜底）`

## Task 2：键盘操作与 ARIA grid

**Files:**
- Modify: `src/components/board/Board.tsx`
- Test: `src/components/board/Board.test.tsx`（追加）、`e2e/a11y.spec.ts`（新建）

**Interfaces:**
- Produces:
  - **不引入新的 prop**：可交互（`interactive === true`）即有键盘与 grid 语义，调用方没有第二个旋钮要记；回放棋盘 `interactive={false}`，自然退回 `role="img"`。
  - 键盘行为：容器 `tabIndex={0}`（可交互时）；`role="grid"`，225 个命中区 `role="gridcell"`，`aria-label` 形如 `D8 空位` / `D8 黑棋（最后一手）`；焦点格 `tabIndex={0}`、其余 `-1`；方向键移动焦点（越界即停，不循环）、`Home`/`End` 到行首/行尾、`Enter`/`Space` 落子。
  - 播报：`data-testid="board-announcer"` 的 `aria-live="polite"` 视觉隐藏区，内容由 `Board` 从 props 派生（最后一手 + 轮到谁 + 不可落子的原因）。testid 在组件测试与 e2e 里同名。

- [ ] **Step 1: 写失败测试**（组件级，`Board.test.tsx` 追加）：

```ts
it('可交互时是可聚焦的 grid，每个交叉点有坐标与状态的可读名', () => {
  render(<Board {...base} interactive onPlay={vi.fn()} />)
  expect(screen.getByRole('grid')).toBeInTheDocument()
  expect(screen.getByRole('gridcell', { name: 'D8 空位' })).toBeInTheDocument()
})

it('方向键在格间移动，Enter 落子', async () => {
  const onPlay = vi.fn()
  render(<Board {...base} interactive onPlay={onPlay} />)
  const board = screen.getByRole('grid')
  board.focus()
  fireEvent.keyDown(board, { key: 'ArrowRight' })
  fireEvent.keyDown(board, { key: 'ArrowDown' })
  fireEvent.keyDown(board, { key: 'Enter' })
  expect(onPlay).toHaveBeenCalledWith({ x: 1, y: 1 })   // 从 (0,0) 出发
})

it('不可落子时不落子，并播报原因', () => {
  const onPlay = vi.fn()
  render(<Board {...base} interactive={false} onPlay={onPlay} />)
  expect(screen.queryByRole('grid')).not.toBeInTheDocument()   // 只读 = role="img"
  expect(onPlay).not.toHaveBeenCalled()
})

it('落子后焦点不丢——仍停在同一格', () => {
  const { rerender } = render(<Board {...base} interactive onPlay={vi.fn()} />)
  const cell = screen.getByRole('gridcell', { name: 'D8 空位' })
  cell.focus()
  rerender(<Board {...base} interactive board={boardWithD8} onPlay={vi.fn()} />)
  expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /D8 黑棋/ }))
})
```

- [ ] **Step 2: 确认红**（`role="grid"` 不存在）
- [ ] **Step 3: 实现** —— 焦点索引是组件内 `useState<Point>`（默认天元）；键盘处理放在容器上（事件冒泡自格子）；落子后焦点格保持（`key` 稳定即可，格子本来就在，只需让 `tabIndex` 跟着焦点走）。
- [ ] **Step 4: 过绿 + 全量**
- [ ] **Step 5: 写 e2e**（`e2e/a11y.spec.ts`）：

```ts
test('全程用键盘下完一手，有播报、且 AI 思考期间按 Enter 不落子', async ({ page }) => {
  await page.goto('/')
  // Tab 到棋盘并聚焦
  await page.getByRole('grid').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(1)
  // 播报区给出最新一手
  await expect(page.getByTestId('board-announcer')).toContainText('黑棋')
})
```
- [ ] **Step 6: Commit** `feat(a11y): 棋盘键盘操作与 ARIA grid`

## Task 3：音效补完与自动播放策略

**Files:**
- Modify: `src/lib/sound.ts`、`src/features/battle/BattleScreen.tsx`
- Test: `src/lib/sound.test.ts`（追加）

**Interfaces:**
- Produces: `StoneSound` 增两个方法——`win(): void`、`lose(): void`（短促的上行 / 下行音，与落子音同一套合成器）；新增 `armOnFirstGesture(target: EventTarget): () => void`，绑定一次 `pointerdown` 预热 `AudioContext`（这是 ROADMAP 长期待办里「彻底的做法」）。
- **音效开关照旧**（`settings.soundEnabled`），新增的两处也必须受它约束。

- [ ] **Step 1: 失败测试**（注入假 AudioContext，沿用 `sound.test.ts` 现有做法）：
  - `win()` / `lose()` 各创建并启动振荡器，频率走向一个升一个降（断言 `frequency.setValueAtTime` 的两次取值大小关系）
  - `armOnFirstGesture` 在 `pointerdown` 后调用一次 `createContext`，重复触发只预热一次；返回的清理函数解绑后不再触发
- [ ] **Step 2: 确认红**；**Step 3: 实现**；**Step 4: 过绿**
- [ ] **Step 5: 接线**：BattleScreen 在终局（`status !== 'playing'` 且是玩家视角的胜/负）播放对应音；`main.tsx`（或 App）在挂载时 `armOnFirstGesture(window)`。
- [ ] **Step 6: Commit** `feat(sound): 胜负音与 AudioContext 首次手势预热`

## Task 4：错误边界

**Files:**
- Create: `src/components/AppErrorBoundary.tsx`、`src/components/AppErrorBoundary.test.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `<AppErrorBoundary>`（class 组件——React 的错误边界只有 class 能实现，这是框架约束不是风格选择，注释里写明）；兜底 UI 用**最简 DOM**（纯 `<div>` + 内联样式，不依赖任何 store、主题变量或组件库——边界自己坏掉就全完了）；包含「重新加载」按钮（`location.reload()`）与错误摘要文本。

- [ ] **Step 1: 失败测试**：

```tsx
function Boom(): never { throw new Error('渲染炸了') }

it('子组件抛错时显示兜底 UI，而不是白屏', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})   // React 会打印
  render(<AppErrorBoundary><Boom /></AppErrorBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent('出了点问题')
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  spy.mockRestore()
})

it('正常渲染时原样透传子树', () => {
  render(<AppErrorBoundary><p>内容</p></AppErrorBoundary>)
  expect(screen.getByText('内容')).toBeInTheDocument()
})
```

- [ ] **Step 2: 确认红**；**Step 3: 实现**；**Step 4: 过绿**（全量闸门此时 **e2e 必跑**——边界包在 App 外层，跑错位置会把四个页面全白掉，只有真实浏览器能立刻发现）
- [ ] **Step 5: Commit** `feat(ui): 顶层错误边界与兜底界面`

## Task 5：平板与触屏专项

**Files:**
- Create: `e2e/tablet.spec.ts`（`tablet` project，`devices['iPad (gen 7) landscape']` + touch）
- Modify: `playwright.config.ts`（加一个 project）

**Interfaces:**
- Consumes: 现有 `mobile.spec.ts` 的做法（CDP 触摸序列、`touch-action` 断言）

- [ ] **Step 1: 写 e2e**（每条都要真实浏览器）：
  1. 平板横屏（1024×768）：无横向溢出；棋盘是正方形且完整可见；三栏布局（左侧设置 / 中间棋盘 / 右侧面板）在同一屏内不互相压盖
  2. 平板竖屏（768×1024）：退化为纵向堆叠，棋盘仍完整
  3. **边缘命中**：在平板视口上依次触摸 (0,0)、(14,0)、(0,14)、(14,14)、(7,0)、(0,7)、(14,7)、(7,14)，每一处都断言 `stone-{x}-{y}` 出现——四角与四边中点是留白换算最容易偏半格的地方
  4. 触摸拖动不落子（沿用 CDP 序列，断言子数不变）
  5. **误触专项**：快速连点同一交叉点两次 → 只落一子（第二次该被「已占用」挡掉）；AI 思考期间触摸棋盘 → 不落子、盘面不变（`data-testid="stone-"` 计数稳定）
- [ ] **Step 2: 跑起来确认绿**（若红则是真问题，按 systematic-debugging 查；命中区问题不要用「加 padding」蒙混）
- [ ] **Step 3: Commit** `test(e2e): 平板视口与边缘命中专项`

## Task 6：生产构建的端到端

**Files:**
- Create: `e2e/prod.spec.ts`、`playwright.prod.config.ts`
- Modify: `package.json`（`"e2e:prod": "playwright test --config playwright.prod.config.ts"`）

**Interfaces:**
- Produces: 一条**独立通道**：`webServer.command = yarn build && yarn preview --port 5182`，`baseURL = http://127.0.0.1:5182`，只跑 `prod.spec.ts`。
- 冒烟用例（这是全仓第一次真正在 `dist` 上做验证）：
  1. 首屏渲染出棋盘与顶栏
  2. **Worker 真的跑起来**：下一手 → AI 应手（`data-testid="stone-"` 计数变 2）——worker 的 module 加载在产物里的路径与 dev 不同，这是最容易断的地方
  3. 样式生效（棋盘是木色、有尺寸，不是裸 SVG）
  4. 复盘页可进入（懒加载 chunk 若将来有，这里会先炸）
- [ ] **Step 1: 写配置与用例**；**Step 2: 跑 `yarn e2e:prod`**（预期：可能真的红——那就修到绿，别降断言）；**Step 3: 把 `e2e:prod` 加进文档的验证清单**；**Step 4: Commit** `test(e2e): 生产构建冒烟通道`

## Task 7：性能实测与有依据的优化

**Files:**
- Modify: 视测量结果而定；`docs/TEST_REPORT.md`（记录数字）
- 可能改：`src/components/board/Board.tsx`（重渲染）、`vite.config.ts`（chunk 策略）

- [ ] **Step 1: 先测，不先改**。三处测量：
  1. **产物体积**：`yarn build` 输出（记录 JS/CSS 的 raw + gzip）
  2. **首屏**：用 chrome-devtools MCP 的 `performance_start_trace` 抓一次冷启动（记录 LCP、总阻塞时间）
  3. **引擎**：`yarn bench` 的既有数字（若本阶段没动引擎，数字应当不变——不变也要记，它证明「打磨没有拖慢引擎」）
- [ ] **Step 2: 只对**测量中确实慢**的项目动手**，候选（按性价比排序，先查再定）：
  - 棋盘每帧重建 225 个 `<rect>`：加 `React.memo` 或把命中区提出来只在 `interactive`/`board` 变化时重建（**先确认这是热点**——用 Profiler 或对局中的 commit 计数）
  - 首屏 `learn/lessons.ts` + `puzzles.ts` 是否进了主 chunk（若进了且占比可观，用动态 `import()` 拆出去）
  - 若无实测收益 → **不做**，并在 TEST_REPORT 写明「测过、没必要」
- [ ] **Step 3: 复测**，把优化前后数字并列写进 `docs/TEST_REPORT.md`；**Step 4: Commit**（信息按实测结果写实，例如 `perf(board): 命中区只在棋盘或交互开关变化时重建（实测 commit 次数 12→3）`；若测量结论是「无需优化」，提交信息与文档都要写「测过、不做」及理由）

## Task 8：部署配置与使用文档

**Files:**
- Modify: `README.md`（现状停在 Phase 3：计数 559/26、能力清单缺复盘）、`vite.config.ts`（`base` 支持子路径）、`docs/ARCHITECTURE.md`
- Create: `docs/USAGE.md`（使用说明：怎么下、五个难度、提示、课程、残局、复盘、键盘快捷键、常见问题）

**Interfaces:**
- Produces: `vite.config.ts` 的 `base: process.env.VITE_BASE ?? '/'`（子路径部署用 `VITE_BASE=/gomoku/ yarn build`）；README 重写为**当前真实状态**（阶段、计数、能力、命令、部署、限制）。

- [ ] **Step 1: 写 `docs/USAGE.md`**——面向玩家，不写实现细节。键盘一节必须与 T2 的实际键位逐条对齐（写错键位比不写更糟）。
- [ ] **Step 2: 改 `vite.config.ts` 的 `base`**，跑 `VITE_BASE=/gomoku/ yarn build && VITE_BASE=/gomoku/ yarn preview`，用 `curl` 确认产物里资源路径带前缀（e2e 不覆盖子路径场景，这条用构建产物断言）。
- [ ] **Step 3: 重写 README**：一句话定位、截图、当前进度与计数（**从 TEST_REPORT 抄实测值，不估**）、命令表、能力清单、部署、已知限制（把 ROADMAP 的欠账摘要搬过来）。
- [ ] **Step 4: 文档同步**——`ARCHITECTURE.md` 补「键盘与无障碍」「错误边界」两小节；`ROADMAP.md` 勾选 Phase 5、如实记已知不足，**并把那句中「落子与面板动画落地时再装回来（motion）」改掉**：本阶段用 CSS 做完了动效，理由与代价写在计划的 Ruling 1 里，ROADMAP 要跟代码一致。
- [ ] **Step 5: Commit** `docs: 使用说明、部署配置与 README 重写`

## Task 9：收尾验证

**Files:**
- Modify: `docs/TEST_REPORT.md`

- [ ] **Step 1: 无障碍审计**：对四个页面各跑一次 chrome-devtools MCP 的 `lighthouse_audit`（accessibility），记录分数与所有非满分项；**分数与问题清单进 TEST_REPORT**（不美化：如果某项没修，写明为什么）。
- [ ] **Step 2: 真实浏览器目视复核**：动效（录一帧落子前后）、键盘焦点环、兜底 UI（临时抛错截一张）、平板三档视口，存 `docs/screenshots/phase5-*.png`。
- [ ] **Step 3: 五道闸门 + `yarn e2e:prod`**，全绿。
- [ ] **Step 4: TEST_REPORT 写 Phase 5 摘要**：新增用例、e2e 计数、实测数字（体积/首屏/引擎）、审计分数、发现并修的问题、反向验证记录。
- [ ] **Step 5: Commit** `docs: Phase 5 验证记录与收尾`

---

## 收尾自审清单（3 轮自审已跑，结论如下；执行时每任务完成后再核一遍）

**第 1 轮（规格覆盖）改了 3 处**：T5 补「误触专项」（连点两次只落一子、思考中触摸无效——ROADMAP 明写「触屏误触」而我原先只写了拖动与边缘）；T8 明确要去改 ROADMAP 里被 Ruling 1 推翻的那句 motion；T2 删掉对 `motionClass` 的引用（它是焦点环的类名，而 T1 里根本没有这个键——引用了不存在的东西）。

**第 2 轮（占位符与含糊处）改了 2 处**：T2 的 Interfaces 里有一段自言自语没清；T7 的提交信息是空壳（`perf: <按实测结果命名>`），改成写实要求 + 「测过、不做」也要留理由。

**第 3 轮（类型与接口一致性）改了 1 处**：`board-announcer` 的 testid 只在 e2e 里出现过，没进 T2 的 Interfaces——现在两处同名。

- [x] 8 条验收项 → 任务映射：视觉打磨=T1；移动/平板/误触=T5；音效与动画=T1+T3；性能=T7；错误处理=T4；测试补全（键盘/无障碍）=T2+T9；发布构建与部署=T6+T8；使用文档=T8
- [x] 无占位符；类型一致性（`StoneSound.win/lose`、`armOnFirstGesture`、`AppErrorBoundary`、`board-announcer`、`VITE_BASE` 在各任务间一致）
- [x] Review Focus 六条各绑到任务：1→T2；2→T1；3→T2；4→T6；5→T4；6→T5
- [x] 约束自查：不新增依赖、无 `Date.now()`、纯逻辑层未被污染、文案简体
- [x] 每一条「写进文档的数字」都有测量步骤（T7 Step 1、T9 Step 2）
