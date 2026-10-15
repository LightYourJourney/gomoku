# Phase 06 — 棋谱复盘与 AI 分析体验重构

> 依据：用户在 2026-10-16 给出的 Phase 06 任务书。**完成后停止，不自动进入 Phase 07。**
> 本文同时是计划与实施记录：§二–§四 是动手前的侦察与决定，§五 起随实施推进补写。

## 〇、与 `PLAN.md` 的编号差异（先说清楚，免得对不上）

`PLAN.md` 是 Phase 00 时写的**早期草案**，它那份的「Phase 06」是「无障碍与标题结构」。
实际执行的阶段早已偏离那份编号——已经做掉的 Phase 02/03/04/05 分别是
对战主界面 / 棋盘质感 / 互动教学 / 残局挑战，都不是草案里同号的东西。

**本文的 Phase 06 以用户任务书为准**（棋谱复盘与 AI 分析），与 `PLAN.md` 的
「Phase 06 无障碍」不是同一件事。草案里那些无障碍条目**没有作废**，它们散在
`FINDINGS.md` 里，谁先被做掉算谁的——本阶段顺手清掉其中一条（§3.3 的复盘 h1）。

---

## 一、目标与范围

把「复盘」从**能用**抬到**好用**：空状态给出明确的下一步、列表能一眼看出这局怎么打的、
回放能定位到任意一手、分析结论点得动、并且**所有新的交互都复用已有的那一个回放游标**。

**不新增 AI 判断能力**，不改分析档位与预算，不给任何一手贴「最佳 / 失误」标签。

任务书 §二–§十 逐条对应本文 §3.1–§3.9；§十一 的 17 类测试对应 §五。

---

## 二、侦察结论（都是读代码得到的，不是推断）

### 2.1 数据层：棋谱里到底有什么

`GameRecord`（`src/persist/gameRecords.ts:20-37`）**九个字段全部 required**：

| 字段 | 类型 | 任务书 §三 问的 |
| --- | --- | --- |
| `seq` | `number` | **排序依据**：IndexedDB 自增主键，`list()` 按它降序 = 最近的在前 |
| `schemaVersion` | `number` | 恒为 `GAME_RECORDS_SCHEMA_VERSION`（当前 **1**） |
| `moves` | `readonly Point[]` | 手数 = `moves.length` ✓ |
| `firstPlayer` | `Player` | — |
| `mode` | `'pve' \| 'pvp'` | 人机 / 双人 ✓ |
| `humanColor` | `Player` | — |
| `difficulty` | `Difficulty` | **对手 AI 难度 ✓ 有可靠字段**（`beginner\|easy\|medium\|hard\|expert`） |
| `resignedBy` | `Player \| null` | 认输信息 ✓（`null` = 五连或和棋） |
| `winner` | `Player \| null` | 胜负 ✓（`put` 内部用 `replay` 推导，不信任调用方） |

**「对局时间」不存在，而且不该补。** `:17-19` 的注释写明刻意不存——`AGENTS.md:17`
规定 `Date.now()` 的调用只允许出现在 `ai/search.ts`，先后由自增主键表达。
补时间戳会让**所有存量棋谱作废**（`parseRecord` 逐字段校验，缺字段整条丢弃）。
任务书说「不要为了显示时间而让旧棋谱无法读取」——**结论：不显示时间，也不加字段。**

**兼容性**：`parseRecord`（`:84-118`）是**严格校验**，任何一处不符返回 `null`，
`list()` 再 `filter` 掉——**静默丢弃单条，不抛错、不补默认**。
`GAME_RECORDS_SCHEMA_VERSION = 1` 与 `DB_VERSION = 2` 是两个独立的版本号。

**错误路径（本阶段要动的）**：所有 IndexedDB 失败（打不开 / 被占用 / 事务 error / abort / 配额）
都在各方法的 `catch` 里落**内存兜底**并照常返回（`:300-302, :309, :319-322, :328-330`），
**绝不向上抛**。于是 `list()` 返回空数组——与「用户真的没下过棋」**在 UI 上逐字相同**。
唯一的降级信号是 `put` 的 `persisted: false`（`:318-321`），**`list` 没有对应物**。
`GameLibrary.tsx:50-52` 那个 reject 分支是**死代码**（list 永不 reject）。

### 2.2 回放层

`replayStore`（`src/store/replayStore.ts`）已有任务书 §五 点名的全部 API：
`record` / `cursor` / `playing` / `position` / `hasPrev` / `hasNext` +
`open` / `close` / `stepPrev` / `stepNext` / `goTo` / `play` / `pause`。

- **`cursor` 语义**：`0` = 空盘，`moves.length` = 终局；`goTo` clamp 到 `[0, moves.length]`。
- **`position` 是纯派生**（`derivePosition`），由 `record + cursor` 算出，**绝不增量维护** ✓
- **最后一手**由 `Board` 自己画（反色实心点），`winLine` 也由 `Board` 画。
- **定时器**：`play()` 起 `setInterval`，间隔 `REPLAY_STEP_MS = 900`（**模块级常量，无速度参数**）。
  `open` / `close` / `pause` 各调一次 `stopTimer()`；`ReplayBoard.tsx:31-35` 与
  `ReviewScreen.tsx:47-52` 在卸载时兜底 `pause()`。
