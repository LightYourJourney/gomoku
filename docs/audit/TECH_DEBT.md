# 技术债与扩展性压力测试（Phase B 续 · Phase D）

> **归档文件（审计快照）**：与同目录的 `FINDINGS.md` 是同一批产物，审计对象是 HEAD `4987c33`。
> 内容停在那一刻——**不是当前状态**；文中的「新增」「待办」都是当时的设计分析。

本文件回答两个问题：**哪些债在复利**，以及**四个假设的新功能会撞到什么**。

Phase D 只做**设计级影响分析**，不开发任何新功能。

---

## 第一部分 · 技术债总表

### 1.1 已声明的债（仓库文档里写了）

`docs/ROADMAP.md` 与 `docs/AI_ENGINE.md` 记录了 14 条已知不足。**本轮逐条复核，全部属实**（明细见 `FINDINGS.md` §4）。此处只按「复利速度」重排：

| 债 | 位置 | 复利速度 | 说明 |
| --- | --- | --- | --- |
| **专家档在中盘的宽局面上够不到深度上限（8 层）** | `ai/difficulty.ts:79`（`expert.depth`） | **快** | 构造基准最多 6 层、真实对局中盘观察到 7 层；**开局（盘上 3–5 子）与接近满盘的窄局面能搜满 8 层**（`AI_ENGINE.md` 已知局限第 1 条）。真正的瓶颈是**着法排序**不是整盘评估（第 5 条，Phase 10B 测量、10C 优化后依旧约占七成），但**改动它要同时面对正确性与性能两个约束**，且性能数字必须能 `yarn bench` 复现 |
| **局面评估不识别跨方向组合形状** | `ai/evaluate.ts` 的 `evaluateBoard` / `scoreSegment` | **快** | 与上一条同源：都在 `evaluate.ts`。做增量评估时顺手做掉最划算 |
| **着法排序把双四 / 四三与单冲四同分** | `ai/patterns.ts` 的 `threatScoreWith`（搜索着法排序） | **中** | `AI_ENGINE.md` 已知局限第 7 条：只要有冲四就返回 14,000，排在双活三之后；内部节点按宽度截断时这类必胜着可能被剪掉（目前是推断，未构造出漏杀实例）。**2026-11-25 全量审查查出、待专门的引擎阶段处理**——改排序即改搜索决策，按约定要递增 `ENGINE_VERSION` 并跑棋力 / 战术 A/B |
| ~~学习进度无迁移机制~~ | `persist/progress.ts` | — | **2026-10-31 已偿还**：`migrateProgress` 逐级迁移 + `PROGRESS_MIGRATIONS` 注册表；仍不认识的版本/缺步骤一律拒绝，不猜。另：认不出的 `lastView` 回落到对战页，不再丢弃整条进度 |
| 不算 VCT、活三链只允许一层 | `ai/threat.ts:38`、`difficulty.ts` 的 `threatThrees: false` | 慢 | 有意的漏杀，有实测数据支撑决策，不随时间恶化 |
| 分析缓存只在页面打开期间有效 | `store/analysisStore.ts:108` | 慢 | 设计取舍，不是遗漏 |
| 分析固定中级档 + 每局面 1,000 ms、同时只分析一局、满盘末局无结论 | `ReviewScreen.tsx:349`、`analysisStore.ts:29,113` | 慢 | 同上。0.7.1 起由初级档 400ms 改为中级档 1,000 ms（裁定 22） |
| 回放游标不持久化（有意） | `store/replayStore.ts` | — | **不是债**，是产品决策 |
| ~~基准不做断言、无 CI 门禁~~ | `bench/engine.bench.ts` | ~~中~~ | **2026-10-13 已偿还**：`yarn bench:check`（`bench/gate.mjs` + `bench/baseline.json`）断言余量充足的行与机器无关的不变量，`.github/workflows/quality.yml` 里跑。**保留残余**：耗时列仍只打印不判定——那部分仍然靠人看 |
| 子路径部署无自动化用例 | `vite.config.ts:63` | 慢 | 靠 README 的两条 `grep` 兜着 |
| 复盘页对读屏用户只是一张图 | `ReplayBoard.tsx` | 慢 | 要做需要先设计一套可读的逐步导航 |
| Web Worker 降级：极老浏览器无回退路径 | `ai/browserEngine.ts` | 慢 | 目标浏览器不明确，暂不处理 |

