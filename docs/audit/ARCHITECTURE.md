# 架构分析（Phase B）

分析对象：HEAD `4987c33` 的全部 `src/` 源码（117 个 `.ts` / `.tsx`，其中 43 个测试文件、74 个非测试文件）。
方法：解析全部 `import` / `export ... from` 语句构建文件级依赖图，再用 grep 逐条复核；对循环依赖另用 Tarjan SCC 与 DFS 着色两种独立实现复算。

## 1. 依赖图：结论

### 1.1 循环依赖 —— **未发现**

对全部 412 条 `src/` 内部边逐条做「目标能否回到源」的完全枚举反查，零命中。无自环，全仓无 `export * from`。

### 1.2 越层引用 —— **未发现逆层边**

项目声明的依赖方向是 `components/features → store → analysis/learn → ai → core`。逐层出边核实：

| 层 | 出边落点 | 是否越界 |
| --- | --- | --- |
| `core/` | 只在 `core` 内部（`board.ts:1`、`game.ts:1,2,3`、`rules.ts:1,2`） | 否 |
| `ai/` | 只到 `ai` 与 `core`（`search.ts:1,2`、`threat.ts:3,4`、`worker.ts:1,2`） | 否 |
| `analysis/` `learn/` | 只到 `ai` / `core` / `learn` / `lib` | 否 |
| `store/` | `persist` / `ai` / `core` / `lib` / `zustand` | 否 |

反向核实「`learn` 不得被 `ai`/`core` 依赖」：全仓**没有**任何 `ai → learn` 或 `core → learn` 边。

**两条值得记下的边（不是违规，但是分层图上的一个口子）：**

- `src/lib/shape-labels.ts:1` → `src/ai/patterns.ts`（`import type { ThreatKind }`）
- `src/lib/shape-labels.ts:2` → `src/learn/types.ts`（`import type { ShapeKind }`）

`lib/` 在 `docs/ARCHITECTURE.md` 里被描述为「无状态工具」，但 `shape-labels.ts` 反过来依赖 `ai` 与 `learn` 的**领域词汇**。两条都是 type-only，运行时零耦合，且 `shape-labels.ts` 的职责本来就是「把两个领域的棋型词汇映射成同一套中文名」——这个依赖是**它存在的理由**，不是失误。记在这里是为了让「`lib` 是最底层」这句话不被当成普适规则。

### 1.3 `core` / `ai` / `learn` 的纯逻辑约束 —— **全部成立**

- **React / Zustand 导入**：在 `core/`、`ai/`、`learn/`、`analysis/`、`lib/` 下 grep `from '(react|react-dom|zustand)` **零命中**。
- **DOM / 浏览器全局**：在 `core/`、`ai/`、`learn/`（排除豁免清单）下 grep，命中**全部位于注释或用例标题字符串**，无一条运行时代码。豁免的两个文件确实是唯一触碰 Worker 的地方：`src/ai/worker.ts:15,20`、`src/ai/browserEngine.ts:10,13,16,20`。
- **`Date.now()`**：唯一实际调用处是 `src/ai/search.ts:551` 与 `:574`（`elapsedMs` 计时）；`search.ts:561` 以函数值形式把 `Date.now` 透传给 `searchBoard`（注入时钟）。其余出现位置（`src/learn/*.test.ts` 的 `const NOW = Date.now`、`PracticeBoard.tsx:39,54` 把 `Date.now` 当实参传入、`gameRecords.ts:17` 的注释）都**不是调用**。全仓无 `new Date` / `performance.now` / `Date.parse`。**约束成立。**
- **其他副作用 API**：`core`/`ai`/`learn`/`analysis`/`lib` 下检索 `import.meta` / `setTimeout` / `setInterval` / `Math.random` / `console.`，只有 2 处命中且都合规（`browserEngine.ts:10` 在豁免清单内；`transposition.ts:16,19` 是注释，说明刻意用确定性 xorshift32 取代 `Math.random`）。

**`lib/` 下确实有浏览器 API**（不在禁令范围内，记录事实）：`theme.ts:25` 读 `document.documentElement`、`sound.ts:21-22,28` 用 `globalThis.AudioContext`、`sound.ts:17` 接收 `EventTarget`。`lib/` 无模块级可变状态。这两处使得 `theme` 与 `sound` 不能脱离浏览器单测（`sound.ts` 因此把 `createContext` 做成了可注入参数，测试走的是注入路径）。