- **两处真实缺陷**（本阶段修）：
  1. **`play()` 不检查 `hasNext`**（`:124` 只挡 `record === null || playing`）。
     在**终局**按「自动播放」会先把 `playing` 置真（按钮变「暂停」），要等**第一个 900ms tick**
     才发现到头并自停。任务书 §十 点名要覆盖「终局边界」。
  2. **`Board` 只读时命中区 `<rect>` 仍挂 `onClick/onKeyDown` 且 `pointerEvents="all"`**
     （`Board.tsx:645-649`），只是处理器早退空转（`handleClick:308` / `handleKeyDown:221`）。
     **加时间轴时不能误以为它们已经摘除**——拖动落点若压在棋盘上，事件归属要自己想清楚。

### 2.3 分析层

`analysisStore` 的状态：`target` / `verdicts: Map<moveIndex, MoveVerdict>` / `total` /
`running` / `error: string | null`。**没有「当前选中手」字段。**

- **档位固定 `easy`**（`ReviewScreen.tsx:115`），预算 **400ms**（`analysisStore.ts:19`），
  引擎版本 `search-1`。出处行渲染在 `data-testid="analysis-source"`。
- `MoveVerdict`：`moveIndex` / `move` / `engineMove` / `loss` / `confidence` /
  `engineDepth` / `engineNodes`。
- **亏损榜**：`buildSummary` 做 `filter(loss > 0)` → 降序 → **`slice(0, 3)`**（N = 3）。
- **缓存**：store 闭包里的 `Map`，键 `v1:${ENGINE_VERSION}:${seq}:${difficulty}:${budgetMs}`，
  **不持久化**；`ReviewScreen` 用 `useState` 建实例，**离开页面即丢**。
  任务书 §十 允许维持这个设计。
- **中断**：**没有 AbortController**，用代次号 `runId` + `reset()` 让在飞的响应作废；
  引擎没有取消接口，已发出的那一次搜索会在共用 Worker 上跑完（≤ 1 个预算）。
- **失败**：`search` reject → `set({ running: false, error })`，**但 UI 完全不渲染 `error`**
  （`grep -rn "error" src/features/review/*.tsx` 零命中）。0 条结论时静默退回「开始分析」按钮，
  **与从未分析无法区分**。任务书 §十 要求覆盖「分析失败」。
- **标签**：明确拒绝档位标签，只有「与引擎一致 / 与引擎首选相当 / 分差极大 / 分差约 N 子」。
  `analyze.test.ts:109` 专门断言文案**不含「失误」**。✓ 任务书 §八 的红线已经守住。
- **verdict → cursor 没有任何连线**：榜单卡片是纯 `div`（`ReviewScreen.tsx:155`），无 `onClick`。

### 2.4 UI 层

- **视图切换**：`ReviewScreen` 的 `useState(false)`，**全项目无 router**，`App.tsx:39-42`
  按 `learnStore.view` 条件渲染。
- **空状态**（`GameLibrary.tsx:69-72`）：一个 `Panel` 里两行纯文案，
  **没有 Button、没有链接、没有任何可点操作**。
- **三态**：`null` → 「正在读取棋谱…」/ `[]` → 空状态 / 有数据 → `<ul>`。
  **没有错误态**（见 §2.1）。
- **列表项**（`:76-88`）：一行 `resultLabel`（`黑方胜` / `白方胜（对手认输）` / `和棋`）
  + 一行 `metaLabel`（`人机 · 入门 · 9 手` / `双人 · 3 手`）。
  **`metaLabel` 已经含难度**（`:33`，注释里写着「人机局补上难度档（F-UI-22）」）——
  **`FINDINGS.md` 的 F-UI-22 已经修掉了**，任务书 §三 的六项里只有「读取失败」还没处理。
- **详情页布局**：`PageShell variant="flush"` → `main` 在 `wide-layout` 起是
  `grid-cols-[minmax(0,1fr)_344px]`（窄屏纵向堆叠）。滚动容器：列表页 1 个；
  **详情页窄屏 0 个内层滚动**，`wide-layout` 起只有 `aside` 滚。
- **导航**：`learnStore.setView(view)`，`View = 'battle' | 'learn' | 'puzzles' | 'review'`。
  `PuzzleScreen.tsx:111` 就是这么跳去对战的。
- **`BoardMark`**：`{ point, label?, tone?, radius? }`；`radius` 默认 `0.4`，
  回放用 `0.26`（`ReplayBoard.tsx:43`）。**可以逐手传不同的 `radius` 与 `tone`**——
  §3.6 靠这个实现「当前手突出」，**不用改 `Board`**。

### 2.5 三条已记录的既有缺陷（本阶段顺手清）

| 编号 | 内容 | 本阶段处置 |
| --- | --- | --- |
| `F-UI-14` | 复盘回放的落子编号只有 **6.91–8.31 px** | §3.6 |
| `FINDINGS` 标题表 | **复盘回放页没有 h1**（只有 `h2 回放` / `h2 引擎分析`）——教学练习页与残局详情页在 Phase 04/05 都修过同类 | §3.3 |
| `F-UI-22` | 棋谱条目看不出难度 | **已修**（`metaLabel`），本阶段只需确认它没被改回去 |

---

## 三、要改的东西

### 3.1 复盘空状态（任务书 §二）

现在是一块只有两行字的 `Panel`。改成明确的引导区：视觉标识 + 标题 + 说明 + **一颗真的能用的主操作**。

- **主操作**「开始一局对战」→ `learnStore.setView('battle')`。
  传法：`ReviewScreen` 取 `useLearnStore((s) => s.setView)`，作为 prop 交给 `GameLibrary`
  （与 `PuzzleScreen.tsx:111` 同法，**不让 `GameLibrary` 自己去连 store**——
  它现在是个纯展示组件，`storage` / `onOpen` 都是注入的）。
