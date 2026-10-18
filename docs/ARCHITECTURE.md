# 架构

## 分层

```
components / features   ← 展示层，只做渲染与事件转发
        ↓
      store             ← Zustand：对局状态、设置、AI 请求编排、回放与分析管线
        ↓
    analysis → learn    ← 分析结论的纯函数与教学内容（都不碰浏览器）
        ↓
   ai  →  core          ← 引擎与纯规则
        ↓
     browser APIs       ← Worker / localStorage / IndexedDB / WebAudio
```

**依赖方向严格单向**：`components → features → store → ai/core`，`ai → core`。`core` 不依赖任何其他层，也不碰 React、DOM、时间与随机数。这条约束让规则与引擎可以脱离浏览器直接单测。

## 各层职责

**`core/`** —— 纯逻辑。
`types.ts` 常量与类型；`board.ts` 索引换算、边界、读格；`rules.ts` 胜负判定与落子合法性；`game.ts` 对局状态机。全部是不可变纯函数。

**`ai/`** —— 引擎。
`patterns.ts` 单点棋型分析（窗口枚举，含隔子型）；`evaluate.ts` 整盘线段评估；`candidates.ts` 候选点生成；`difficulty.ts` 五档参数表；`transposition.ts` Zobrist 置换表；`threat.ts` 算杀搜索（VCF / VCT）；`search.ts` 搜索主体。`worker.ts` 是 Worker 外壳，`engine.ts` 是主线程侧的请求分发，`browserEngine.ts` 负责把两者接起来。

`search.ts` 内部分成两层，这个分工是刻意的：

- `chooseMove(request)` 是**协议层**——把难度换算成搜索选项、负责 `elapsedMs` 计时。
- `searchBoard(board, player, options, now)` 是**主体层**——不读时钟（`now` 注入）、不改传入的棋盘。

分开是为了可测：注入时钟让超时行为可以确定性复现，不必依赖真实时间，也不会因机器快慢而 flaky。

`threat.ts` 与 `searchBoard` 同样遵守「不改传入的棋盘」这条硬约定（内部先 `slice()` 一份）。

**`bench/`** —— 基准脚本，跑出文档里的全部性能数字（`yarn bench`，独立于 `yarn test`）。它**不参与应用分层**，但会直接依赖 `ai/` 层（搜索、评估、棋型、难度参数），所以 `ai` 改接口时它要跟着改。

**`learn/`** —— 教学内容。
`types.ts` 课程与题目的数据形状；`verify.ts` 判定一手棋有没有达成目标；`hints.ts` 求解与三级提示；`lessons.ts` / `puzzles.ts` 是内容本身；`positions.ts` 是被多处内容共用的局面常量（字符画写法见 `lib/board-lines.ts`）。依赖方向 `features → learn → ai → core`，单向；`learn` 不得被 `ai`/`core` 反向依赖。
**`store` 与 `learn` 之间没有依赖**（`src/store/` 只 import `core` / `persist` / `ai`）——
原先这里写成 `features → store → learn → ai → core` 一条链，把两者串了起来，实际是两条并行的支线。

**共用局面为什么值得单独抽一个文件**：同一个局面会被讲解、练习和题库一起引用（`FOUR_THREE` 就被 5 处用），抄几遍的话改一处必漏几处。但它同时是个陷阱——**两道题共用同一块盘面时，题面很容易照着「我以为的差别」写，而盘面其实一模一样**。第四轮审查抓到过一次，见 `docs/TEST_REPORT.md` 的「二之六」。抽常量之后仍要逐题核对题面描述与盘面是否相符。

**`analysis/`** —— 复盘的纯逻辑。
`analyze.ts` 定义单手结论（`MoveVerdict`：分差 + 可靠度 + 引擎出处）、结论文案与缓存键。**只做纯函数，不发请求**——请求编排在 store 层。结论里没有「最佳 / 失误」这类固定档位：把连续的分差压进几个标签等于替玩家下结论，而且阈值一拍脑袋就会把「稍有出入」说成「失误」。