### 1.4 孤儿模块 —— 只有两个「入口」，都符合预期

| 文件 | 被谁引用 |
| --- | --- |
| `src/main.tsx` | `index.html:13`（`<script type="module" src="/src/main.tsx">`） |
| `src/test/setup.ts` | `vite.config.ts:16`（`setupFiles`） |
| `src/ai/worker.ts` | 以 **URL 字符串**被 `src/ai/browserEngine.ts:10` 引用，不是 import——**不是孤儿** |
| `src/test/board-fixtures.ts` | 11 个测试文件 + `bench/engine.bench.ts:22` |

叶子（无出边）文件 10 个：`ai/version.ts`、`components/AppErrorBoundary.tsx`、`components/board/BoardStage.tsx`、`core/types.ts`、`lib/cx.ts`、`lib/motion.ts`、`lib/theme.ts`、`persist/schema.ts`、`store/requestCounter.ts`、`test/setup.ts`。

## 2. 死代码与无用导出

### 2.1 死 import —— **未发现**

全仓无「导入了但正文未使用」的绑定。（初次机械扫描报的 6 条经复核全是展开语法 `...foo` 被误判为属性访问的解析误报。）

### 2.2 死导出 —— 分三类，**只有第二类值得处理**

**A. 类型/接口（49 条）** —— `*Props`、`*Options`、`*Input`、`*Store`、`*Result`、`ShapeCount`、`MoveOutcome`、`MarkTone`、`ResolvedTheme`、`MotionKey`、`PutResult`、`GameRecordInput`、`GameEndInput`、`LearnStore`、`SettingsStore`、`ReplayRecord`、`AnalysisSummary`、`VerdictInput`、`RequestPurpose`、`SegmentedOption`、`ButtonVariant`、`ThreatSearchResult`、`DirectionThreat`、`FastThreat`、`DoubleThreat`、`SearchOptions`、`SearchOutcome` 等。

这些**不是死代码**：要么被同文件的其他导出签名引用，要么是「给消费方用的显式契约」。TypeScript 下删掉它们不会让代码变小，只会让签名内联、可读性下降。**明确列为「不应重构」**。

**B. 生产零引用、且不被任何测试引用的具体值（3 条，值得处理）**

| 位置 | 符号 | 事实 |
| --- | --- | --- |
| `src/lib/theme.ts:12` | `isThemePreference` | 全仓只在定义处出现。**没有任何调用方，也没有测试**。 |
| `src/core/board.ts:16` | `pointFromIdx` | 生产零引用；只被 `src/core/board.test.ts:2,27,35,37` 使用。而 `src/learn/verify.ts:38` 手写了同一套换算（见 FINDINGS F-04）。 |
| `src/store/analysisStore.ts:18` | `ANALYSIS_BUDGET_MS` | 只作为 `analysisStore.ts:61` 的闭包初值；生产路径 `ReviewScreen.tsx:113` 硬编码 `400` 覆盖它（见 FINDINGS F-06）。 |

**C. 仅被测试引用（36 条）** —— 例如 `searchBoard` / `searchOptionsFor` / `chooseMove` 的分层入口、`analyzeDirection` / `doubleThreat`、`__setIndexedDbFactory` / `__setGameRecordsIndexedDbFactory`、`memoryGameRecords`、`SCHEMA_VERSION` / `STORAGE_KEY` / `encodeSession` / `decodeSession`、`REPLAY_STEP_MS`、`undoPlies`、`createLearnStore`、`PROGRESS_SCHEMA_VERSION`、`createGameRecord`、`checkPrecondition`、`boardHasFive`、`NEIGHBOR_RADIUS`、`SHAPE_VALUES` 等。

**这是「为可测性而开放的接缝」，不是死代码。** `searchBoard` 与 `searchOptionsFor` 是 `chooseMove` 的下一层、`createLearnStore(storage)` 与 `createGameStore(engine)` 是工厂注入点，`__set*Factory` 是显式的测试注入点（源码注释里写明「生产路径不调用」）。**明确列为「不应重构」**。

## 2.3 依赖清单核对（阶段 B 的「无用依赖」）