- **不得渲染只有外观、没有实际效果的按钮** ✓ 主操作真的切页面，e2e 会点它。
- **不伪造棋谱**：任务书说本阶段**默认不新增示例棋谱**，优先主路径 → **不做示例棋谱**。

### 3.2 棋谱库（任务书 §三）

**呈现项已经齐了**（§2.4），本阶段只补**读取失败 / 存储降级**这一格。

现状是「静默当空库」——`list()` 永不 reject，所以 `GameLibrary` 那个 reject 分支是死代码。
任务书说「不能将所有读取失败都伪装成用户确实没有下过棋。**如果底层无法区分两种情况，
需如实说明局限**」。

**做能区分的那一版**（本仓已有先例：`put` 返回 `persisted: boolean`，同一条理由）：

```ts
export interface GameRecordList {
  readonly records: readonly GameRecord[]
  /** 底层不可用，这批数据来自内存兜底——本次会话能看，刷新就没了。 */
  readonly degraded: boolean
  /** 读出来了、但没通过校验而被丢掉的条数（`parseRecord` 返回 null）。 */
  readonly skipped: number
}
list(): Promise<GameRecordList>
```

**为什么要 `skipped`**（终审第 7 条指出我漏了一半）：「下过棋却看到空库」其实有**两个**
来源，不是一个——

| 来源 | 现有信号 | 表现 |
| --- | --- | --- |
| 存储不可用（隐私模式、配额、占用） | `degraded` | 走内存兜底 → 空 |
| **读到了但整条没通过校验** | `parseRecord` 返回 `null` → `filter` 掉（`:295-302`） | 静默少几条，极端情况全空 |

第二个来源在我原方案里 `degraded` 恒为 `false`，等于**没覆盖**。
`skipped` 数一下就行（`filter` 的时候顺手），UI 在 >0 时如实说
「有 N 条棋谱读不出来（多半是旧版本留下的）」。**不断言原因，只说事实。**

- `indexedDbGameRecords.list()` 走兜底时 `degraded: true`；成功路径 `false`。
- `memoryGameRecords` 加一个参数：`memoryGameRecords(degraded = false)`，
  **只有生产的 `fallbackToMemory()` 传 `true`**。
  为什么不干脆恒 `true`：`review.test.tsx` 有 **11 处**拿它当假 storage 用，
  恒 `true` 会让这些用例**集体**多出降级文案。而单独用它时它代表的是
  「一个能用的存储」，`degraded: false` 才是它在这个语境下的真实语义；
  **降级是调用者（`fallbackToMemory`）的处境，不是这个类的固有属性**。
  `skipped` 对它恒为 `0`（记录只由它自己的 `put` 产生，进出的校验是同一套），
  但**类型上它也得返回这个字段**，别为了省事漏掉。
  顺带：`degraded` 与 `skipped` 不会同时非零——走内存兜底时压根没读库，
  也就无从谈起"读到了但没通过校验"，两句文案不会打架。
- UI：降级时在列表**上方**加一行如实说明；**空 + 降级**时，空状态里补一句
  「也可能是浏览器禁用了本地存储」——**不断言原因，只说明局限**。
- **注意**：这是**接口变更**，调用方**不止 `GameLibrary` 一处**（终审纠正了我原来的说法）：
  `saveGameReplacing` 内部也调 `list()` 再 `find`（`gameRecords.ts:173-183`，**生产代码**），
  `gameRecords.test.ts` 另有 6 处消费返回值。`tsconfig.app.json` 的 `include: ["src"]`
  把测试也算进类型检查——**没跟上的地方会成片红**。
  影响面依然小（每处一行解构），但动手前先 `grep -rn "\.list()" src/` 拿全量，
  别照着「只有一处」去改。

### 3.3 回放页布局（任务书 §四）

现状**已经符合**桌面两栏 / 移动堆叠，本阶段只做两件事：

1. **补 h1**（`FINDINGS` 记的既有缺口）：详情页现在整页没有一级标题。
   **注意工具栏里只有一颗「← 棋谱列表」按钮，没有现成的页名可以升**——
   所以是**新增**一个 `h1`：放在右栏「回放」面板之前、或工具栏按钮旁边。
   Phase 04 的教学讲解页是同一个修法（`h2 讲解 2 / 3` → `h1 五个连成一线就赢` →
   `h2 棋盘演示`），照它办。选工具栏旁边：那里是视觉上的页首，读屏的顺序也对。
2. **确认不制造多重滚动陷阱**：详情页窄屏 0 个内层滚动 + 文档滚动；
   `wide-layout` 起只有 `aside` 滚。**加了时间轴之后要重新确认这条**——
   时间轴若自带横向滚动，不能与外层打架。

### 3.4 回放时间轴（任务书 §五）

新增 `ReplayTimeline` 组件，**全部状态读写都走 `replayStore`**，不建第二个游标。

必须有的能力：`第 N / 总手数` · 点击定位 · 拖动定位 · 上一步 · 下一步 ·
跳至开局 · 跳至终局 · 自动播放 · 暂停。

- **实现**：一个 `<input type="range" min={0} max={total} value={cursor}>`。
  用原生 range 而不是自绘 div 条，理由是**键盘与可访问性几乎白送**：
  方向键/Home/End 原生可用，`role="slider"` 与 `aria-valuenow/min/max` 也自带。
  任务书要的「键盘可操作 + 有可访问标签」用它最省。
- `aria-label` 写「回放手数」，`aria-valuetext` 写「第 N 手，共 M 手」——
  读屏念出来是**手**，不是裸数字。
