# 测试缺口（Phase C）

> **归档文件（审计快照）**：与同目录的 `FINDINGS.md` 是同一批产物，审计对象是 HEAD `4987c33`。
> 内容停在那一刻——**不是当前状态**；文中的「新增」「待办」都是当时的设计分析。

范围：`src/**/*.test.ts(x)`（43 个文件 / 767 个用例）、`e2e/*.spec.ts`（7 个 spec / **49 条静态用例**，其中 `yarn e2e` 执行 **44 条**、`yarn e2e:prod` 另执行 5 条——见 §2 的订正说明）、`src/test/setup.ts`、`bench/`、以及 vitest / playwright 配置。

**先说结论：这套测试的鉴别力明显高于同类项目。** 全仓**零** `vi.mock`、**零** `.skip` / `.only` / `.todo` / `.fails`、**零** `Math.random`、**零** `|| true`、`src/test/setup.ts` 只有 7 行且不做任何全局放宽。下面列出的缺口都是**真实且具体**的，但整体基调是「补几处边角」，不是「测试不可信」。

---

## 1. 规模与分布（本轮实跑）

```
yarn test  →  Test Files 43 passed (43)   Tests 767 passed (767)   69.45s
yarn e2e   →  44 passed (chrome 18 / mobile 8 / tablet 12)        1.5m
```

| 目录 | 文件 | 用例 |
| --- | --- | --- |
| `src/ai` | 9 | 163 |
| `src/store` | 5 | 135 |
| `src/lib` | 6 | 90 |
| `src/core` | 3 | 83 |
| `src/learn` | 5 | 69 |
| `src/persist` | 3 | 58 |
| `src/components/board` | 1 | 39 |
| `src/components/panels` | 3 | 34 |
| `src/features/learn` | 2 | 33 |
| `src/features/battle` | 3 | 27 |
| `src/analysis` | 1 | 17 |
| `src/features/review` | 1 | 14 |
| `src/components`（错误边界） | 1 | 5 |
| **合计** | **43** | **767** |

静态 grep `^\s*(it|test)(\.\w+)?\(` 得 685 处，差额 82 全部来自 `it.each` / `describe.each` 的展开（`contrast.test.tsx` +51、`board.test.ts` +11、`storage.test.ts` +10、`rules.test.ts` +7、`HintPanel.test.tsx` +2、`screens.test.tsx` +1）。**差额已解释清楚，不存在「用例数虚报」。**

**覆盖率工具未安装**：`@vitest/coverage-*` 不在 `package.json` 也不在 `node_modules`。因此本文件的所有缺口结论**全部由读代码得出**，不是覆盖率报告。

---

## 2. e2e 的真实覆盖面

`yarn e2e` 跑的是 `chrome` / `mobile` / `tablet` 三个 project 能匹配到的部分（`playwright.config.ts:22,28,36`），共 **44 条**。

> **本节数字于独立终审后订正。** 初稿写的 per-spec 条数（a11y 13 / battle 13 / learn 9 / mobile 8 / review 7 / tablet 12 / prod 5，合计 67）**是错的**——那是我照抄了一份未经核实的子代理报告，自己没有数。订正后（本轮用 `npx playwright test --list` 亲自重数）：

| project | 实际执行条数 | 组成 |
| --- | --- | --- |
| `chrome` | **30** | `a11y` 6 + `battle` 12 + `learn` 8 + `review` 4 |
| `mobile` | **7** | `mobile.spec.ts` |
| `tablet` | **7** | `tablet.spec.ts` |
| **`yarn e2e` 合计** | **44** | 与实跑的「44 passed」一致 ✓ |

**这条订正保留在这里而不是悄悄改掉**——它同时说明了两件事：本次审计的量化结论**经过了独立复核**，以及「子代理的数字必须自己数一遍」这个方法纪律不是形式。

`e2e/prod.spec.ts` 的 5 条**不在其中**，只在 `yarn e2e:prod` 下运行（`playwright.prod.config.ts:27`）。