**`store/`** —— 状态编排。
`gameStore.ts` 是对局与 AI 请求的状态机（工厂函数 `createGameStore(engine)`，可注入假引擎测试）；`useGameStore.ts` 组装真实引擎与存档，是应用唯一的单例入口；`learnStore.ts` 是学习进度与当前视图（工厂函数 `createLearnStore(storage)`，可注入假存储测试）；`settingsStore.ts` 是主题、坐标、音效等偏好；`replayStore.ts` 是回放器（棋谱 + 游标 + 派生局面 + 自动播放 + 播放速度）——**回放位置只有这一个游标**，时间轴、步进按钮、跳到开局/终局、点分析结论跳转全都只经它走，界面上不存在第二份「当前第几手」；`analysisStore.ts` 是分析管线（逐局面排队、请求共享、会话内缓存）；`requestCounter.ts` 是**全局唯一**的请求号计数器——对局、提示、分析三类请求共用它。

**`persist/`** —— 存档。
`storage.ts` 负责对局存档的序列化与**结构校验**（localStorage）；`progress.ts` 负责学习进度、`gameRecords.ts` 负责多局棋谱（两者都在 IndexedDB）——它的 `list()` **从不上抛**（每一步失败都落内存兜底），所以把「读不出来」的两种情形**分开报**：`degraded`（底层不可用，数据来自兜底）与 `skipped`（读到了但没通过校验）。界面靠这两个信号如实说明，不会把两者一起说成「你还没下过棋」；`schema.ts` 是**库名、版本与建表的唯一出处**——两个模块共用一个库，各写一份版本号的话，先打开的那个只建自己的表，另一个同版本打开不触发升级、表不存在，事务失败后被内存兜底吞掉，症状是「界面说已保存、刷新就没了」。两处同一条口径：任何一处不符合预期都当作没有数据，宁可重来也不把半成品灌进状态机。

**为什么分两种存储**：对局存档每次落子都要写、数据小、丢了就丢了；学习进度写得少但**丢了会让人白学一遍**，值得用更耐久的 IndexedDB。进度层在 IndexedDB 不可用时（隐私模式、open 抛错、被其他标签页占用）整体降级为内存态——进度丢了可以接受，白屏不行。

**`lib/`** —— 跨 feature 共用的小工具与小组件级 hook：主题解析、WebAudio 音效合成、动效类名（`motion.ts`）、坐标格式化、类名拼接、媒体查询（`useMediaQuery.ts`）、换页时的焦点接管（`useFocusOnMount.ts`）。**这些模块都没有一个 import store**——要碰 store 的东西属于 `store/` 或 `features/`。（`contrast.test.tsx` 是例外，它为了渲染真实组件才引 store，那是测试的本分。原先这里写的是「无状态工具」，但 `useMediaQuery` 早就是个有状态的 hook 了。）

**`components/`** —— 展示。
`ui/` 是与业务无关的原子组件；`board/` 是棋盘（`Board` + `BoardStage` 容器）；`panels/` 是业务面板；`AppErrorBoundary` 是顶层错误边界。面板全部通过 props 接收数据与回调，不直接读 store。

**`features/`** —— 容器。`shell/` 是六个页面位置共用的外壳：`AppHeader`（品牌 + 导航 + 主题）与 `PageShell`（外壳、滚动策略、两种正文模式）；`battle/` 是对战页，并承载 `status.ts` 这类纯推导逻辑；`learn/` 是课程列表与课程运行器；`puzzles/` 是残局挑战。

**`PageShell` 为什么住在 `features/shell/` 而不是 `components/ui/`**：它要渲染 `AppHeader`，而 `AppHeader` 读 store。放进 `components/` 就成了 `components → features`，与「依赖方向单向 `components → features → store`」相反。同层之间互相引用没有这个问题。

**`PageShell` 的两个模式**（`reading` / `flush`）与**滚动策略**：