### 1.2 未声明的债（本次新发现）

> **本节是审计当时的快照，八条已全部了结**，保留它是为了看清「当时判断哪些值得记」：
> F-03 / F-02 / F-12 / F-14 / F-15 / F-17 已偿还；F-16 **经复核是误报、已撤回**
> （实测 oxlint 1.87 默认就开着 `react-hooks/exhaustive-deps`，见 `FINDINGS.md` §2）；
> 文档矛盾那条也已消解（`ROADMAP.md:68` 已同步 `AI_ENGINE.md` 的更正）。
>
> **「位置」一列的行号是审计当时的**，代码改过之后不再指向原处——核对时以符号名为准，
> 不要按数字找。下一节 §1.3 与 §2 是仍在案上的，那部分才会随代码更新。

| 债 | 位置（审计当时） | 复利速度 | 详见 |
| --- | --- | --- | --- |
| **`gameRecords` 用 `request.onsuccess` 判定「已落库」** | `persist/gameRecords.ts:252-274,298-307` | **中**（一旦触发就是「界面说存了、刷新就没了」，属欺骗性失败） | F-03 |
| **`Modal` 声明 `aria-modal` 却无焦点陷阱、无焦点还原** | `components/ui/Modal.tsx:14-27` | 慢 | F-02 |
| ~~lint 未启用 `react-hooks/exhaustive-deps`~~ | ~~`.oxlintrc.json`~~ | — | ~~F-16~~ **已撤回（误报）** |
| **`settingsStore` 的 `persist` 无版本、无校验** | `store/settingsStore.ts:15-27` | 慢 | F-12 |
| **`ROADMAP.md:67` 与 `AI_ENGINE.md:281` 在同一个事实上互相矛盾** | 两份文档 | **中**（文档矛盾会让人不知道该信哪份，进而两份都不信） | FINDINGS §4 末 |
| `threatPlies` 偶数档 ≡ 下面那个奇数档 | `ai/difficulty.ts:60,69,78`（现为 65/74/83） | 慢 | F-14 |
| `isWinningPoint` / `analyzeFast` 对已占用点的隐式前置条件无文档无断言 | `ai/patterns.ts:91` | 慢 | F-15 |
| `useGameStore.subscribe` 无 selector，任何 state 变化都写 localStorage | `store/useGameStore.ts:38-51` | **中**（手顺越长写得越多，且 `subscribe` 的触发频率只增不减） | F-17 |

### 1.3 明确**不**偿还的「债」

以下项常被工具或直觉判成债，经审读后判定**不应处理**（理由见 `FINDINGS.md` §6）：

- 49 个只被签名引用的类型导出、36 个只被测试引用的导出
  —— **2026-10-13：前者已由 `knip.jsonc` 的 `ignoreExportsUsedInFile: { type, interface }` 整类放行**。
  这是一条**裁定**，不是遗漏：再有人问「为什么 knip 不报这些」，答案是这份 §1.3。
  （同文件里 `verify.ts` 那个 `export const OK` 是**真**多余的导出，已修——`variable` 种类不在放行之列。）
- `Board.tsx` 的 **681 行**（2026-10-19 复核；建单时 565 行，Phase 03–06 增加了
  标记字号解绑、最后一手反色点与胜利环）；225 个命中 `<rect>` 与每格一个 `onKeyDown`