- onChange → `goTo(Number(e.target.value))`；**拖动过程中不要每帧都做重活**
  （局面是纯派生，本来就只算一次，见 §3.9 的性能一节）。
- **命中区必须 ≥24px**（终审第 4 条，原计划漏了这条）：探针的可交互元素清单包含
  `input` / `select` / `[role=radio]`（`bench/ui.probe.mjs:1224-1226`），
  而 `under24` 只豁免 `intersection-*`（棋盘交叉点）。
  原生 `<input type="range">` 默认高度约 16px——**不处理就直接把 `yarn ui:probe` 判红**。
  判据是 `target.under24 && !includes('intersection-')`（`bench/ui.probe.mjs:1663-1665`），
  也就是说 **24 是下限**——卡着 24 写，任何一次舍入都可能翻红。量的又是
  `Math.round(getBoundingClientRect().height)`，所以给到 **28px（`h-7`）** 留余量，
  不贴着线走。
  **原生 `<select>` 因此排除**：终审实测它默认只有 **17px** 高，照样判红；
  要用也得显式给高度。速度选择就用自绘的 `[role=radio]` 按钮组，一并按 `h-7` 起。
- **挂在哪**（终审列为未验证项，这里定下来）：**右栏「回放」面板内**，不进棋盘列。
  棋盘列的空间是直接压棋盘的（探针判据 2 要求棋盘 ≥320px），
  而任务书 §四 要的「回放控制紧邻棋盘」在两栏下由右栏满足、
  移动端它就在棋盘正下方，同样够得着。
- 边界：`total === 0`（0 手认输局）时禁用整条时间轴；`max` 就是 `moves.length`，
  与 `goTo` 的 clamp 边界**同一个数**，不会越界。
- **「回放棋盘始终只读」**（任务书 §五 的末条）：`ReplayBoard` 传 `interactive={false}`，
  `review.test.tsx:135` 用「悬停不出现落子预览」钉住了它。
  **不要再去补「点棋盘不落子」**——那条断言是**无效的**，`:141-143` 的注释逐字写着
  「只断言『点击后游标不动』是无效的，`onPlay` 是空实现时它两边都成立
  （**变异测试证实过**）」。这正是本仓「写完一条声称能抓缺陷的用例就撤掉修复跑一次」
  那条规矩的价值：它当年就被验伪过一次，别再走回去。
  （§2.2 缺陷 2 说的「命中区处理器仍然挂着」依然成立，只是**断言不到**它——
  要测得出就得绕过那个空 `onPlay`，不值得。）
- **拖动性能要真的量一次**，不是猜：`<input type="range">` 的 React `onChange`
  在拖动**过程中连续触发**，每一帧都会 `goTo` → 重算局面 → 重渲染 225 个格子 +
  手顺标记。9 手局几乎无感，**长棋谱（100+ 手）没量过**。
  实施时用 `Performance` 面板或手工拖一次看掉不掉帧；
  **只有量到卡顿才上防抖**——任务书 §十 要的是「避免无意义的重复搜索」，
  而分析本来就与 cursor 无关（§3.9 第一条），别为了想象中的问题加复杂度。

### 3.5 播放速度（任务书 §六）

`replayStore` 现在只有一个模块级常量 `REPLAY_STEP_MS = 900`。加档位：

**`REPLAY_STEP_MS` 不能删**（终审第 5 条）——三个文件 import 它：
`store/replayStore.test.ts`（多处 `advanceTimersByTime`）、`features/review/review.test.tsx:5,173`、
`e2e/review.spec.ts:2`（它派生 `REPLAY_DWELL_MS = REPLAY_STEP_MS * 3`，`:8-11` 的注释写明
「写死的话，将来把间隔调大，等待就静默地不再成立」）。
而 `tsconfig.e2e.json` 会把 e2e 一起 typecheck——**删常量就是成片红**。

所以让它**成为 `normal` 档的值**，而不是另起一个同值常量：

```ts
export const REPLAY_STEP_MS = 900
export const REPLAY_SPEEDS = { slow: 1400, normal: REPLAY_STEP_MS, fast: 400 } as const
export type ReplaySpeed = keyof typeof REPLAY_SPEEDS   // 'slow' | 'normal' | 'fast'
```

- store 加 `speed: ReplaySpeed`（默认 `'normal'`）与 `setSpeed(next)`。
- **900 只许出现一次**：档位表引用常量，不许抄字面量。

**播放中手动跳转会怎样**——任务书 §六 要「清楚且一致的播放规则」，原计划**没写**（终审第 6 条），补上：

`goTo` / `stepPrev` / `stepNext` 现在**都不碰 `playing`**。也就是说播放中拖时间轴，
游标被人挪走、定时器还在跑，下一个 tick 又把它推回去——**用户按不住**。

规则定为：**任何手动定位都暂停**（三个方法里都先 `stopTimer()`，再把 `playing` 置假）。

- 语义清楚：「你接管了，我就停」，与「到结尾自动停」是同一条思路。
- 为什么不是「跳完接着播」：用户拖时间轴是在**找某一手**，刚找到就被自动播放推走最难受。
- **实现上有个坑，必须先绕开**：`play()` 的定时器里现在调的正是**公开的** `stepNext()`
  （`replayStore.ts:135`）。照上面那条直接改，**定时器第一个 tick 就会把自己停掉**，
  播放一步即止——规则是对的，落点错了。
  所以**公开方法与定时器必须分家**：抽一个**私有的** `advance()`
  （只推游标、不碰 `playing`）给定时器用；公开的 `stepPrev` / `stepNext` / `goTo`
  才是「手动定位 → 暂停」。