| spec | 条数 | 断言性质 |
| --- | --- | --- |
| `e2e/a11y.spec.ts` | **6** | 真实浏览器语义：`reduced-motion` 下 `animation-name: none` + 对照组、恰有 1 个 `role="status"`、键盘落子后播报「最后一手在 I8」、焦点环 `boundingBox` 落在格宽 0.8–1.4 倍、真按 Tab 进盘后 AI 思考期间 `gridcell` 数归零 |
| `e2e/battle.spec.ts` | **12** | 真实交互：落子位置、悔棋、重开、刷新恢复、认输后不复活、双人模式、提示标记的出现与消失、**专家档深算期间悔棋后迟到响应不补子** |
| `e2e/tablet.spec.ts` | **7** | 真实几何与触摸：三栏不压盖（按 x 排序后首尾相接、垂直区间真重叠）、四角与四边中点偏移 0.3 格仍命中、拖动不落子、连点只落一子 |
| `e2e/learn.spec.ts` | **8** | 真实交互：做对/做错/锁盘/重试、三级提示的揭示节奏、进度刷新后仍在、六个分类标题 |
| `e2e/mobile.spec.ts` | **7** | 真实 CDP 触摸：无横向溢出、拖动不滚页面（**先断言页面本身可滚**）、触摸落点正确 |
| `e2e/review.spec.ts` | **4** | 真实交互：入库→列表、回放步进与自动播放、**切走 2500ms 再回来游标仍在 0/9**（验无遗留定时器）、分析跑完并标注出处 |
| `e2e/prod.spec.ts` | **5** | 跑 `dist` 产物；其中 2 条只是页面加载级别 |

**e2e 的覆盖面是扎实的**，尤其「触摸命中」「拖动不滚页面」「焦点环只占一格」「AI 思考期间键盘进不去」这四条，都是 jsdom 抓不到、只能在真实浏览器里成立的约束——与 `AGENTS.md:31` 的要求一致。

### 2.1 e2e 的重复（3 处）

| 重复 | 位置 |
| --- | --- |
| 9 手终局 helper 逐字两份 | `e2e/review.spec.ts:19-28` ↔ `e2e/prod.spec.ts:52-57` |
| 「拖动不滚页面」三条 | `e2e/mobile.spec.ts:40-74`、`e2e/mobile.spec.ts:138-185`、`e2e/tablet.spec.ts:189-207` |
| 「AI 思考期间拒绝输入」两条 | `e2e/a11y.spec.ts:128-135`（键盘）↔ `e2e/tablet.spec.ts:230-253`（触摸） |
| `beforeEach` 的存档清理 5 份且**不一致** | `battle.spec.ts:9-16` 与 `mobile.spec.ts:10-17` 只清 localStorage；`a11y.spec.ts:19-26`、`learn.spec.ts:8-15`、`review.spec.ts:9-16` 额外 `indexedDB.deleteDatabase('gomoku-lab')` |

最后一处**不一致是真实的**：`battle.spec.ts` 不清 IndexedDB，如果同一轮里 `review.spec.ts` 先跑过并留下棋谱，`battle` 的用例看不到影响（它不读棋谱库），所以今天不炸；但这是一条**依赖「用例互不干扰」的隐含假设**，而三个 project 是 `fullyParallel: true`。

---

## 3. 鉴别力可疑的断言

### 3.1 只检查「没有抛异常」（8 处）

| 位置 | 断言 | 判断 |
| --- | --- | --- |
| `src/learn/lessons.test.ts:61` | `expect(() => parseBoardLines(step.board!.lines)).not.toThrow()` | **弱**：不校验解析结果（行数、格子取值）。不过 `content.test.ts` 会逐个跑求解器，实际兜住了 |
| `src/ai/patterns.test.ts:288-289` | 四角场景 `analyzePoint` / `analyzeFast` 不抛 | **可接受**：用例名就是「四角不崩」，且本轮独立验证覆盖了全部边界点 |
| `src/ai/patterns.test.ts:312-313` | 接近满盘不崩 | 同上 |
| `src/ai/threat.test.ts:102` | `findForcedWin(almostFull, …)` 不抛 | **弱**：用例名是「不越界、不死循环」，但「不死循环」没被断言（只断言了不抛）。超时路径会返回 `NO_WIN`，永远不抛 |
| `src/lib/sound.test.ts:42,125,126,193` | `not.toThrow()` | **可接受**：`sound.ts` 的契约就是静默降级 |
| `src/store/gameStore.test.ts:1067` | `expect(() => playToWin(s)).not.toThrow()` | **可接受**：紧随其后的 `:1068` 有真实断言 |