| 模式 | 正文 | 谁在滚 | 用在 |
| --- | --- | --- | --- |
| `reading` | 居中限宽列 `max-w-3xl` | `<main>`（顶栏在它**外面**） | 教学 / 残局 / 复盘的列表页 |
| `flush` | 自己管栅格（`wide-layout` 起两栏：棋盘 + 344px 侧栏） | 页面自己 | 课程讲解、练习、残局详情、复盘回放 |

**顶栏必须在滚动容器外面**，而不是靠 `position: sticky` 兜底：sticky 只在「最近的可滚动祖先」里生效，而列表页在 ≥1024 时滚的是内层 `main`、<1024 时滚的是文档——把顶栏放进滚动容器，这两种情况下它的行为就不一样了。放进外壳、与正文平级，两种宽度下都不用 sticky 也永远在。

**对战页不用 `PageShell`**：它是棋盘优先布局（≥1440 多一档三栏、中列棋盘吃剩余高度），硬套一个「阅读列」的壳只会两边都不像。

但**它的两栏条件与其余三页共用** `wide-layout`——这一点是 Phase 05 验收时才对齐的，原先它自有一套 `lg:` 断点，与共享件 `BoardStage` 的解除条件不一致，768–1023 横屏下棋盘会塌成 0×0。来龙去脉与实测见 `docs/ui-redesign/PHASE_05.md` §15.1。

## 关键数据流

```
点击交叉点
   ↓
Board.onPlay(point)
   ↓
GameStore.playHuman → core.applyMove → 新 GameState（version + 1）
   ↓
轮到 AI 时 requestAiMove：分配 requestId，记下当前 gameVersion
   ↓
AiEngine.search → postMessage → Worker.chooseMove（主线程不受影响）
   ↓
postMessage 回来 → engine 按 requestId 找到挂起的 promise
   ↓
GameStore.applyAiResponse：校验 requestId 与 gameVersion，两者都对上才落子
```

```
请求提示（只在玩家回合可用，与落子共用同一道门槛）
   ↓
ControlBar.onHint → GameStore.requestHint（purpose: 'hint'，固定 800 ms 短预算；入口是工具栏上那颗「求提示」，
`HintPanel` 只负责渲染候选，它的 props 里没有 `onAsk`）
   ↓
AiEngine.search → Worker.chooseMove（走同一条引擎、同一套过期校验）
   ↓
GameStore.applyHintResponse：只写 hint / hintUrgency，**不调用 applyMove**
   ↓
Board.marks → 棋盘上按推荐顺序画编号 1/2/3 的标记
```

```
一局结束（五连 / 和棋 / 认输）
   ↓
gameStore 的 notifyGameEnd：只在「进行中 → 终局」这一跃迁上回调
   ↓
useGameStore 装配的 onGameEnd → indexedDbGameRecords.put（棋谱库）
   ↓
recordSaveState: saving → saved / failed —— 结果弹窗如实显示
```

```
复盘页打开一局 → replayStore.open
   ↓
position = replay(moves.slice(0, cursor))（纯派生，游标是唯一可变状态）
   ↓
点「开始分析」→ analysisStore 逐局面排队（每手 1 个请求，相邻手共享后续局面）
   ↓
AiEngine.search（purpose: 'analyze'，与对局共用同一个 Worker 与全局请求号）
   ↓
响应按 moveIndex 配对 → buildVerdict（loss = engineScore − (−对手评分)）
   ↓
面板按分差排序列出前 3 手，标注引擎版本 · 档位 · 预算
```

## 教学内容的判定模型

课程练习与残局题共用一套结构（`learn/types.ts` 的 `Practice`）：**题目只声明局面与目标，不声明答案坐标**。

```ts
type PuzzleGoal =
  | { kind: 'win' }                                  // 一手成五
  | { kind: 'blockFive' }                            // 堵掉对手的成五点
  | { kind: 'makeShape'; shape: ShapeKind }          // 做出指定棋型
  | { kind: 'doubleThreat' }                         // 双四 / 四三 / 双活三
  | { kind: 'forcedWin'; maxPlies: number }          // 某条强制取胜路线的第一步
```