- **写错了会红在哪**（终审把受害者指出来了）：定时器自杀之后自动播放只走一手，
  `replayStore.test.ts:173-184`（`play` 后 `advanceTimersByTime` 两次、断言
  `cursor === 2`）**必红**。注意这不是「旧语义要改」——**那批用例是对的，
  新实现才是错的**，不要动它们。
- **`setSpeed` 在播放中切换时必须先 `stopTimer()` 再重建**——
  否则旧 interval 会用旧间隔继续跑，**两个计时器并行推游标**。
  任务书 §六 把这条点名为硬要求。
- 实现上让 `play()` 与 `setSpeed()` 共用一个 `startTimer()`：
  **起表的地方只有一处**，就不存在「忘了清」。
- 文案：`慢速` / `标准` / `快速`（放 `<select>` 或三颗单选按钮；按钮组更容易键盘操作）。

### 3.6 棋盘与回放联动（任务书 §七）

`F-UI-14` 说编号只有 6.91–8.31 px。任务书给了两条路：「减少同屏编号数量」**或**
「增强当前手的视觉突出程度」，并加了一句「**不能因此丢失查看完整手顺的能力**」。

**逐条检查的结果**（大部分现状已经满足）：

| 任务书要的 | 现状 |
| --- | --- |
| 最后一手明确标识 | ✓ `Board` 画反色实心点 |
| 棋盘显示当前局面 | ✓ 纯派生的 `position` |
| 当前手数同步变化 | ✓ `move-counter` |
| 当前一步与棋谱记录对应 | ✓ 每手一个编号徽标 |
| **数字过密时的可读性** | **密，但不重叠**：一格 = 1 单位，编号直径 = `0.26 × 2 = 0.52` 单位，相邻编号之间还剩 0.48 单位 |
| **增强当前手的视觉突出** | **已经有了**——当前手就是最后一手，`Board` 在那格画反色实心点 |

**结论：本阶段不动编号半径，也不减编号数量。** 三条理由都是算过的：

1. **「增强当前手」已经由反色实心点承担**（`Board` 自己在 `lastMove` 上画的那颗）。
   再加一层是重复表达。
2. **调大当前手的 `radius` 会挤掉棋子的可见边**。约束是 `STONE_RADIUS = 0.44`
   （`Board.tsx:61`）：半径 0.26 时边缘余 0.18 单位，0.34 时只剩 0.10 单位——
   390 宽（棋盘约 340px，1 单位 ≈ 21.25px）下就是 **3.8px → 2.1px**，
   而「小半径」这个设计前提的全部意义就是**让棋子露出来**（`Board.tsx:15-20`）。
3. **减少编号会真的丢信息**：复盘页**没有手顺列表**，编号是唯一载体——
   这正是任务书那句「不能因此丢失查看完整手顺的能力」要防的。

（顺带记一条否决过的方案：给当前手换个 `tone` 不行。`MarkTone` 只有
`'accent' | 'good' | 'bad'`（`Board.tsx:7`），后两个是**判题反馈**语义；
而且标记文字颜色是**写死的** `var(--c-accent-fg)`（`:592`）——
换底色而文字色不动，对比度就没人算了。）

**F-UI-14（编号 6.91px）因此修不掉，只能如实记**：字号 = `radius × 1.25` 用户单位
（`Board.tsx:587`），0.26 → 0.325 单位，390 宽下约 6.9px；
**就算当前手提到 0.34 也只有约 9.0px，仍低于 `DESIGN_SYSTEM.md` §8.2 的 10px 下限**。
要真达标得**改掉「小半径」这个前提本身**——编号要么盖住棋子、要么另找载体。
**两件都超出本阶段范围**：写进 §八 的风险清单，**交付报告里不能报成已修**。

### 3.7 分析面板（任务书 §八）

任务书列了三项「默认信息」与四项「技术与来源信息」。现状对照：

| 要的 | 现状 |
| --- | --- |
| 分析是否完成 | ✓（`已完成 N / M 手`） |
| 分析进度 | ✓（`analysis-progress`） |
| 关键步骤摘要 | ✓（`topLosses` 卡片） |
| **当前选中步骤的分析信息** | ✗ **没有** |
| 引擎版本 / 档位 / 预算 | ✓（`analysis-source`） |
| 分数的含义与局限 | ✓（「预算内未搜完（启发式）」） |
| **分析失败** | ✗ `error` 有字段但**不渲染** |

改两处：

1. **失败要说话**：`state.error !== null` 时渲染一行如实说明 + 「重新分析」按钮。
   现在失败会静默退回「开始分析」，与从未分析**看起来一样**——那等于把失败藏了。
2. **当前步骤的分析信息**：见 §3.8，**由 `cursor` 推导，不新增 store 字段**。

### 3.8 点击关键手跳转（任务书 §九）

这是本阶段的主功能，而**接入点只有一个 `onClick`**：

```
点击「第 17 手」→ goTo(verdict.moveIndex + 1) → cursor 变 → 棋盘/计数/时间轴全部跟着变
```

**off-by-one 是这里唯一的坑，先把它钉死**（任务书专门提醒了）：

| 概念 | 取值 | 出处 |
| --- | --- | --- |
| `verdict.moveIndex` | **0-based**，第几个着法 | `analyze.ts` |
| 卡片上的「第 N 手」 | `moveIndex + 1` | `ReviewScreen.tsx:157` |
| `cursor` | 「已看到第几手」，0 = 空盘 | `replayStore.ts:14` |