- **`.jscpd.json` 里被豁免的文件**——2026-10-13 建门禁时是 6 个，**2026-11-15 全仓审查后降到 2 个**：
  - `lessons.ts` ↔ `puzzles.ts`（两处各 21 行）：克隆的是**内容数据字面量的形状**
    （`prompt:` + `board(BLANK, BLANK, …)`），不是逻辑。要消除它就得为数据造一层 DSL。**仍豁免。**
  - ~~`gameRecords.ts` ↔ `progress.ts`（33 行）~~：克隆的其实只是「选 IndexedDB 工厂」与
    「打开库 → 跑一次事务」这两段通用样板，与两个存储层的语义无关。去掉豁免实测还盖住了
    `gameRecords.ts` ↔ `positions.ts` 两处**没登记**的新克隆。已收进 `persist/idb.ts`
    （`resolveIdbFactory` / `storeRunner`），**豁免撤销**。
  - ~~`LearnScreen.tsx` ↔ `PuzzleScreen.tsx`~~：去掉豁免实测 0 处克隆，**豁免撤销**。

  **这个数字只减不增**：再加豁免必须同时给出「为什么这两处不能合并」的一句判断，
  并且**加进这份清单**。加到覆盖了大半个 `features/` 时，这道闸门就只剩装饰作用了。
  **豁免整个文件会连带放过它与任何其它文件之间的新克隆**——上面那两处就是这么溜过去的，
  所以每次审查都要去掉豁免实跑一次，看豁免盖住的是不是仍只有登记过的那几处。
- ~~教学/题库不拆出主包~~ —— **2026-11-18 阶段 C 已拆**：教学、残局、复盘、分享预览按页加载，
  入口 gzip 从 132 kB 降到 98 kB（`TEST_REPORT.md`「〇之二八」）。
- `noUncheckedIndexedAccess` 未开
- 两套棋型分值表、两种「三」的口径、`threatScoreWith` 里那次看似多余的 `analyzeRuns`
- 不用路由库；~~无 CI 配置（后者是产品决策，不是缺陷）~~
  —— **2026-10-13 有 CI 了**（`.github/workflows/quality.yml`，见本文件 §1.1 与 `AGENTS.md` 的「两道闸门」）。
  **2026-11-18 阶段 C 改写**：原来这一条是「无 router」，把「不用路由库」与「不进浏览器历史」绑在一起裁定了。
  现在导航进历史、有深链接（路径路由，`lib/routes.ts` + `store/navigationStore.ts`，不到两百行），
  **仍不引入路由库**——四个页面、三类子页面，解析与格式化是两个纯函数，用不上。

---

### 1.4 2026-11-15 全仓两轴审查：**仍在案上**的（已修的见 `TEST_REPORT.md`「〇之二三」）

十个只读审查员（五块 × 标准 / 规格两轴）逐文件读过 HEAD `85eab63`，每条发现都由主控复核过。
下面是**复核属实、但本轮没动**的，按「会不会骗用户」排序。没动的理由写在最后一列——
大多是「改了要做真实浏览器目视复核或重跑基准，本轮不打包进来」，不是「不值得改」。