### 3.2 恒真或近乎恒真的断言（3 处）

| 位置 | 断言 | 问题 |
| --- | --- | --- |
| `src/ai/search.test.ts:223` | `expect(result.elapsedMs).toBeGreaterThanOrEqual(0)` | **恒真**（耗时不可能为负）。同用例 `:224` 的 `nodes > 0` 才是有效断言 |
| `src/persist/progress.test.ts:136` | `expect(indexedDbProgress).toBeDefined()` | **恒真**（import 成功即成立）。同用例 `:137` 的 `resolves.toEqual(EMPTY_PROGRESS)` 才有效 |
| `src/features/learn/PracticeBoard.test.tsx:74` | `expect(feedback.textContent!.length).toBeGreaterThan(6)` | **近乎恒真**：只查长度不查内容，而判题理由的内容才是这一层的价值 |

### 3.3 只查存在性 / 只查类名子串（4 处）

| 位置 | 断言 |
| --- | --- |
| `src/learn/puzzles.test.ts:21` | `expect(CATEGORY_LABELS[category]).toBeTruthy()` |
| `src/ai/difficulty.test.ts:71` | `expect(DIFFICULTY_LABELS[difficulty]).toBeTruthy()` |
| `src/components/panels/HintPanel.test.tsx:173` | `expect(...className).toContain(tone)`（`toContain('accent')` 对 `accent-soft` 也成立） |
| `src/features/review/review.test.tsx:76` | `expect(within(item).getByText(/人机\|双人/))` —— 正则两支取或，**无法区分模式** |
| `src/store/gameStore.test.ts:1016` | `moves: expect.any(Array)` —— 回调入参只校验类型不校验内容 |

### 3.4 `toHaveBeenCalled` 但不校验参数（11 处）

全部落在 `src/lib/sound.test.ts`（`:51,54,55,76,97,137,158,159,172,173`）与 `src/components/panels/AiPanel.test.tsx:97`（`onDismissError`，无参回调）。
`sound.test.ts` 里被调用的 `frequency.setValueAtTime` **确实有参数**且值在 `:61-67` 另行校验，所以整体是**可接受**的；只是这些点的参数校验与调用校验分居两处，读起来要多跳一次。

### 3.5 结构断言（不算缺陷，记录备查）

`src/components/board/Board.test.tsx:264,297-299,317` 断言 SVG 的 `r` / `font-size` 数值与坐标标签数量恰为 60；`src/lib/contrast.test.tsx` 整个文件断言 CSS 令牌值与算出的对比度。**这些是有意的**——前者锁住「编号徽标必须比棋子小」这条视觉约束，后者是主题配色的守卫（`ARCHITECTURE.md` 的「配色有对比度守卫」一节说明了理由）。

---

## 4. 可能 flaky 的用例

### 4.1 依赖真实时钟（5 个文件）

| 位置 | 情况 | 风险 |
| --- | --- | --- |
| `src/learn/hints.test.ts:11` | `const NOW = Date.now`，而 `hints.ts:12` 的算杀预算是 3000 ms | 3000 ms 内没算完 → `solveMove` 返回 null → 用例红。**本轮实测最坏 33.6 ms**（见 `FINDINGS.md` §5.6），余量约 90 倍。**可接受** |
| `src/learn/verify.test.ts:9` | 同上（`JUDGE_THREAT_BUDGET_MS = 2000`） | 本轮实测 `judgeMove` 最坏 8.0 ms，余量 250 倍。可接受 |
| `src/learn/content.test.ts:24` | 同上，且对**全部**题库逐题调用 | 同上 |
| `src/learn/lessons.test.ts:7` | 同上 | 同上 |
| `src/ai/difficulty.test.ts:22` | `budgetMs: 30_000`，且 `ask()` 走 `chooseMove` 的**真实时钟**（`search.ts:551,561,574`） | 32 核慢机器 / 高负载 CI 上 30 s 可能不够。**这是本清单里风险最高的一条** |
| `src/ai/search.test.ts:221-223` | 真实时钟，但断言的是恒真的 `elapsedMs >= 0` | 无风险（因为断言无效） |