**第 17 手之后 ⇒ `cursor = 17`**，而 `17 = moveIndex + 1`（`moveIndex = 16`）。
所以 `goTo(verdict.moveIndex + 1)` **恰好**，不需要 ±1 的补丁。

**「当前选中」不新增状态**：`selectedMoveIndex = cursor - 1`。
cursor 落在哪张卡片上，哪张就高亮——手动走步走到同一手，**高亮也一样亮**
（这正是「不建第二个游标」带来的好处：不可能出现「棋盘在第 5 手、面板说选中第 7 手」）。
面板里「当前步骤的分析信息」同理：`verdicts.get(cursor - 1)`。

### 3.9 状态与性能（任务书 §十）

- **快速拖动时间轴**：局面是**纯派生**（`replay(moves.slice(0, cursor))`）。
  9 手的棋局重算一次是微秒级，**不需要防抖**；长棋谱若观察到卡顿，
  再考虑「只在 onChange 提交、拖动中只更新本地显示」——**先量再优化，不预先加复杂度**。
- **不会因拖动触发 AI 搜索**：分析由 `start()` 显式发起，**与 cursor 无关** ✓
  （这一条要在测试里钉住：拖动时间轴不产生新的引擎请求）
- **分析中离开页面**：已有 `stop()` 兜底 ✓
- **分析中切换棋谱 —— 侦察时发现的既有缺陷，修法是现成的**：
  `openRecord` 会调 `stop()`，而 `stop()` 只置 `running = false, target = null`，
  **不清 `verdicts`**。于是换到另一局之后，面板会拿**上一局的结论**去渲染
  （`AnalysisPanel` 只判 `record === null`，不判结论属于谁）。而且 `stop()` 之后
  判「有没有分析过」用的 `verdicts.length === 0` 也不再成立——面板会显示
  「已完成 N / M 手」，**两个数字都是上一局的**（`stop()` 既不碰 `verdicts`
  也不碰 `total`，见 `analysisStore.ts:342-345`）。
  （`total` 的写入点不止一处——`:291` 是 `start()`，另有 `:96` 的递减与 `:272` 的初始化；
  但它们**都不在 `stop()` 这条路径上**，所以结论不变。原文写成「只在 `start()` 里写」，
  是第二轮终审纠出来的。）
  **修法不用改 store**：`AnalysisTarget` 里带着 `seq`（`analysisStore.ts:21-26`）。
  （缺陷与修法成立；上面这两句的机制描述按终审纠正过一次——原来写成「`total` 却是新的」，
  与代码不符。）
  UI 只要认「结论属于当前这局」，即 `state.target?.seq === record.seq`；
  不等就按**未分析**渲染。零新状态、零 store 改动。
- **反复打开同一棋谱**：缓存键含 `seq`（`analyze.ts:104-106`），
  第二次打开会**零请求**填充。要有用例钉住「命中缓存不重新跑引擎」——
  否则缓存悄悄失效了也没人知道。任务书 §十 点名了这一项。
- **长棋谱播放**：既有的 `BLACK_WINS` 只有 9 手。要在测试里构造一条长棋谱
  （不写进题库，只作为测试夹具），确认播放到底、时间轴不越界、
  中途 `pause()` 后不留定时器。
- **缓存**维持会话内（任务书允许），**不加持久化**。

---

## 四、改动文件清单（预告，实施后按实际情况订正）

**新增**
- `src/features/review/ReplayTimeline.tsx` + 测试
- `docs/ui-redesign/PHASE_06.md`（本文）

**修改**
- `src/store/replayStore.ts` —— 速度档、`play()` 的 `hasNext` 检查
- `src/store/replayStore.test.ts` —— 补速度与终局用例
- `src/persist/gameRecords.ts` —— `list()` 返回 `degraded` + `skipped`；
  `memoryGameRecords(degraded = false)`；`saveGameReplacing` 内部的 `list()` 跟着解构
- `src/persist/gameRecords.test.ts` —— **存在**（6 处消费 `list()`），补降级/跳过用例
- `src/features/review/GameLibrary.tsx` —— 空状态重构、降级与跳过说明
- `src/features/review/review.test.tsx` —— **原计划漏了它**：`:48` 空库文案、`:353` 失败退空库
  两条要改；其余别动
- `src/features/review/ReviewScreen.tsx` —— 传 `setView`、h1、点击跳转、失败显示、选中态
- `src/features/review/ReplayBoard.tsx` —— 接时间轴与速度、当前手突出
- `e2e/review.spec.ts` —— 新增 e2e（既有的 4 条依赖的文案与 testid **不要改**）
- `bench/ui.probe.mjs` —— 新状态；`review-empty` 的等待条件（若空状态标题保留则不动）
- 文档：`ROADMAP.md` / `TEST_REPORT.md` / `USAGE.md` / `ARCHITECTURE.md` / `DESIGN_SYSTEM.md`

---

## 四之二、会被本阶段改坏的既有用例（动手前先点名）

单测一共 **17** 条（`review.test.tsx`，早先写的 19 是数错的），**有两条会被直接改掉**，不是意外：

| 既有用例 | 为什么会变 | 怎么处置 |
| --- | --- | --- |
| `:48`「空库显示**引导文案**」 | §3.1 把空状态从两行字改成引导区 | 跟着改断言（标题「还没有保存的对局」保留，所以探针的等待条件不用动） |
| `:353`「list() 失败时**退成空库文案**」 | §3.2 给 `list()` 加了降级信号，失败不再伪装成空库 | 改写成「降级时给出如实说明」；这是**行为变好**，不是放宽断言 |