| 债 | 位置 | 为什么本轮没动 |
| --- | --- | --- |
| 一屏多于一个 `primary`（违反 DESIGN_SYSTEM §6.1「≤ 1」） | 局面编辑器：选中的工具与「下一手」也画成 primary（`PositionEditor.tsx` 工具区）；空棋谱库：「导入文件」与「开始一局对战」；带演示的讲解页：「下一手」与「下一步」 | 选中态要换成分段控件那套视觉，属界面改动，需探针重拍 + 目视复核 |
| 20px 间距（`p-5` / `mt-5` / `mb-5` / `py-5`）与行间 `space-y-0.5` 不在 4px 栅格白名单内 | `Modal.tsx`、`PageHeader.tsx`、`PageShell.tsx`、`MoveList.tsx` | 同上：动的是全站弹窗与页头的版式 |
| 规范外的第三级阴影 `shadow-sm` / `shadow`、`bg-white` 写死 | `Segmented.tsx`（选中项）、`Switch.tsx`（滑块）、`AppHeader.tsx`（品牌标记） | 去掉后选中项与滑块的可辨识度要重新目视确认 |
| 顶栏与遮罩用 `backdrop-blur`，接近 §1「不做玻璃拟态」 | `AppHeader.tsx`、`Modal.tsx` | 判断题，留给下一次界面迭代裁定 |
| 原始异常消息直接进界面，可能露出英文 | `DataManagementPanel.tsx`、`PositionEditor.tsx`、`GameLibrary.tsx`、`ReviewScreen.tsx` 里的 `error.message` | 要先列出每条路径可能抛的错，再决定翻译表还是统一兜底文案 |
| ~~复盘分析与编辑器分析没有响应超时兜底（落子与提示有）~~ | `analysisStore.ts`、`editorStore.ts` | **已修**：两处都已走 `store/searchDeadline.ts` 的 `withDeadline`（15 秒硬上限），到时以超时错误取消请求 |
| 置换表跨迭代的条目基本用不上（`probe` 深度不足即未命中，上一轮存的恰好少 1） | `transposition.ts` 的 `probe`、`search.ts` 内部节点的 `cached?.move` | 改了会动着法排序与节点数，按 AGENTS 要走 `yarn bench` + 固定深度 A/B，属引擎迭代 |
| 判题只认冲四开路的杀（`allowThrees: false`），以活三开路的真杀会被判错 | `learn/verify.ts` 的 `forcedWin` | 实测现有 4 道算杀题在 VCT 口径下可接受着法集合不变；改成 VCT 最坏单次判题 1.2 s，与判题预算 2 s 太近。判错理由已改成如实说「没找到冲四取胜路线」 |
| 分享链接内层 `v` 不符 / 顶层是数组时报 `invalid_data`，与 `LINK_FORMAT.md` §5 的分类不完全一致 | `sharing/link.ts` 解码 | 用户看到的都是「打不开」，分类差异只影响错误码；与文档一起裁定 |
| 带 provenance 的近满盘局面（约第 223 手以后）分享会超过 12,000 字符 | `toPositionFile` + `link.ts` | 会体面失败并提示改用文件导出；`LINK_FORMAT.md` 只承诺整盘与自由局面 |
| 局面文件的超大 / 过深 / 未来版本统一报 `invalid_field` | `persist/transfer/position.ts` | 与 `IMPORT_SECURITY_REPORT.md` 的错误码表不一致，界面文案已说清原因 |
| 战术判据（`criterionOf` / `judgeMove`）没有自测 | `bench/strength/tactics.ts` | 评测器自身，按 AGENTS 应纳入 `yarn test`；本轮未补 |
| 复盘 / 讲解等详情页的工具栏与侧栏前缀抄了 5–6 份，`order-2` / `order-3` 已不一致；黑白称呼映射内联 9 处 | `features/*` | 判断题（重复代码）；jscpd 看不见（改了标识符的复制） |
| e2e 辅助函数重复（`playNineMoveWin` ×3、`holdAiInThinking` ×2） | `e2e/*.spec.ts` | `e2e/helpers/` 已存在，可以收；jscpd 不扫 `e2e/` |
| 内容数据里两条完全重复的课程练习用例 | `learn/lessons.test.ts` 与 `content.test.ts`（后者已覆盖全部课程） | 删用例会动条数棘轮，需要显式下调基线并说明；留给下一次清理 |

## 第二部分 · 扩展性压力测试（Phase D）

对四个假设功能做设计级影响分析。**不实际开发。**

评分含义：
- **受影响模块**：需要改动的模块清单
- **接口破坏风险**：现有签名/契约是否必须改
- **修改扩散**：改动是否只落在一处

---

### D-1 · 添加禁手规则（黑棋三三 / 四四 / 长连禁手）

#### 受影响模块