**反例（证明项目知道怎么做）**：`src/ai/selfplay.test.ts:14` `const CLOCK = () => 0`、`search.test.ts:251,311-314,325` 注入时钟、`replayStore.test.ts:166-171` 与 `review.test.tsx:136-152` 用 fake timers 且 try/finally 还原。**注入时钟的机制是现成的，只是没有全部用上。**

### 4.2 固定等待（3 处）

`e2e/battle.spec.ts:212` `waitForTimeout(3500)`、`e2e/review.spec.ts:79` `waitForTimeout(2500)`、`:85` `waitForTimeout(2000)`。

另外两处**靠时序竞态窗口成立**，且作者自己在注释里写明了：
- `e2e/a11y.spec.ts:97-100`：「专家档的时间预算是 2600 ms……断言期间 AI 不会插进来」
- `e2e/tablet.spec.ts:233-234`：同一手法

本轮 44 条一次全绿。**风险级别：低—中**（本机空闲时稳；CI 慢机器上第一条最可能先红）。

### 4.3 长超时（会被慢 CI 放大）

`e2e/review.spec.ts:54`（60 s）、`:105`（90 s）；`src/ai/selfplay.test.ts:94,102,110`（120 s）、`:123,134,155`（300 s）。
`yarn test` 的 69 s 总时长主要由这几条贡献。

### 4.4 共享可变全局状态

| 位置 | 状态 | 是否还原 |
| --- | --- | --- |
| `src/persist/gameRecords.ts:198`（模块级 `factory`）、`:209`（模块级 `memoryFallback`） | 降级用例把 `memoryFallback` 填上后**没有清理**（清理只发生在 `__setGameRecordsIndexedDbFactory` 里） | **否** —— 存在用例顺序依赖的残留 |
| `src/features/battle/BattleScreen.test.tsx:14-20` | `vi.hoisted` 里全局替换 `Worker` | **否** |
| `src/store/settingsStore.test.ts:18` | 覆盖 `window.matchMedia` | **否**（同文件每个用例自行重设） |
| `src/features/battle/BattleScreen.test.tsx:54,62`、`src/features/learn/screens.test.tsx:11` | 直接改写真实单例 `useGameStore` / `useLearnStore` | 依赖 vitest 的按文件隔离 |
| `src/store/requestCounter.ts:9` | 模块级只增计数器 | **有意**：`gameStore.test.ts` 与 `analysisStore.test.ts:863-875` 都依赖它的单调性 |

`src/components/AppErrorBoundary.test.tsx:9-12` 用 `vi.spyOn(console, 'error')`，**逐用例 `mockRestore()`**（`:63,76,103,138`）——做法是对的，但若将来新增分支漏调，抑制会泄漏到同文件后续用例。

### 4.5 真实 `setTimeout` 做 flush（2 处）

`src/store/gameStore.test.ts:17`、`src/store/learnStore.test.ts:37`：`new Promise((resolve) => setTimeout(resolve, 0))`。这是确定性的宏任务排空，**不 flaky**，记录备查。

### 4.6 随机性

全仓 `Math.random` **零命中**（只有 `transposition.ts:16,19` 的注释在解释为什么不用它）。**无随机性来源。**

---

## 5. 覆盖缺口（读代码确认「重要但零覆盖」）

### 5.1 生产代码里的错误分支（**最值得补的一类**）