另外两处**差点**被改坏、已经用设计规避掉：

- `review.test.tsx` 里 **11 处** `memoryGameRecords()`——靠 §3.2 的 `degraded = false` 默认值
  保持不变（**如果那个默认值取反，这 11 条会集体变样**）。
- `bench/ui.probe.mjs` 的 `review-empty` 等的是 `text=还没有保存的对局`——
  §3.1 把它**留作标题**，所以等待条件仍然成立。

`e2e/review.spec.ts` 的 4 条（存局后列出 / 回放编号与走步与自动播放 / 刷新持久 / 分析标注）
用的都是**保留下来**的控件与文案，预期不动——**实施后要跑一遍确认，不能假设**。

## 五、测试计划（任务书 §十一 的 17 类）

| # | 任务书要求 | 落在哪 |
| --- | --- | --- |
| 1 | 复盘空状态 | 单测（`review.test.tsx`）+ 探针 `review-empty` + e2e |
| 2 | 空状态跳转对战 | e2e（点「开始一局对战」→ 真的到对战页） |
| 3 | 棋谱列表 | 已有单测，补降级文案 |
| 4 | 棋谱加载与错误状态 | 单测（新增 `degraded` 两条：空+降级、有数据+降级） |
| 5 | 第 0 手 | 单测（时间轴在 0、上一步禁用） |
| 6 | 跳到最后一步 | 单测 + 探针 |
| 7 | 时间轴任意定位 | 单测（`goTo` 经时间轴）+ e2e |
| 8 | 前后步进 | 已有 |
| 9 | 播放 / 暂停 | 已有；**补「播放中手动定位会暂停」**（§3.5 定的规则）与终局按播放不进入 playing |
| 10 | 播放速度切换 | **新增**：三档间隔、切换时旧定时器不残留 |
| 11 | 播放完成自动停止 | 已有；**补**「终局按播放立刻不进入 playing」 |
| 12 | 页面卸载定时器清理 | 已有 |
| 13 | 分析结果点击跳转 | **新增**：点卡片 → cursor = moveIndex+1 |
| 14 | 分析结果与实际棋谱一致 | **新增**：跳转后 `position.moves` 长度 = moveIndex+1 |
| 15 | 零手认输、正常终局与和棋 | **新增**：0 手局（时间轴禁用、播放禁用） |
| 16 | 旧棋谱读取兼容性 | 已有（`parseRecord` 各类拒绝） |
| 17 | 桌面和移动端布局 | 探针 + e2e |

**反向验证**（`AGENTS.md:39` 的固定做法）：每条**声称能抓缺陷**的新用例，
写完把修复撤掉跑一次确认变红。至少覆盖：时间轴越界、速度切换的双定时器、
点击跳转的 off-by-one、终局播放自停。

---

## 六、截图与探针

任务书 §十二 要 10 张。现有 4 个 review 状态（`review-empty` / `review-library` /
`review-replay` / `review-analysis`），对应关系：

| 任务书要的 | 怎么来 |
| --- | --- |
| 复盘空状态 | `review-empty`——它等的是 `text=还没有保存的对局`（`ui.probe.mjs:739`），而 §3.1 把那句**留作标题**，所以**等待条件不用改** |
| 已有多条棋谱 | `review-library` ✓ |
| 回放开局 / 中盘 / 终局 | `review-replay` 是**终局**那帧；**补两个状态**（开局、中盘） |
| 时间轴 | 并入上面几帧（时间轴常驻） |
| 分析过程中 | **新增**（现有 `review-analysis` 等到跑完） |
| 分析完成 | `review-analysis` ✓ |
| 点击关键手之后 | **新增**：点榜单第一张卡之后的帧 |
| 移动端复盘 | 矩阵在 390 档会给所有状态出图 ✓ |

---

## 七、门禁

六条（`AGENTS.md` 的提交前清单）+ 阶段收尾的 `e2e:prod`，加上本仓的两把棘轮：

```
yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e && yarn e2e:prod
yarn gates && yarn ui:probe --out after-phase06 && yarn check:coverage && yarn bench:check
```

改了界面结构，所以**探针与覆盖棘轮必须重跑**，`coverage.ratchet.mjs` 的
`DEFAULTS.current` 要指向 `after-phase06`。

### 7.1 实跑结果（全绿）

| 命令 | 结果 |
| --- | --- |
| `yarn lint` / `yarn typecheck` | ✓ |
| `yarn test` | ✓ **1046 passed / 61 文件**（Phase 05 收尾时是 1028 / 60） |
| `yarn build` | ✓ |
| `yarn gates` | ✓ knip 无死代码、jscpd **0 克隆**；棘轮 **单测 1046 · e2e 145** |
| `yarn e2e` | ✓ **145 passed (5.0m)** |
| `yarn e2e:prod` | ✓ **5 passed** |
| `yarn ui:probe --out after-phase06` | ✓ **38 状态 / 308 张 / 七条量化判据全过** |
| `yarn check:coverage` | ✓ 172 条 / 21 状态，实比 **3084 条未缩小**，另有 136 条新增覆盖 |
| `yarn bench:check` | ✓ 断言 19/19 条一致 / 不变量 29 项一致 |

**探针在这一阶段跑了两次**——第一次红了 16 处（§八之二 第 6 条），改完才全绿。
「七条判据全过」这句话是**重跑过一次**才成立的，不是第一次就有的。

---

## 八、风险与取舍（动手前先写下来，事后对账）