| 模块 | 需要做什么 | 是否必须改现有签名 |
| --- | --- | --- |
| `core/types.ts:27` | `MoveError` 增加 `'forbidden'` 变体 | **是**（联合类型扩展；无 exhaustive switch，所以不会强制全仓处理） |
| `core/rules.ts:8` | `validateMove(board, p)` → 需要知道**轮到谁**（禁手只对黑棋生效） | **是**——函数签名要加第三个参数 |
| `core/rules.ts:21` | `findWinLine` 返回**整段**连续子；长连禁手要求「6 子对黑方 = 输」 | 否（返回值不变），但**调用方语义变了** |
| `core/game.ts:52,91` | `replay` / `applyMove` 要把 `current` 传给新检查 | 否 |
| `ai/patterns.ts:108-141` | `scanLine` 的「存在一个全己方的 5 窗口 = 成五」对长连禁手**不再等价于赢** | 否（内部语义） |
| `ai/search.ts` / `ai/candidates.ts` | 黑方不能走禁手点：候选点要过滤 | 否 |
| `ai/evaluate.ts` | 评估里没有「禁手风险」这个概念 | 否 |
| `learn/verify.ts:72` | 现在写着「不论目标是什么，成五了就是做对了」——对黑方长连禁手**这句话就错了** | 否 |
| `learn/types.ts` | `ShapeKind` 需要新增 `'overline'` | 是（联合扩展） |
| `components/panels/*` | `MoveError` 的新变体要有中文文案 | 否 |
| `components/board/Board.tsx` | 可视化禁手点（可选） | 否 |
| `docs/RULES.md:20`（「**无禁手**」）、`AI_ENGINE.md`、`ARCHITECTURE.md` | 全部要改 | — |
| 现有测试 | `core/rules.test.ts` 与 `core/game.test.ts` 里**锁住「长连有效」的用例要反过来** | — |

#### 接口破坏风险：**中**

唯一真正的签名破坏是 `validateMove` 缺 `player`。三个调用点（`game.ts:52`、`game.ts:91`、`verify.ts:66`）**都已经握着 `player` 或 `current`**，所以是 3 处一行的改动。

#### 修改扩散：**不扩散，但要重新论证**

禁手是**规则层的概念**，改动主体落在 `core/rules.ts` + 一个新的 `core/forbidden.ts`。`ai` 层只需要「尊重 `validateMove`」。这正是分层做对了的样子。

#### 真正的设计问题（两个）

1. **`replay` 把「非法手」当作「截断点」（`core/game.ts:51-52`）。** 今天非法手只可能是越界或重复落子——都是**损坏的存档**。加了禁手之后，「合法存档 + 后来改了规则」也会走到这条路径，**症状是静默吞掉整局的后半段**，而不是报错。
   → 这不是禁手引入的问题，是**既有的容错策略在新语义下变得危险**。若真要做禁手，应同时把 `replay` 的容错改成「返回截断位置 + 原因」，让调用方决定。
2. **「成五」这个谓词在两个地方被当作「赢」用**：`ai/patterns.ts` 的 `scanLine` 与 `learn/verify.ts:72`。加了长连禁手之后，二者都要区分「恰好五个」与「五个以上」。
   → **这是真正违反单一职责的地方**：`WinCondition`（什么算赢）没有集中定义，而是散在 `core/rules.ts`、`ai/patterns.ts`、`learn/verify.ts` 三处各理解一遍。今天三处理解一致，所以看不出问题。

#### 结论

**禁手是四个假设里影响最大的一个**，但它**不揭示架构错误**——它揭示的是两处**尚未被触发的一致性风险**：`replay` 的截断策略，以及「成五 = 赢」这个谓词的三处分布。**这两条现在不值得动**（只有一个规则集），但应当记在案，做禁手时先做这两条。

---

### D-2 · 添加第六档 AI 难度

#### 受影响模块