| 位置 | 分支 | 状态 |
| --- | --- | --- |
| `src/store/gameStore.ts:415-421` | AI 返回**非法着法**（越界 / 已占用）→ 写 `aiError: 'AI 返回了不合法的着法，已忽略'` | **零覆盖**。`gameStore.test.ts:239-247` 只测了 `move === null` 那一路。grep `不合法的着法` 只命中源码本身 |
| `src/ai/engine.ts:58` | `handleError('')` → 兜底成 `'AI 引擎异常'` | **零覆盖**。`engine.test.ts:110` 只传了非空 `'引擎崩溃'` |
| `src/persist/gameRecords.ts:241` | `request.onerror` → `new Error('打不开棋谱库')` | **零覆盖**。`progress.ts` 有等价用例（`progress.test.ts:120-131`），`gameRecords` 没有 |
| `src/persist/gameRecords.ts:242`、`src/persist/progress.ts:92` | `onblocked` → 「被其他标签页占用」 | **零覆盖**（grep 只命中源码） |
| `src/persist/gameRecords.ts:265-268` | `withStore` 的 `request.onerror` → 「棋谱库读写失败」 | **零覆盖** |
| `src/features/review/GameLibrary.tsx:35-37` | `storage.list()` **reject** → `setRecords([])` | **零覆盖**。`review.test.tsx:47-79` 全部注入 `memoryGameRecords()`，它的 `list()` 恒 resolve |
| `src/ai/browserEngine.ts:9-25` | 整个函数：Worker 构造、`message` → `handleResponse`、**`error` → `handleError(event.message)`** | **零覆盖**，全仓无引用 |
| `src/ai/worker.ts:17-21` | Worker 入口 | **零覆盖** |

**为什么这一类最重要**：这些都是「出错时才走」的路径，而它们的**唯一价值就是出错时**。`browserEngine` 的 `error` 接线尤其关键——如果它接错了，AI 卡住时界面不会有任何提示（`ARCHITECTURE.md` 专门解释了「引擎失败不能让对局卡死」这条约定）。

### 5.2 复盘分析管线

排队、串行、取消、缓存命中、跨 run 迟到响应**都有覆盖**（`analysisStore.test.ts:104-166,167-219,221-242,280-311,312-340`）。未覆盖：

| 位置 | 说明 |
| --- | --- |
| ~~`src/store/analysisStore.ts:92-101`~~ | **本条已撤回。** 独立终审与我自己复核后发现 **`analysisStore.test.ts:325` 已有专门的 describe「分析管线 —— 满盘和棋（无可走点）」**，直接断言了 `verdicts.size === 7` / `total === 8` / 手 7 与手 8 都不进结论。**误报原因**：我只 grep 了 `move === null` 与源码，没有先扫一遍已有的 describe 名称 |
| `src/store/analysisStore.ts:203-205` | `patch` 之后走 `emit` 的路径无独立用例 |
| `src/store/analysisStore.ts:18,61` | `ANALYSIS_BUDGET_MS` 作为闭包初值从未被真正使用（F-06） |

### 5.3 存档恢复链路

| 位置 | 说明 |
| --- | --- |
| `src/store/useGameStore.ts:35-51` `bootstrapStore()` | **全仓零引用**（grep 只有 `main.tsx:6` 与定义处）。它同时包含 `restore(loadSession())` 与 `useGameStore.subscribe(...)` 的自动存档。e2e 覆盖了「刷新恢复」（`battle.spec.ts:80,107`），但**自动写入**这一半没有直接断言 |

### 5.4 棋盘以外的组件接线

| 位置 | 说明 |
| --- | --- |
| `src/components/panels/SettingsPanel.tsx` | **无独立测试文件**，且 `BattleScreen.test.tsx` 的 9 条用例**全部**在 `describe('BattleScreen —— 终局音效')`（`:70`）下，一次都没碰设置面板。`onThemeChange` / `onShowCoordsChange` / `onSoundEnabledChange` / `onHumanColorChange` / `onModeChange` / `onDifficultyChange` 六个回调的接线只在 e2e 里被间接点过 |
| `src/components/ui/Modal.tsx:22-26` | Escape → `onClose`。grep `Escape` 全仓只命中源码本身。**同时见 `FINDINGS.md` F-02**（焦点陷阱与焦点还原也零覆盖） |
| `src/components/panels/MoveList.tsx:43` | 手数变化后 `scrollTop = scrollHeight` |
| `src/components/ui/Segmented.tsx` / `Switch.tsx` / `Panel.tsx`、`panels/ControlBar.tsx` / `MoveList.tsx` / `StatusPill.tsx` / `StoneDot.tsx`、`board/BoardStage.tsx`、`panels/FeedbackBanner.tsx` | 无独立测试文件，仅通过上级组件间接渲染 |