1. **`list()` 接口变更**是最有破坏性的一处。调用方**不止 `GameLibrary`**
   （终审纠正过）：还有 `saveGameReplacing`（生产代码）与 `gameRecords.test.ts`
   的 6 处，以及各处注入的假 storage。**退路**：若影响面超出预期，
   就不动接口，只在空状态里如实写一句局限——**任务书允许这种退让**。
2. **时间轴用原生 `<input type="range">`**：样式要按令牌调，**并且命中区必须 ≥24px**
   （§3.4，探针判据 5 会直接判红）。换来的是键盘与读屏支持几乎零成本。
3. **F-UI-14（落子编号 6.91px）本阶段修不掉，只能缓解**——见 §3.6。
   任务书 §七 给的「减少编号」那条路我没走（会丢手顺信息），
   于是「密」与「字号」**两个问题都只解决了一半**。
   **交付报告要如实写，不能报成已修。**
4. **速度档的间隔值是设计选择**，不是实测出来的最优值：1400 / 900 / 400 里
   900 是现状（不动），另两档取一个明显的快慢差。
   **不写进文档当性能数字**——`AGENTS.md` 规定写进文档的性能数字必须来自 `yarn bench`。
5. ~~`stop()` 不清 `verdicts` 要实测确认~~ —— **侦察阶段已确认它会显示错**，
   修法也定了（按 `target.seq` 判归属，零 store 改动），见 §3.9。
6. **「播放中手动定位会暂停」是行为变更**，会碰 `replayStore.test.ts` 的既有用例
   （§3.5）。改的是**旧语义**，不是放宽断言——提交信息里写明理由。

---

## 八之二、实施记录：工具链抓到的五个错

按时间顺序。**没有一个是靠"想清楚"避免的**——全是跑出来才看见的。

1. **把我自己写的行为回归抓了个正着。** `stepPrev`/`stepNext` 加上「手动定位→暂停」
   之后，我顺手把 `stopTimer()` 提到了边界判断之前，还补了一次
   `commit({ playing: false })`。于是「到尾后再 `stepNext` 是空操作」那条既有用例红了
   ——它断言 `position` 的**引用**没变，而多出来的那次 `commit` 每次都会重新派生。
   **修的是实现，不是测试**：边界时真·一个字段都不动。
2. **一条测试悄悄失去了意义。** 「到尾自动停」原本写 `goTo(9)` 再 `play()`——
   加了「终局不启动」之后，`play()` 直接返回，这条用例**继续绿着却什么都没测**。
   改成从 `goTo(7)` 开播，才是真的在测「播着播着到头了」。**这种"绿着的空壳"
   比红的更危险**，因为它不会来敲你。
3. **反向验证证明我那条断言是废的。** 「播放中改速度不双倍推进」看着挺像回事，
   可我把 `startTimer()` 里的 `stopTimer()` 撤掉之后——**它照样绿**，
   因为旧表的下一次触发落在推进窗口之外。改成 `vi.getTimerCount()` 直接数个数，
   再撤一次，`expected 2 to be 1` 当场红。**任务书 §六 的原话就是「不允许生成
   多个并行计时器」，断言就该直指这个。**
4. **`toHaveLength` 让类型检查漏了 4 处。** `list()` 改了返回形状之后
   `yarn typecheck` 报的 9 个错全在**别的地方**，而这四处 `expect(await x.list()).toHaveLength(...)`
   因为 `toHaveLength` 收 `any` 一声不吭——只有跑起来才红。
   **两道闸门各管各的**，这条是真的。
5. **两处小坑**：`data-testid` 挂在标记的 `<g>` 上（半径在里层 `<circle>`），
   断言得往里找一层；jsdom 里 range 的 `value` 是**字符串**，`toHaveValue(3)` 会红。

6. **探针抓到了我新加的那张高亮卡片**——16 处对比度违规，全部集中在
   `review-verdict-selected` 这一个新状态上。选中态原本写的是
   `border-accent bg-accent-soft`，而卡片里那两行是 `text-faint`：
   **浅色掉到 4.49:1**（判据要 4.5，差 0.01）、**深色只有 3.91:1**。
   改成**只改边框、不动底色**——边框变强调色已经够「适度突出」，而它一个像素的
   对比度都不改。
   **值得记一笔的是**：这正是我在 §3.6 否决「给当前手换 tone」时用的那条理由
   （换底色却不换文字色，对比度就没人算了）——**同一个坑，同一轮里踩了两次**，
   一次在纸上想明白了，一次在代码里没想起来。抓住它的是探针，不是我。

还有一次纯属我手滑：改一条测试时旧的那次点击没删、新的又加了一遍，
于是游标一次走了两格——**是「先钉住游标再谈半径」那条中间断言把它逼出来的**，
否则我会以为是半径算错了。

**反向验证一共做了 5 条**（速度不残留双表、终局不启动、手动定位暂停、
off-by-one、`getTimerCount`），全部按预期变红，跑完即还原。

## 九、验收标准

- 任务书 §二–§十 每一条都能对着代码或浏览器指出落点；
- 17 类测试都有对应用例，且**声称能抓缺陷的那些都做过反向验证**；
- 六条门禁 + 两把棘轮全绿，命令输出如实贴出；
- 十张截图能从探针产物里指出来；
- 交付报告回答任务书 §十二 的六个问题（数据结构有没有变、旧数据能不能读、
  时间轴与速度怎么实现、分析怎么联动棋盘、有没有新的定时器或缓存风险、测试与浏览器验收结果）。