| 模块 | 需要做什么 | 强制程度 |
| --- | --- | --- |
| `ai/types.ts:6` | `Difficulty` 联合加 `'master'` | 1 行 |
| `ai/difficulty.ts:35-81` | `DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams>` | **TS 强制**——漏了直接编译失败 |
| `ai/difficulty.ts:93-99` | `DIFFICULTY_LABELS: Record<Difficulty, string>` | **TS 强制** |
| `ai/difficulty.ts:84` | `DIFFICULTIES = Object.keys(DIFFICULTY_PARAMS)` | **自动派生** |
| `ai/difficulty.ts:87` | `AVAILABLE_DIFFICULTIES = DIFFICULTIES`（「已实现但不上线」的现成接缝） | **自动派生** |
| `persist/storage.ts:69`、`persist/gameRecords.ts:92` | `isDifficulty` 由 `DIFFICULTIES` 派生 | **自动派生** |
| `components/panels/SettingsPanel.tsx:84-93` | `columns={3}` + `AVAILABLE_DIFFICULTIES.map` | 自动，6 档 = 2 行 3 列 |
| `analysis/analyze.ts:104` | `cacheKey` 掺 difficulty | 自动 |
| `bench/engine.bench.ts:15` | 用 `DIFFICULTIES` | 自动 |

#### 唯一的修改扩散点（**在测试里，不在生产代码里**）

| 位置 | 问题 |
| --- | --- |
| `ai/selfplay.test.ts:113,126` | `const tiers: readonly Difficulty[] = ['beginner','easy','medium','hard','expert']` **硬编码五档**。加第六档后，新档**静默地不进自对弈覆盖**——不会红，只是没测 |
| `ai/difficulty.test.ts:65` | 用例名是「AVAILABLE_DIFFICULTIES 覆盖全部**五档**」，但断言是 `[...AVAILABLE_DIFFICULTIES].sort()).toEqual([...DIFFICULTIES].sort())`——**断言会自动适配，用例名会变成一句假话** |

#### 结论

**这是四个假设里最干净的一个，而且它的干净是设计出来的证据，不是运气：**

- `Record<Difficulty, X>` 的两张表让**类型系统替人巡检**——漏一个字段就编译失败。这正是 `AGENTS.md` 禁止 `enum`、全用 `as const` + 联合类型的收益。
- `DIFFICULTIES` / `AVAILABLE_DIFFICULTIES` 的分离是**主动留出的接缝**：「实现但不上线」不需要改任何消费方。
- 生产代码里**只有 1 行是必须手写的**（联合类型加一个成员）。

**不需要任何架构改造。** 建议（若将来要做）：把 `selfplay.test.ts` 的两处硬编码数组换成 `DIFFICULTIES`，并把 `difficulty.test.ts:65` 的用例名里的「五档」改成动态的。

---

### D-3 · 添加在线对战

#### 受影响模块

| 模块 | 现状 | 在线对战要什么 | 谁承担 |
| --- | --- | --- | --- |
| `core/` | 纯函数，规则可脱离浏览器跑 | 服务端需要**同一套规则**做权威判定 | **直接复用**（这是分层的最大红利） |
| `persist/storage.ts`（对局存档） | localStorage，同步 | 服务端会话 | 接口已抽象（`PersistedSession`），但 `saveSession`/`loadSession` 是**模块级函数不是接口**——要改成注入 |
| `persist/gameRecords.ts` | 已经是 `GameRecordsStorage` **接口** | 服务端棋谱库 | **直接换实现** |
| `persist/progress.ts` | 已经是 `ProgressStorage` **接口** | 通常仍留本地 | 不动 |
| `store/gameStore.ts` | 同时是①对局状态机 ②AI 请求编排 ③棋谱入库状态机 ④提示请求编排 | 需要一个**远端着法源** + 断线重连 + 时钟 | **这里是要动的主体** |
| `store/analysisStore.ts` | 400ms 串行排队 | 在线模式下分析仍可留本地 | 不动 |
| `components/Board.tsx` | 按 `interactive` 开关 | 加「观战 / 等待对手」态 | 小改 |
| `components/panels/*` | 全是本地语义（悔棋/认输/重开） | 需要「请求和棋」「认输」「断线提示」 | 中改 |
| `AppErrorBoundary` / `GameLibrary` | 本地优先的降级假设 | 需要网络错误的降级语义 | 中改 |

#### 分层的红利（三处，都很实在）