判定（`verify.ts` 的 `judgeMove`）用引擎自己的棋型分析与算杀去证明这一手是否达成目标。三个好处直接落袋：

1. **多解是自然结果**，不需要把每种正确走法都列出来。
2. **出题人没有机会把答案写错**——没有答案表可写。
3. **求解器（`solveMove`）建立在判定器之上**，所以「题目可解」与「玩家做对」用的是同一把尺子，不可能出现「提示指的那一手被判错」。

`content.test.ts` 是这套模型的验收装置：它把全部课程与题目逐个跑一遍求解器，任何一道无解、任何一道开局就已经分出胜负、任何一处手数奇偶对不上，都会在那里被点名。

**`forcedWin` 的判定必须在落子前的盘面上做**（`isForcedWinStart`），不能拿落子后的盘面去调 `findForcedWin`：那个函数假定「传进来的盘面轮到攻方走」，而玩家落子之后轮到的是对手——等于白送一手，会把输棋判成赢棋。

## 并发的六条关键约定

**过期响应必须丢弃。** 每个 AI 请求带 `requestId`（只增不减，跨对局也不重复）与 `gameVersion`（发起时的局面版本）。响应回来时两道闸门都要过：`requestId` 必须是当前在飞的那一个，`gameVersion` 必须等于当前棋局版本。悔棋、重新开始、切换执子都会把 `pendingRequestId` 置空，于是所有在飞的旧响应全部作废。这个判断位于 store 的纯函数 action 中，可以脱离浏览器直接单测。

**玩家点击必须被正确忽略。** `playHuman` 在三种情况下直接返回：对局已结束、不是玩家的回合、AI 正在思考。加上棋盘组件的 `interactive` 控制，不会出现同色连下两手或卡在「AI 思考中」。

**引擎失败不能让对局卡死。** Worker 报错时挂起的请求以错误结束，store 把 `aiThinking` 复位、记下错误，并**不动棋局**。AI 面板随即显示错误；只要还轮到 AI 走，面板就会给出「重试」入口，点击即用同一个局面重新发起请求。

这里不能省掉重试：如果只给一句「知道了」，AI 欠着的那一手永远补不上（`playHuman` 被 `canHumanPlay` 挡住），玩家执白时更是连悔棋都没有（盘上只有 AI 的着手，`canUndo` 为假），只剩重开或认输两条路。

**存档必须能还原「结果」。** 手顺能还原出胜负与和棋——最后一手就在手顺里。唯独认输还原不出来，所以 `PersistedSession` 单独存一个 `resignedBy`（由 `winner` 反推）。少了它，认输后刷新页面会让这局复活成进行中，AI 还会接着往下走。

**分析与对局共用同一个 Worker，但绝不改变棋局。** 分析请求 `purpose: 'analyze'`、`gameVersion: 0`：它的过期校验走**三重闸门**——响应必须属于当前这一次分析（`runId`，每次 `start` 递增）、是当前在飞的那一个（`inflightIndex`）、且手序号与局面版本对得上（`moveIndex` / `gameVersion`）。只比手序号是不够的：每一次分析的序号都从 0 开始，上一局的迟到响应会被下一局当成自己的。三类请求（落子 / 提示 / 分析）的 `requestId` 全部来自 `requestCounter.ts` 的同一个计数器——分成多个计数器迟早撞号，撞号意味着迟到的分析响应可能被当成对局请求去兑现。分析只在复盘页发起，串行排队、同一时刻最多 1 个在飞，400ms 预算有界，不会长时间占住 Worker。

**提示请求与落子请求必须彻底隔离。** 两者走同一条引擎、同一套过期校验，但分别记在 `pendingHintRequestId` 与 `pendingRequestId` 上：**提示在飞时玩家照常落子**（`canHumanPlay` 不看提示状态）。（请求号仍来自同一个只增不减的计数器——分成两个计数器迟早会撞号，撞号意味着迟到的提示响应会去兑现落子请求。）