**对 5.4 的判断**：这一类的边际收益**低于** 5.1。这些组件要么是纯展示（`Panel` / `StoneDot` / `StatusPill`），要么已经被 e2e 从真实用户路径覆盖（设置面板的四个开关在 `battle.spec.ts:145,174` 与 `a11y.spec.ts:97,100` 被点过）。**除了 `Modal` 之外不建议补。**

### 5.5 未覆盖的不变量（本轮独立发现）

| 不变量 | 现状 |
| --- | --- |
| 「`analyzeFast` / `isWinningPoint` 只对空点调用」 | **零断言**。这是一条隐式前置条件（`FINDINGS.md` F-15）——对已占用的点调用会得到「假如这里是空的」的答案 |
| 「`findWinLine` 返回的是**极大**连续段」 | 现有测试覆盖了长连返回 6 枚，但**没有**断言「两端再外一格不能还是己方子」。本轮独立验证补上了这一条（5000+ 局面） |
| 「`replay` 的 `version === moves.length`」 | 由 `ai` 层的过期闸门依赖，但**没有专门断言**。本轮独立验证覆盖 |
| 「三类请求的 `requestId` 全局不重复」 | `analysisStore.test.ts:863-875` 断言了计数器的单调性，但没有断言「落子/提示/分析三者之间不撞号」 |
| 「`Goal maxPlies` 是上界而非紧界」（F-14 的偶数语义） | 零覆盖 |

---

## 6. `src/test/setup.ts` 与 fixtures

**`src/test/setup.ts` 全文 7 行**：引入 `@testing-library/jest-dom/vitest` + `afterEach(cleanup)`。

**未发现**：全局吞 `console.error`、全局假时钟、全局 `matchMedia` / `ResizeObserver` / `requestAnimationFrame` 桩（grep 三者全仓只命中 `MoveList.tsx:43` 的 `scrollTop`，无关）。
`vite.config.ts:15` 的 `css: true` 是为 `contrast.test.tsx` 读 `index.css?raw` 而开，属**真实配置**而非放宽。

**`src/test/board-fixtures.ts`（52 行）**：转发 `parseBoardLines` / `formatBoardLines`（生产代码，注释说明「不引入只测试用的解析器」）+ `nearlyFullBoard()`。**未发现任何全局行为放宽。**

> 这一节是**否定性结论**，但值得写明：项目里**没有**「为了过测而放宽全局行为」的做法。这在本轮审计里是一个重要的正面发现。

---

## 7. 建议的补测优先级

按「覆盖的是出错路径 × 补测成本」排：

| 优先级 | 项 | 成本 |
| --- | --- | --- |
| 1 | `gameStore.ts:415-421`（AI 返回非法着法） | 低——现有 `FakeEngine` 直接喂一个非法坐标即可 |
| 2 | `engine.ts:58`（`handleError('')` 兜底） | 极低 |
| 3 | `GameLibrary` 的 `list()` reject 降级 | 低——注入一个会 reject 的假存储 |
| 4 | `analysisStore` 的「满盘跳过末手」+ `total` 减一 | 中——需要构造满盘棋谱 |
| 5 | `bootstrapStore()`（自动存档订阅） | 中——需要 fake timers + localStorage 断言 |
| 6 | `Modal` 的 Escape / 焦点（与 F-02 一起做） | 中——Escape 可单测，焦点圈闭需要 e2e |
| — | `browserEngine` / `worker` 的接线 | **不建议单测**：需要真 Worker；现有 `e2e` 已经端到端覆盖了「AI 正常应手」与「AI 思考期间不落子」。**如果 F-03 要动 `persist`，那一条比这个更值得补** |