逐个核查 `package.json` 里 20 项依赖的实际引用点：

| 依赖 | 源码引用 | 判定 |
| --- | --- | --- |
| `react` / `react-dom` | 22 / 1 个文件 | 使用中（`react-dom` 只在 `components/ui/Modal.tsx:4` 的 `createPortal` 与 `main.tsx:2` 的 `createRoot`） |
| `zustand` | 10 个文件 | 使用中 |
| `@playwright/test` | 10 个文件 + 2 份配置 | 使用中 |
| `@tailwindcss/vite` / `tailwindcss` | `vite.config.ts:1,11` + `src/index.css` | 使用中 |
| `@vitejs/plugin-react` | `vite.config.ts:2,11` | 使用中 |
| `jsdom` | `vite.config.ts:13`；`fake-indexeddb` 在 2 个测试文件里 `import 'fake-indexeddb/auto'` | 使用中（两者都通过配置或副作用导入生效，不出现 `from '...'`） |
| `oxlint` / `typescript` / `vite` / `vitest` | 命令行 / 配置文件 | 使用中 |
| `@types/node` / `@types/react` / `@types/react-dom` | 由 `tsconfig.*.json` 的 `types` 与 `lib` 间接生效 | 使用中（类型包不会被 `import`） |
| **`@testing-library/user-event`** | **全仓零引用**（grep `user-event` 只命中 `package.json:31` 与 `yarn.lock`） | ⚠️ **未使用的直接依赖** |
| **`@testing-library/dom`** | **全仓零直接 import** | 说明：它是 `@testing-library/react` v16 的**对等依赖**（peer dependency），装成直接依赖是为了锁版本。**保留，但应注明理由** |

**结论**：只有 **1 项真正的无用依赖**——`@testing-library/user-event@14.6.7`（`package.json:31`）。它在仓库的历史上可能用过（Phase 1 的组件测试），现在全部交互走 `fireEvent` / `render`。

**为什么这是「发现的债」而不是「缺陷」**：它不产生运行时成本（devDependency，且 `yarn install` 只多装约 1 MB），也不影响任何结论。**列在这里是因为 `AGENTS.md:69` 写着「不要为了抽象而抽象」，而一个零引用的依赖是同一类问题。** 是否删除列入 `REFACTOR_PLAN.md` 的批次 5（删除依赖会改 `yarn.lock`，属工程约定变更）。

## 3. 文件规模与复杂度

### 3.1 源文件行数（非测试，Top 12）

| 行数 | 文件 |
| --- | --- |
| 580 | `src/ai/search.ts` |
| 565 | `src/components/board/Board.tsx` |
| 505 | `src/store/gameStore.ts` |
| 437 | `src/learn/puzzles.ts`（内容数据） |
| 409 | `src/ai/patterns.ts` |
| 376 | `src/learn/lessons.ts`（内容数据） |
| 343 | `src/store/analysisStore.ts` |
| 316 | `src/persist/gameRecords.ts` |
| 290 | `src/ai/threat.ts` |
| 223 | `src/features/battle/BattleScreen.tsx` |
| 208 | `src/persist/progress.ts` |
| 185 | `src/ai/evaluate.ts` |

**没有任何文件大到需要拆分。** 最大的非内容文件 `search.ts` 580 行里约 45% 是注释；`puzzles.ts` / `lessons.ts` 是纯数据。

### 3.2 长函数

| 函数 | 位置 | 行数 | 评价 |
| --- | --- | --- | --- |
| `negamax` | `search.ts:274-362` | 89 | 单一职责（一次递归搜索节点），分支多但都是 alpha-beta 的标准步骤 |
| `Board` | `Board.tsx:102-565` | 464（JSX 占大头） | 见下方 |
| `searchForcing` | `threat.ts:140-248` | 109 | 冲四链与活三链两段枚举，注释解释了为什么必须分开 |
| `AnalysisPanel` | `ReviewScreen.tsx:106-170` | 65 | 条件渲染分支 3 条 |
| `createGameStore` | `gameStore.ts:209-505` | 297 | 一个 Zustand store 的 action 集合，每个 action 10–40 行，无单函数过长 |
| `AnalyzePanel / PracticeBoard` | `PracticeBoard.tsx:33-158` | 126 | 交互 + 渲染，无独立逻辑块 |