**反过来的方向是不成立的，这是有意的**：`requestHint` 与 `playHuman` 共用同一道门槛 `canHumanPlay`，所以在 AI 思考期间（以及 AI 报错卡住、手番仍在 AI 时）求提示会被直接拒绝。理由很直接——手番不在玩家，800 ms 算出来的建议在 AI 落子后必然作废，那份计算没有任何用处。两个方向不对称，不要把它读成对称的。

隔离的目的是**提示绝不能改变棋局**。三条硬约束：

1. `applyHintResponse` 里**没有 `applyMove`**。引擎返回的提示响应其实带得有着法（`chooseMove` 不区分用途），所以「提示被误当成落子处理」这类错误会直接在棋盘上留下棋子——`gameStore.test.ts` 里那条测试特意用带真实着法的响应来钉住这一点，而不是靠 `move === null` 顺手挡掉。
2. 提示用固定的短预算（`HINT_BUDGET_MS = 800`）单独算一遍，不占 AI 正式走子的预算。
3. 局面一变（落子 / 悔棋 / 重开 / 认输 / 恢复存档）就整体清空提示。高亮必须跟着局面失效，否则玩家会对着一个已经不存在的局面做决定。玩家落子时 `pendingHintRequestId` 一并清空，于是在飞的提示响应回来时自然对不上号，被丢弃。

`Board` 的标记**原样渲染，不做过滤**——包括画在已有棋子上的点。这里曾经有一条「跳过已占用交叉点」的兜底，本意是防提示过期，实际后果是判题反馈的标记被静默吃掉、什么都不报。一致性改由调用方负责，而两个调用方本来就满足：提示与练习的标记都在局面变化的那一刻清空。

## 棋盘渲染

整张棋盘是一张 SVG，`viewBox` 覆盖棋盘本体加一圈留白。交叉点在 SVG 用户坐标里就是整数 `(x, y)`，不需要任何百分比换算，坐标标签、星位、棋子、连线全部共用同一套坐标。

棋子用径向渐变加一枚椭圆高光，配一个偏移的暗色圆作假投影——比 `filter: drop-shadow` 便宜得多，棋子多了也不会掉帧。

**最后一手是「与所在棋子反色的小点」**（黑子上用 `--c-stone-white-a`、白子上用 `--c-stone-black-b`，半径 0.13 格）。
Phase 03 之前它是一圈 `--c-danger` 的红环：`danger` 是「认输 / 错误 / 判错」的颜色，而最后一手只是正常的落子；
量上也站不住——环的着墨相当于一颗棋子的 36%，却是整块棋盘上**唯一带色相**的东西。
换成点之后着墨少 76%，两色棋子上都清楚（对比度 ≥ 3:1，探针判据 7 守）。

**标记徽标的形状跟着标签走**：一个字是圆，两个字以上就是同高、圆角等于半径的 pill
（`badgeWidth()`）。硬约束是**半宽 < 1 格**——相邻交叉点在 1 格外，半宽不到一格就永远盖不到相邻棋子的**中心**。
为什么不让文字缩进固定的圆里：`DESIGN_SYSTEM.md` §8.2 定了「棋盘文字在最小支持视口下不得小于 10px」的硬下限，
390 下字号已经贴着它，3 个字塞进直径 17px 的圆只能到 5.7px——此路不通。**让底色随文字生长**。

**命中区是按格铺开的正方形**，边长一整格，相邻格子严丝合缝。用圆形热区会在相邻交叉点之间留下死区。这里有个容易踩的坑：`pointer-events: all` 的命中范围是「内部 + 周界」，而未指定 `stroke` 时 `stroke-width` 的初始值是 1，每个格子会向外多出半格，导致点在交叉点正中反而落到右下相邻那一格——所以必须同时把 `strokeWidth` 置 0。

**自适应尺寸**用 CSS 容器查询：容器声明 `container-type: size`，棋盘取 `width: min(100cqw, 100cqh)` 配 `aspect-ratio: 1`，即「能容纳的最大正方形」，不需要 JS 测量。