1. **`core` 可以原样搬到服务端**——`replay(moves)` 是「从手顺重建局面」的单一构造路径，天生适合服务端权威模型。
2. **`requestId` + `gameVersion` 的双闸门（`gameStore.ts:403-407`）就是乱序消息需要的机制**，已经在了、已经测了。
3. **`GameRecordsStorage` / `ProgressStorage` 是可注入接口**，换实现不动消费方。

#### 真正的单一职责问题（**一个**）

`store/gameStore.ts`（审计当时 505 行；2026-10-19 复核为 **636 行**）同时承担四件事：对局状态机、AI 请求编排、棋谱入库状态机、提示请求编排。

**但按用户的判据「不要因为改动多个文件就武断判定为架构错误」，这里要分开说：**

- 今天只有**一个**着法来源（AI），四件事共享 `pendingRequestId` / `aiThinking` / `recordedSeq` 这几个字段，**合在一起是合理的**——拆开反而要引入跨 store 协调。
- 在线对战会引入**第二个**着法来源，且它的失败模式完全不同（网络超时 vs 引擎报错）、还需要时钟与重连。**到那时这四件事才会真的分家。**

**同样地，`ai/types.ts:73-96` 的 `SearchResponse` 把「走哪里」与「引擎怎么得到的」编在一个扁平接口里**（`move` 与 `depth`/`nodes`/`score`/`confidence`/`reason`/`candidates`/`urgency` 并列）。第二个着法源要么在这些字段里填假值，要么改接口。

值得注意的是：**这套设计已经走到了一半就停了**——请求侧有 `SearchOptions.diagnostics?: boolean`（`search.ts:77`）这个开关，响应侧却没有对应的 `diagnostics?` 分组。**若将来真要接第二个着法源，把响应拆成 `{ requestId, gameVersion, moveIndex?, move }` + `diagnostics?: {...}` 会更省事——而这件事在只有一个消费者时做，比有两个时做便宜得多。**

#### 依赖倒置（阶段 D 明确要求检查的一项）

结论：**分层方向是对的，但注入点只覆盖了半条路径**——「生产用单例、测试用注入」的写法在本仓出现了两次，两次都是同一个形状：

| 位置 | 注入点 | 生产路径 |
| --- | --- | --- |
| `store/gameStore.ts:209` `createGameStore(engine, options)` | ✅ 引擎与 `onGameEnd` 都是参数 | `store/useGameStore.ts:15` 造一个模块级单例 `appEngine`，第 17 行用它建单例 store |
| `store/learnStore.ts:33` `createLearnStore(storage)` | ✅ 存储是参数 | 同文件 `:140` 用 `indexedDbProgress` 建单例 |
| `features/review/ReviewScreen.tsx:17-28` | ✅ `storage` 与 `engine` **都是 props** | `App.tsx:26` 把 `indexedDbGameRecords` 与 `appEngine` 传进去 |
| `features/**` 的其余页面 | ❌ **直接 `import { useGameStore }` / `useLearnStore`** | 无注入点 |
| `persist/storage.ts:94,102` `saveSession` / `loadSession` | ❌ **模块级函数，不是接口**（对比 `ProgressStorage` / `GameRecordsStorage` 都是接口） | `useGameStore.ts:36-51` 直接调用 |

**判断**：
- **这不是「依赖倒置被违反」**。依赖倒置要求「高层不依赖低层的具体实现」；这里 `gameStore` 依赖的是 `AiEngine` **抽象**，`learnStore` 依赖的是 `ProgressStorage` **抽象**——注入点找得很准。
- **真正的缺口只有两个**，且都只在引入第二个实现时才需要修：
  1. `persist/storage.ts` 的 `saveSession` / `loadSession` **没有接口化**（另外两个存储模块都接口化了）。在线对战时会话要搬去服务端，这里是唯一的硬编码点。
  2. `features/**` 直接 import 单例 store。这在单机应用里是**正确**的（store 就是应用级单例，注入它只会增加噪声）。
- **所以：依赖倒置这一维的结论是「做对了一半，而没做的那一半现在不需要做」。** 要动手的第一个是 `persist/storage.ts`（低成本、可独立完成），第二个是 `SearchResponse` 的拆分（中成本，见上）。