**唯一值得讨论的是 `Board.tsx`（565 行）。** 它在一次渲染里同时承担六件事：SVG 背景与木纹渐变、网格与星位、坐标标签、胜利连线、棋子（含最后一手脉冲与投影）、标记、悬停预览、焦点环、225 格命中区与键盘导航。**但这六件事共享同一套 SVG 用户坐标系与同一个 `uid`**，拆成多个组件就必须把 `uid`、`viewBox`、`focused`、`hovered` 全部提升或通过 context 传递。按「最小改动」与「不过度抽象」原则，**判定为「偏大但不需要拆」**，理由与反例条件写在 `TECH_DEBT.md`。

### 3.3 隐式状态

| 位置 | 隐式状态 | 评价 |
| --- | --- | --- |
| `Board.tsx:150` `hasEverFocusedRef` | 「棋盘曾拿到过焦点」 | 有一大段注释解释为什么不能改记「键盘动过焦点」；是经过真实缺陷修正的产物 |
| `Board.tsx:161-167` `document.activeElement` | 直接读 DOM 判定「焦点是否无人认领」 | 这是**唯一**能判断「玩家是否已 Tab 走」的办法；已用注释说明取舍 |
| `analysisStore.ts:58-75`（`engine` / `record` / `difficulty` / `budgetMs` / `pending` / `queue` / `inflightIndex` / `runId`） | 8 个闭包变量，不进 store | 它们是「本次分析的编排状态」，不是 UI 状态。**`runId` 这一道闸门有独立注释与测试**，是防「上一局的迟到响应被下一局当成自己的」的关键 |
| `gameStore.ts:42` `pendingRequestId` / `:64` `pendingHintRequestId` | 两个在飞请求号 | store 字段，可观测、可测 |
| `replayStore.ts:69` `timer` | interval 句柄 | 组件订阅启停，注释说明了「组件不在树上时定时器必须死」 |

**没有发现「靠时序或副作用隐式传递、且无法单测」的状态。**

## 4. 重复逻辑

### 4.1 真正的重复（3 处，都很小）

| 重复内容 | 位置 A | 位置 B |
| --- | --- | --- |
| 索引 → 坐标换算 | `src/core/board.ts:16-18` `pointFromIdx`（**导出但无人用**） | `src/learn/verify.ts:38` `{ x: i % 15, y: Math.floor(i / 15) }`（手写、硬编码 15） |
| 对手方计算 | `src/core/board.ts:47` `opponentOf` | `src/persist/gameRecords.ts:72` `resignedBy === BLACK ? WHITE : BLACK` |
| 分析预算常量 `400` | `src/store/analysisStore.ts:18` `ANALYSIS_BUDGET_MS` | `src/features/review/ReviewScreen.tsx:113` 字面量 |

### 4.2 「看起来重复但其实不是」（**不应合并**）

| 现象 | 为什么不能合并 |
| --- | --- |
| 两套棋型分值表：`ai/patterns.ts:46` `SHAPE_VALUE` 与 `ai/evaluate.ts:14` `SHAPE_VALUES` | 一张用于**单点排序**（比较「这一手好不好」），一张用于**整盘评估**（比较「局面对谁有利」）。量级不同是有意的，`evaluate.ts:9-13` 有注释明确禁止互相套用 |
| 两种「三」的判定：`patterns.ts:158` `analyzeDirection` 的精确口径与 `patterns.ts:246` `analyzeRuns` 的便宜口径 | 精确口径要对该方向每个空位试放再重扫，是搜索热路径上付不起的代价。两者分工写在 `AI_ENGINE.md` 的「棋型识别」一节 |
| 两套「成五点」枚举：`patterns.ts:108` `scanLine` 与 `evaluate.ts:82-99` `scoreSegment` | 前者枚举**包含落点**的 5 个窗口，后者枚举**棋段内全部**窗口；且前者的窗口天然只有 5 个（都包含落点），后者会在一整条棋段上滑窗重复命中同一处四——去重的必要性不同 |
| `findWinLine`（围绕最后一手）与 `verify.ts:34` `boardHasFive`（全盘） | 前者是比赛判定（只需查最后一手），后者是**题目自检**（判「开局是不是已经分出胜负」，必须查全盘）。两者口径不同是必要的 |
| 三处棋盘渲染（`BattleScreen` / `StepView` / `PracticeBoard` / `ReplayBoard` 传不同的 `interactive` / `marks`） | 共用同一个 `Board` 组件，差异全部走 props。**这已经是正确的复用方式** |
| 两处 `@keyframes` 与 `motionClass` | CSS 里 4 个 keyframes + `motion.ts` 的类名表；`motion.ts` 刻意不判 `matchMedia`（理由见 `ARCHITECTURE.md`） |