**字号与半径解绑**（`BoardMark.fontSize`）：徽标高度是 `2r`，字号不必等于
`radius × 1.25`。回放编号因此能在保持小半径（棋子仍露在外面）的同时把字号提到
0.51 单位——@390 约 10.84px，守住 `DESIGN_SYSTEM` §8.2 的 10px 下限（F-UI-14）。

**布局预算由 e2e 钉住**（`e2e/layout.spec.ts`）：任何视口棋盘 ≥ 320px 且为正方形；
≥1024 时 ≥ 620px；两栏/三栏下棋盘与侧栏互不压盖。高度极小的横屏窗口（900×480）
物理上放不下 `320 + 顶栏 + 工具栏`，是已知例外（`ui-redesign/KNOWN_ISSUES.md` M-3）。

## 键盘与无障碍

可交互时棋盘是 `role="grid"`：每行一个 `role="row"`，每个交叉点一个 `role="gridcell"`。gridcell 必须有 row 作上下文，平铺 225 个 cell 是无主的；只读棋盘（复盘）退回 `role="img"`，不谎报有交互。

**roving tabindex**：整盘只有一个 `tabIndex=0` 的停靠点（默认天元），其余为 -1。方向键移动焦点、`Home`/`End` 跳到本行两端、`Enter`/`空格` 落子，越界即停不绕回。移动时**必须真的调 `focus()`**——读屏跟的是真实焦点，只改 `tabIndex` 等于原地打转。两处克制：挂载时不抢焦点（页面加载就把焦点拽到棋盘上对读屏用户是绑架），以及轮到 AI 时若玩家已把焦点 Tab 到别处（例如悔棋按钮），思考结束也不抢回来。

**播报只有一处**：`BoardAnnouncer`（`role="status"`）说清「最后一手在哪」与「为什么按了没反应」（AI 思考中 / 等待对手）。状态药丸是同一份信息的可见版本，**不是** live region——两个 live region 会把同一件事念两遍。终局文案直接复用 `describeStatus`，避免同一屏幕上两种说法。

**焦点环是画出来的 SVG 元素，不是 CSS 的 `outline`**：SVG 里 `outline-width` 与 `outline-offset`
按**用户坐标**解释（1 单位 = 一整格），`outline: 2px` 于是成了两个格子宽的边框，焦点框能横跨半个棋盘。
`index.css` 里把 `svg [role='gridcell']:focus` 的 outline 关掉，改由 `Board` 画一枚 `focus-ring`
（半径 0.56 格）。这枚环是**双色**的——主色环 `--c-focus-ring` 套一圈反色晕 `--c-focus-halo`：
它可能压在木纹两端或黑白棋子上，单色环总有一种底色会糊掉（浅色主题的深绿压在黑子上 2.25:1，
暗色主题的浅绿压在白子上 2.4:1），判据是两者之中至少有一个达到 WCAG 1.4.11 的 3:1，
由 `lib/contrast.test.tsx` 对四种底色逐一守住。它只在棋盘**真的握着 DOM 焦点**时显示（`focus` / `blur` 监听挂在 `<svg>` 上一对，
不是每格一个——225 个处理器会把每次焦点变化都变成整盘重建）。

**配色有对比度守卫**：`lib/contrast.test.tsx` 直接读 `index.css` 的原文，按两套主题逐对核算
WCAG AA 的 4.5:1。`faint` / `good` / `warn` / `accent` 的值就是按它反推出来的，改色前先跑它。

**动效降级不判 `matchMedia`**：`motion.ts` 只返回类名，是否播动画交给 `index.css` 的 `@media (prefers-reduced-motion: reduce)`。用 JS 判有两个坑——用户中途改系统设置时分支不会更新；jsdom 里 `matchMedia` 缺失，靠它判定会让测试与真实行为脱节。

**布局可以判——但只在一处、且必须订阅。** 对战页 1440 这个断点由 `lib/useMediaQuery.ts` 判，
因为它决定的不是样式而是**设置面板渲染在哪一栏**：用 CSS 各写一份、靠 `display:none` 切换的话，
同一组表单控件在 DOM 里会有两份，而组件测试不加载样式表，`hidden` 在 jsdom 里根本不生效
（读屏软件与 Playwright 的 `getByRole` 都会正确地跳过 `display:none` 的子树，**受害的只有单测**）。