#### 结论

**在线对战会撞到两处真实的职责集中**（`gameStore` 的四合一、`SearchResponse` 的扁平化），但**两处在今天都不构成缺陷**。按「不做没有第二个消费者的抽象」这条项目自己的原则，**现在不动是对的**。

要动手的**前置**（按性价比排）：
1. 把 `saveSession` / `loadSession` 从模块级函数提升为接口（与 `progress` / `gameRecords` 同一形状）——**低风险、可独立完成**。
2. 把 `SearchResponse` 拆成 `move` + `diagnostics?`——**中风险**（要改 `engine.test.ts`、`gameStore.test.ts`、`analysisStore.test.ts` 的假引擎）。
3. 拆 `gameStore`——**高风险**，且拆之前要有第二个着法源的真实验证需要。

---

### D-4 · 添加 SGF 棋谱导出

#### 受影响模块

| 模块 | 需要做什么 |
| --- | --- |
| **新增** `src/persist/sgf.ts` | `toSgf(record: GameRecord): string` ——纯函数 |
| `src/features/review/GameLibrary.tsx` | 一个「导出」按钮 + `Blob` + `<a download>` |
| 测试 | 纯函数 → 单测即可；再加一条 e2e 验下载 |

**不需要改任何现有模块的契约。**

理由：
- **坐标映射是直通的**：SGF 用 `[aa]`..`[oo]`，第一个字母是列、第二个是行（**从上往下**），与项目的 `x` 向右 / `y` 向下完全同向。`'a' + x` / `'a' + y`，**不需要任何既有数据变换**。
- **`GameRecord` 已经带齐了**：`moves`、`firstPlayer`、`resignedBy`、`winner`、`difficulty`、`mode`（`persist/gameRecords.ts:20-37`）。唯一没有的是时间戳——而 SGF 的 `DT` 是**可选的**，省略合法。
- **落点是现成的**：`persist/` 已经是「序列化」的家（`storage.ts` 的 encode/decode、`gameRecords.ts` 的 parse）。导出是同一类职责。

#### 唯一的注意点

`gameRecords.ts:17` 的注释写明「**不存时间戳**：项目约定 `Date.now()` 只允许出现在 `ai/search.ts`」。SGF 若要有 `DT`，就必须破这条约定或从别处取时间。**建议不写 `DT`**——保持约定不破，且信息不丢（`seq` 就是次序）。

#### 结论

**四个假设里唯一可以今天就做、且零架构风险的。** 一个新的纯函数文件 + 一个按钮 + 单测。

---

### D-5 · 四个假设的横向对比

| 假设 | 受影响模块数 | 必须改现有签名 | 修改是否扩散 | 揭示的真实设计问题 |
| --- | --- | --- | --- | --- |
| 禁手规则 | 8+（含 `core` 三件） | **是**（`validateMove`、`MoveError`、`ShapeKind`） | 不扩散，但需先补两处一致性 | ⚠️「成五 = 赢」散在三处；`replay` 的截断策略在新语义下变危险 |
| 第六档难度 | 3（1 行手写） | 否 | **类型系统自动巡检** | **无** —— 这是设计做对的证据 |
| 在线对战 | 6+ | 否（`AiEngine` 可复用为异步着法源） | 集中在 `store` 与一个响应接口 | ⚠️ `gameStore` 四合一；`SearchResponse` 扁平化 |
| SGF 导出 | 1（新增） | 否 | 零 | **无** |

**排序（从最省到最贵）**：SGF 导出 < 第六档难度 < 在线对战 < 禁手规则。

**一个反直觉的结论**：**影响最大的「禁手」和「在线对战」都不是因为分层错了才难做，恰恰相反——`core` 的纯净与 `persist` 的接口化让它们比在同类项目里容易得多。** 它们难在**领域本身**（规则要重新定义「什么算赢」、对战要引入时钟与网络），以及**两处今天还看不出问题的一致性风险**。这正是「不要因为改动多个文件就武断判定为架构错误」这条判据的实例。