### 4.3 胜负判断的一致性 —— **只有一份**

全仓判定「五连」的地方只有 `src/core/rules.ts:21` `findWinLine`（生产路径）。`verify.ts:34` `boardHasFive` 是内容自检专用，内部也调用 `findWinLine`。`persist/gameRecords.ts:71` 的 `deriveWinner`、`replayStore.ts:38` 的 `derivePosition`、`gameStore.restore` 全部走 `core/game.ts` 的 `replay()`。

**「规则判定」与「教学判定」的关系**：教学用 `learn/verify.ts` 的 `judgeMove`，它在做棋型判断**之前**先调 `findWinLine`（`verify.ts:72`：不论目标是什么，成五了就是做对了）。**两条路径共用同一个胜负函数**，不存在「游戏判赢、教学判输」的分叉。这是本次审计重点检查项，结论是**没有分叉**。

## 5. 过度抽象 / 不必要的间接层

全仓抽查结论：**抽象的克制程度明显高于同类项目**。只有 2 处无意义间接层（见 FINDINGS F-05、F-07）：

- `analysisStore.ts:203-205` `patch()` 是 `set()` 的一行包装；
- `gameStore.ts:217-242` `makeNotifier(set)` 返回一个闭包，只为捕获 `set`——而 `set` 在 `create()` 的回调里本来就以参数形式在作用域内。

**没有发现**：工厂/管理器/策略模式的滥用、为单一实现写的接口、`AbstractXxx`、事件总线、DI 容器。

`createGameStore(engine)` / `createLearnStore(storage)` / `createAnalysisStore()` / `createReplayStore()` 四个工厂**都是**为测试注入而存在，且各自都有注入假实现的测试——**属于必要抽象**。

## 6. 类型安全

| 项 | 事实 |
| --- | --- |
| `strict: true` | 已开（`tsconfig.app.json:20`） |
| `noUnusedLocals` / `noUnusedParameters` | 已开（`:21,22`） |
| `noFallthroughCasesInSwitch` | 已开（`:24`） |
| `erasableSyntaxOnly` | 已开（`:23`），因此禁用 `enum`——`AGENTS.md` 把它列为硬性约束，全仓确实**零 `enum`** |
| `verbatimModuleSyntax` | 已开（`:14`），type-only 导入必须显式写 `import type` |
| `noUncheckedIndexedAccess` | **未开**。因此 `board[idx(x,y)]` 的类型是 `number` 而不是 `number \| undefined` |
| `exactOptionalPropertyTypes` | **未开** |
| `any` | 全仓非测试代码 **0 处**（grep `: any` / `as any`）；`@ts-ignore` / `@ts-expect-error` **0 处**；非空断言 `!` 在 `src/` 非测试代码里 **3 处**（`ai/threat.ts:177` 的 `winning[0]!`，上文已判 `winning.length === 1`；`store/analysisStore.ts:213` 的 `queue.shift()!`，上文已判 `queue.length > 0`；`:311` 的 `rec.moves[i]!`，索引由循环边界保证）。`bench/engine.bench.ts` 另有 5 处。**无一处是无依据的压制** |

`noUncheckedIndexedAccess` 未开是一个**有意的取舍**：棋盘访问在热路径上每节点发生数万次，打开它会给每次 `board[i]` 加上 `| undefined`，逼出大量 `!` 或局部变量。当前用 `Uint8Array` + `inBounds` 前置校验来保证安全，代价可接受。**记录为「现状可接受」，不建议打开。**

## 7. 异常处理与资源释放

### 7.1 异常处理矩阵