上面那两条理由在这里逐条对应：

1. **「中途改设置不更新」不成立**——那个 hook 用 `useSyncExternalStore` 订阅 `change` 事件，
   拖动窗口跨过断点、换外接显示器都会跟着更新。这是它与 `motion.ts` 那处的关键区别：
   动效无论如何都得由 CSS 决定，而布局这件事 CSS 做不到。
2. **「jsdom 缺失 → 测试与真实行为脱节」是真代价，由 e2e 付**——宽档分支永远不被单测覆盖，
   它由 `e2e/layout.spec.ts` 在真浏览器里守（1440 有左栏 / 1439 没有 / 四个宽度下设置面板
   恰好一份），另加一条反向验证（把常量从 1440 改成 1280，断言必须红）。

**约束：断点值全仓只允许出现在 `BattleScreen` 的 `WIDE_QUERY` 一处**，CSS 里不得再写
一个 1440 的媒体查询。

## 错误边界

`AppErrorBoundary` 包在 `App` 外层（`main.tsx`），用 class 组件实现——这是框架约束不是风格选择，React 只有 `componentDidCatch` / `getDerivedStateFromError` 两个 class 生命周期。

兜底界面刻意用**最简 DOM 加内联样式**：不碰 store、不碰主题变量、不碰自有组件。它是最后一道防线，自己再依赖什么就可能跟着一起坏，那就真白屏了。

## 主题

浅色与深色两套 CSS 变量分别挂在 `:root` 与 `.dark` 上，经 Tailwind v4 的 `@theme inline` 暴露成语义色（`bg-surface`、`text-muted`、`border-border`）。组件里不写 `dark:` 前缀，切主题只改 `<html>` 上的一个类。棋盘木纹、棋子渐变同样走 CSS 变量，所以两套主题共用同一份 SVG。

**主题不只改类**：`applyTheme()` 同时更新 `meta[name=theme-color]`（深色 `#0f1115` /
浅色 `#f6f4f0`，与 `--c-bg` 同源）。移动端浏览器拿这个值画地址栏——不更新它，
深色主题下会一直挂着一条浅色横条（F-UI-17）。

**安全区内边距**：`index.html` 开了 `viewport-fit=cover`，根容器用
`env(safe-area-inset-*)` 避开横屏刘海与底部手势条；无刘海设备上 `env()` 为 0。

## 测试策略

| 层 | 工具 | 覆盖重点 |
| --- | --- | --- |
| `core` | Vitest | 五连全方向、边缘、长连、重复落子、终局后落子、满盘和棋、悔棋 |
| `ai` | Vitest | 立即取胜、必防对手、活三应对、候选生成、超时回退、评估函数单调性、棋型识别（含隔子型）、置换表与注入时钟、算杀不误报、自对弈可复现 |
| `store` | Vitest | 过期响应丢弃、人机悔棋撤销一轮、终局拒收落子、存档恢复后续走、提示请求不落子且不挤占落子通道 |
| `persist` | Vitest | 序列化往返、各类损坏数据的降级 |
| `components` | Vitest + Testing Library | 225 个交叉点、点击落子、终局禁点、最后一步与胜利标记、坐标开关、标记的编号与色调 |
| `learn` | Vitest | 五种目标的判定与错误理由、求解器与判定器口径一致、三级提示、**全部课程与题目的可解性自检** |
| `features` | Vitest + Testing Library | 练习的判定与重试与锁盘、三级提示的揭示节奏、课程翻页与棋盘演示、残局进度 |
| 端到端 | Playwright（本机 Chrome） | 完整对局流、命中位置正确性、悔棋、重开、刷新恢复、认输、提示标记的出现与消失 |

`core` 与 `ai` 的测试全部针对纯函数，不 mock 任何东西。`store` 的测试注入一个可以精确控制应答时机的假引擎，用来构造各种「响应迟到」的时序。