| 层 | 策略 | 位置 |
| --- | --- | --- |
| `core` / `ai` / `learn` 纯函数 | 不抛异常，用返回值表达（`MoveOutcome` 的 ok/error、`Verdict` 的 ok/reason、`ThreatSearchResult.move: null`） | 全层一致 |
| `ai/engine.ts` | `post()` 抛错 → 立即 reject 并清掉 pending；Worker 报错 → `failAll` 拒掉全部在飞请求 | `engine.ts:41-47,57-59` |
| `persist/storage.ts` | 任何失败静默 → 返回 null（当作没有存档） | `storage.ts:56-60,94-107` |
| `persist/progress.ts` / `gameRecords.ts` | 任何一步失败 → 整层降级到内存态，**绝不向上抛** | `progress.ts:172-201`、`gameRecords.ts:276-316` |
| `store` | AI 失败写 `aiError` 并提供「重试」入口，**不动棋局** | `gameStore.ts:378-388,392-397` |
| 组件 | `AppErrorBoundary` 兜底，`GameLibrary` 的 `list()` reject 退成空列表 | `AppErrorBoundary.tsx`、`GameLibrary.tsx:35-37` |

**未发现「吞掉错误却假装成功」的地方。** 反例检查：`useGameStore.ts:24` 在棋谱没真正落库时**主动抛错**，让结果弹窗显示「没能保存这局」；`gameRecords.ts` 的 `PutResult.persisted` 就是为区分「真存了」与「只活在内存里」。

### 7.2 资源释放

| 资源 | 释放点 | 是否完整 |
| --- | --- | --- |
| `AudioContext` | `lib/sound.ts:111-116` `dispose()` → `context.close()`；`BattleScreen.tsx:69` 在卸载时调用 | 是 |
| `pointerdown` 预热监听 | `sound.arm()` 返回解绑函数，`BattleScreen.tsx:73` 的 effect 直接把它当 cleanup | 是 |
| `setInterval`（回放自动播放） | `replayStore.ts:71-76` `stopTimer()`；`ReplayBoard.tsx:29-33` 在卸载时 `pause()`；`play()` 到尾自动停 | 是（`review.spec.ts:53` 有一条 e2e 专门验「切走再回来定时器没在后台推游标」） |
| IndexedDB 连接 | `progress.ts:149-151,167-169` `finally { db.close() }`；`gameRecords.ts:261-268` 在 request 回调里 `db.close()` | **`gameRecords` 的关闭时机可疑**，见 FINDINGS F-03 |
| Worker | `AiEngine.dispose()` 存在且被测试覆盖；但 `ai/browserEngine.ts` **没有导出 terminate**，`useGameStore.ts:15` 的 `appEngine` 是模块级单例、**永不释放** | 在单页应用里可接受（页面卸载即回收）。记录为事实，不列为缺陷 |
| 乐观锁 / 在飞请求 | 三道闸门（`requestId`+`gameVersion` / `runId`+`inflightIndex`+`moveIndex`）+ 全局只增计数器 | 是，见下 |

## 8. 并发的关键约定（复核结论）

`docs/ARCHITECTURE.md` 的「并发的六条关键约定」逐条对照源码复核：

| 约定 | 源码位置 | 复核结论 |
| --- | --- | --- |
| 过期响应必须丢弃（双闸门） | `gameStore.ts:403-407` | 成立 |
| 提示响应双重闸门 | `gameStore.ts:483-487` | 成立 |
| 分析请求三重闸门 | `analysisStore.ts:235-237` | 成立 |
| 三类请求共用一个只增不减计数器 | `store/requestCounter.ts:9-13` | 成立；`nextRequestId()` 被 `gameStore.ts:364,452` 与 `analysisStore.ts:220` 三处调用 |
| 玩家点击必须被忽略 | `gameStore.ts:143-150` `canHumanPlay`，被 `playHuman` 与 `Board` 的 `interactive` 共用 | 成立 |
| 引擎失败不能让对局卡死 | `gameStore.ts:378-388` + `AiPanel.canRetry` | 成立；`AiPanel.tsx:47` 的注释锁死了「重试入口不能挂在错误消息下面」 |

**一条文档没有写、但源码确实成立的约定**：`analysisStore` 的 `stop()`（`analysisStore.ts:336-339`）只清状态、**不取消已发出的请求**——`reset()` 递增 `runId` 让迟到响应作废。这与 `ReviewScreen.tsx:44-46` 的注释一致（「引擎没有取消接口」）。

**分析管线的一个非显然不变量**（本次审计新发现，已复核为**正确**）：
`pending` 里每条结论要「局面 i 的引擎首选」+「局面 i+1 的后续评分」两半。因为队列按局面号升序，第 i 手的结论实际上是在**局面 i+1 的响应到达时**才拼出来的（`analysisStore.ts:118-119` 的 `tryEmit(index)` 与 `tryEmit(index - 1)`）。棋盘满导致 `move === null` 时两半都拿不到，代码走 `analysisStore.ts:92-101` 跳过那一手并把 `total` 减一。**这条路径与「面板不能停在 N-1 / N」的界面要求耦合**，没有单测直接覆盖（见 `TEST_GAPS.md`）。

## 9. 存档结构

| 存储 | 介质 | 版本闸门 | 迁移 | 校验 |
| --- | --- | --- | --- | --- |
| 对局存档 | localStorage | `SCHEMA_VERSION = 2`（`storage.ts:7`），不等即丢弃 | **无** | 逐字段严格校验（`decodeSession`：坐标必须整数且 `inBounds`、`mode` 白名单、`difficulty` 走 `isDifficulty`、`resignedBy` 必须为 null 或 1/2） |
| 学习进度 | IndexedDB | `PROGRESS_SCHEMA_VERSION = 1`（`progress.ts:11`） | **无**（ROADMAP 已记录） | 严格校验，`lastView` 白名单显式同步（`progress.ts:115-118`） |
| 棋谱库 | IndexedDB | `GAME_RECORDS_SCHEMA_VERSION = 1`（`gameRecords.ts:12`） | **无** | 严格校验，且 `winner` **不信任调用方**、由 `replay` 现推（`gameRecords.ts:116`） |
| 设置 | localStorage（zustand `persist`） | **无版本、无迁移、无校验** | 无 | **无**（见 FINDINGS F-12） |

三个自建模块的口径一致；**zustand `persist` 是唯一的例外**。

## 10. 健康的模块（结论先行）

以下模块在「职责单一 / 依赖方向正确 / 边界清晰 / 测试充分」四个维度上都没有发现问题，**明确列为不应重构**：

| 模块 | 理由 |
| --- | --- |
| `src/core/`（4 个文件，~300 行） | 纯函数、无依赖、`replay()` 单一构造路径。审计用独立参考实现在 5000+ 随机局面上交叉验证 `findWinLine`，零分歧 |
| `src/ai/transposition.ts` | 确定性 PRNG 建表、双 32 位键、`lo` 校验、深者优先替换。审计验证了增量 `toggle*` 与从零 `computeKey` 在 120 局逐手完全一致 |
| `src/ai/candidates.ts` | 36 行，语义清晰。审计与独立实现逐局面比对，完全一致 |
| `src/store/requestCounter.ts` | 13 行，注释写清了「为什么必须共用」。全仓三个调用点正确 |
| `src/persist/schema.ts` | 28 行，把「库名/版本/建表」收敛成唯一出处，注释记录了它曾经踩过的坑（先打开的一方不建另一张表） |
| `src/analysis/analyze.ts` | 纯函数、无请求、结论里刻意不设「最佳/失误」标签 |
| `src/components/AppErrorBoundary.tsx` | 兜底界面刻意不依赖 store / 主题变量 / 自有组件 |

## 11. 危险的模块（结论先行）

| 模块 | 风险 |
| --- | --- |
| `src/store/analysisStore.ts` | 343 行里塞了一条有 8 个闭包变量、三重闸门、两个收尾时机的串行管线；**没有单一函数过长，但状态耦合密度是全仓最高**。改队列逻辑时最容易踩到「面板停在 N-1 / N」或「跨 run 污染」 |
| `src/persist/gameRecords.ts` | 唯一的「内容匹配替换」逻辑（`saveGameReplacing`）+ 事务时机与 `progress.ts` 不一致（F-03） |
| `src/components/board/Board.tsx` | 565 行、9 类 SVG 内容、225 个命中区处理器 + 一套 roving tabindex。**改棋盘几何或键盘行为必须跑真实浏览器**，jsdom 抓不到 |
| `src/ai/search.ts` | 580 行，全是热路径。任何改动都要同时面对「正确性」与「性能」两个约束，且性能数字必须能 `yarn bench` 复现 |
