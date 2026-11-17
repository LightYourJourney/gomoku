# 阶段 E 前两项实施计划：依赖方向门禁 + 领域类型下沉；`core` 严格重放原语

> 出处：`REFACTORING_ASSESSMENT.md` §5.2、§5.3、§10「阶段 E」第 1、2 项；§14.1 裁定 11 排定的顺序第 2 位。
> 两项都是**零行为变更**：测试前后全绿、既有断言不改（只改 import 路径）。

## 目标

1. 分层规则由机器守：`yarn check:layers` 进 `yarn gates`（CI 与推送钩子都跑 `gates`，不用另改工作流）。
2. 消掉 §5.2 列出的越层 import：`GameMode`、`moverAt` 等领域概念在下层有家，上层不再「往上够」。
3. `core` 有一个严格重放原语，替换 6 处手写的 `state.moves.length !== moves.length`；认输叠加的 2 处共用一个函数。

## 现状（2026-11-17 在 `33d6aa8` 上用 madge 的依赖图算的，含仅类型的 import，不含测试文件）

| 层 | 实际依赖的层 |
| --- | --- |
| `core` | — |
| `ai` | core |
| `analysis` | core、ai |
| `learn` | core、ai、lib（`coords`、`shape-labels`） |
| `lib` | core、ai（类型）、**learn（类型，`shape-labels` → `learn/types`）** |
| `persist` | core、ai、lib（`theme`） |
| `sharing` | core、persist |
| `store` | core、ai、analysis、persist、lib |
| `components` | core、ai、lib、**store ×5、features ×2** |
| `features` | 以上全部 |
| 根（`App.tsx`、`main.tsx`） | 以上全部 |

加粗的是越层：`components → store`（`GameMode`、`AiInfo`、`RecordSaveState` 三个类型，`moverAt`、`HINT_BUDGET_MS` 两个值）、
`components → features`（`GameStatusDescriptor`、`StatusTone` 两个类型）、`lib ↔ learn`（层级互相引用）。
`'pve' | 'pvp'` 在 `persist` 里手写了五遍（`storage.ts`、`recordIdentity.ts`、`gameRecords.ts` 各 1 处，`transfer/format.ts` 2 处；`gameRecords.ts` 那处的注释直说「避免反向依赖 store」），`features/battle/BoardAnnouncer.tsx` 里还有 2 遍——都是因为 `GameMode` 住在 `store`。

## 设计决定

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | **允许表**（键可以依赖值里的层；同层随意；表外一律红）：`core: []`、`ai: [core]`、`analysis: [core, ai]`、`learn: [core, ai, lib]`、`lib: [core, ai]`、`persist: [core, ai, lib]`、`sharing: [core, persist]`、`store: [core, ai, analysis, persist, lib]`、`components: [core, ai, learn, lib]`、`features: [除根以外全部]`、根：全部 | 就是「现状去掉加粗」，外加 `components → learn` 一条新边（D5）。`store` 不依赖 `learn` 是 `AGENTS.md` 的明文规则，表里照写。新的合法边要改表——那是一次显式的、会出现在 diff 里的决定 |
| D2 | **纯逻辑层不得（直接或间接）引入 `react` / `react-dom` / `zustand`**：从 `core` / `ai` / `analysis` / `learn` 的每个生产文件出发沿依赖图走，碰到这三个包就红。madge 带 `tsConfig` 时包依赖显示成解析后的路径（`../node_modules/@types/react/index.d.ts`、`../node_modules/zustand/index.d.ts`），所以按 `node_modules/(@types/)?(react\|react-dom\|zustand)/` 匹配，**不按裸包名**；`..` 开头的目标不参与层归类 | `AGENTS.md` 第 14 行的规则。要查**传递**的：`learn → lib` 是合法边，但 `lib` 里有 React hook，`learn` 若 import 了 `lib/useMediaQuery` 就该红。DOM 全局（`window`、`localStorage`……）不是 import，**本门禁不管**，照旧靠审查——写进脚本头注释，不假装覆盖 |
| D3 | 解析交给 **madge**（已是开发依赖，`check:cycles` 在用），用它的 Node API 取依赖图（`includeNpm: true` 拿到包依赖），不自己写正则解析 import | 不加依赖、不改 `package.json` 的依赖版本；与环检测同一个解析器，两道门对「谁 import 了谁」的看法一致。已实测 madge 的图包含仅类型的 import（`lib/shape-labels.ts → learn/types.ts` 在图里） |
| D4 | 只查生产代码：madge 的 `excludeRegExp` 排除 `*.test.ts(x)`、`test/` 与 `*.css`（`index.css` 是样式，不是代码）。图里出现不在表里的顶层目录或根文件 → 红（要求显式归类）。madge 的 `skipped` 是全局的、不随排除消失，现状固定为两个测试里的 `?raw` 与 `index.css` 的 `@import 'tailwindcss'`——只放过 `?raw`（Vite 当字符串读，不是模块依赖）与 `tailwindcss`，其余 skipped 一律红（失败关闭） | 测试为了组装场景可以跨层（组件测试用 store 是常态）。未归类即红，是为了新目录不会悄悄逃出门禁 |
| D5 | `lib/shape-labels.ts` 挪进 `learn/`（`learn/shape-labels.ts`） | 它给 `learn` 的棋形与 `ai` 的威胁起中文名，`learn` 的两个模块是主要使用者；挪过去后 `lib → learn` 消失。代价是 `HintPanel` 从 `learn` 取 `threatLabel`——`components → learn` 是向下依赖，合法 |
| D6 | 去处：`GameMode` → `core/types.ts`；`moverAt` → `core/game.ts`；`AiInfo` → `ai/types.ts`；`HINT_BUDGET_MS` → `ai/difficulty.ts`（与五档的 `budgetMs` 同住，都是搜索预算）；`RecordSaveState` → 新文件 `lib/record-save.ts`；`GameStatusDescriptor` / `StatusTone` → `components/panels/StatusPill.tsx`（组件的 props 契约跟组件住，`features/battle/status.ts` 从组件取） | `RecordSaveState` 是「这局有没有存进棋谱库」的界面状态，`store` 与 `components` 都要用；`components → persist` 不在允许表里（组件不该碰存储层），先例是 `lib/theme.ts`——`ThemePreference` 也是 `store` / `components` / `persist` 共用的小词表。**不留转发**：旧位置删掉、调用方全改，不在 `gameStore` 里 `export { moverAt } from …`（那是 Middle Man，越层 import 也就没真正消失） |
| D7 | 七处 `'pve' \| 'pvp'`（`persist` 五处、`BoardAnnouncer` 两处）改成 `GameMode`，`gameRecords.ts` 那句过时的注释删掉；`validate.ts` / `storage.ts` 里 `mode !== 'pve' && mode !== 'pvp'` 这类**值检查不动** | 类型统一是本项的目的；值检查是运行期的格式校验，改成别的写法是行为面的事，不在零变更范围内 |
| D8 | `analysisStore` 里手写的 `index % 2 === 0 ? first : opponentOf(first)` 换成 `moverAt` | 同一条规则的第二份；`moverAt` 下沉后它可以直接用。只此一处（全仓 grep `% 2 === 0` 的生产代码只有这两处） |
| D9 | **严格重放**：`replayStrict(moves, firstPlayer = BLACK)` 返回 `{ ok: true; state } \| { ok: false; failedAt; error: MoveError }`，实现为「调 `replay`，长度不等时再判原因」——**不复制重放循环** | 报告 §5.3 要的就是「成功的状态，或在第几手、因为什么失败」。复用 `replay` 保证两者对「哪一手合法」永远同一个答案。**`transfer/validate.ts` 的 `validateSequence` 就是这个原语的手写原版**（终审发现，第 7 处）：它用 `failedAt` 与 `error` 生成导入报错，改用原语后两份同逻辑合一。它的失败分支原来顺带返回截断的 `state`，两个调用方都不用——返回类型改成判别联合（`ok`），调用方按 `ok` 分支 |
| D10 | **认输叠加**：`withResignation(state, resignedBy)`（`null` → 原样；否则 `resign`），替换 `gameStore.restore` 与 `replayStore.derivePosition` 两处 | 前者逐字是这个三元式；后者多一个「游标在最后一手」的条件，写成 `withResignation(replayed, cursor === record.moves.length ? record.resignedBy : null)`，条件留在调用方 |
| D11 | **`gameRecords.deriveWinner` 不动** | 它在「已终局却带认输方」时判认输方的对手赢，而 `resign` 对已终局的局面原样返回——两者在这个（解析时已拒绝、构造时不可达的）组合上答案不同。换成 `withResignation` 就不是严格的零行为变更。报告把它列为「第三种写法」，如实记为有意不收 |
| D12 | 次序：**先写门禁、看它在现状上红，再下沉**；严格重放独立在后 | 门禁先红一次，证明它抓得住真实的漂移（等价于「先写失败测试」） |

## 不做的

- DOM 全局的检查（D2）；`deriveWinner`（D11）；E 的第 3–6 项（`confirmImport`、`makeNotifier`、`persist` 小解析函数、node 环境实验）。
- 不改 `package.json` 的依赖与版本；只加一个脚本、改 `gates` 那一行（**收紧**门禁，提交信息写明）。

## Task 1：依赖方向门禁（先红）

- [ ] **Step 1：`quality/layers.mjs`** —— madge API 取图（`fileExtensions: ['ts', 'tsx']`、`tsConfig`、`includeNpm: true`、`baseDir: 'src'`）；按 D1 查每条跨层边，按 D2 从纯逻辑层文件做可达性搜索；按 D4 排除测试并要求归类。失败时逐条打印「文件 → 目标（层 → 层）」与「纯逻辑文件 → … → 包」的路径，退出码 1；通过时打印文件数与跨层边数。头注释写明：规则出处（`AGENTS.md`）、不查 DOM 全局、改允许表就是改分层，须先改 `ARCHITECTURE.md`。
- [ ] **Step 2：`package.json`** —— `"check:layers": "node quality/layers.mjs"`，`gates` 末尾加 `&& yarn check:layers`。
- [ ] **Step 3：在现状上跑，必须红**，且列出的正好是「现状」一节加粗的那些：`components → store` 5 个文件、`components → features` 2 个文件、`lib → learn` 1 个文件（`shape-labels.ts`）。多一条少一条都停下来查（多了说明解析或表写错，少了说明漏查）。
- [ ] **Step 4：反向验证（暂存起来，Task 2 之后再跑一遍）**——见 Task 2 Step 4。

## Task 2：下沉（变绿）

- [ ] **Step 1：搬家**（D5、D6、D8）。逐个：新位置加定义 → 调用方改 import → 删旧定义。测试文件里的 import 路径一并改（`AiPanel.test`、`ResultDialog.test`、`gameStore.test` 等，以 `tsc` 报错为准），**断言一个字不改**。`ai/selfplay.test.ts` 第 38 行那句「刻意不 import store 里的 `moverAt`」随之过时：改成从 `core` 取或删掉那句注释，二选一取改动小的。
- [ ] **Step 2：`persist` 三处类型**（D7）。
- [ ] **Step 3：跑** —— `yarn check:layers` 绿；`lint` / `typecheck` / `test`（条数不变）/ `build` / `gates`。
- [ ] **Step 4：反向验证，各自恢复** ——
  (a) `components/panels/HintPanel.tsx` 加一行 `import type { GameStore } from '../../store/gameStore'` 并用掉 → 红，指名这条边；
  (b) `core/types.ts` 加 `import type {} from 'react'` → 红（D2，直接）；
  (c) `learn/hints.ts` import `lib/useMediaQuery`（只取类型也算）→ 红，打印出经由 `lib/useMediaQuery.ts` 到 `react` 的路径（D2，传递）；
  (d) 新建 `src/scratch/x.ts` → 红（D4，未归类）；
  (e) 测试文件里的越层 import 不红（D4）。
- [ ] **Step 5：文档** —— `AGENTS.md` 第 15 行的 `learn/` 纯逻辑文件清单加上 `shape-labels.ts`、「棋盘的字符画解析器」那句不动；第 14–15 行后加一句「由 `yarn check:layers` 机器守，允许表在 `quality/layers.mjs`」；`ARCHITECTURE.md` 第 17 行的箭头改成**依赖方向**的写法（「`features` 依赖 `components` 与 `store`」），与第 82 行 `PageShell` 段一致，并贴允许表；`quality-gates` 设计文档若有门禁清单，补一行。
- [ ] **Step 6：提交** —— `chore(gates): 依赖方向门禁；领域类型与常量下沉到下层`，提交信息写明 `gates` 多了一道（收紧）。

## Task 3：严格重放原语

- [ ] **Step 1：失败测试**（`core/game.test.ts`）——
  `replayStrict`：完整合法 → `ok` 且 `state` 与 `replay` 逐字段相等；第 k 手落在已有子上 → `{ ok: false, failedAt: k, error: 'occupied' }`；出界 → `'out_of_bounds'`；成五之后还有手 → `'game_over'`，`failedAt` 是成五之后那一手；空手顺 → `ok`。
  `withResignation`：`null` → 返回同一个对象；对局中 → `resigned`、赢家是对手；已终局 → 原样（与 `resign` 一致）。
- [ ] **Step 2：实现**（D9、D10），跑 Step 1 变绿。
- [ ] **Step 3：替换 7 + 2 处**。每处保持原来的返回值与报错文案：`transfer/validate.ts` 的 `validateSequence`（错误码与文案映射不变，返回改判别联合，两个调用方跟着改）、`position.ts` ×2（`throw RangeError` / `return false`）、`branch.ts` ×2（`{ ok: false, error }`）、`gameRecords.ts`（`return null`）、`transfer/validate.ts`（`errors.push`，后续 `cells` / `nextPlayer` 比对用 `ok` 分支里的 `state`）；`gameStore.restore`、`replayStore.derivePosition` 换 `withResignation`。
- [ ] **Step 4：反向验证** —— `replayStrict` 临时恒返回 `ok`（`state` 用截断后的）→ 六处的既有用例里应有红的（记下是哪些文件的哪几条；**某一处没有用例变红就补一条**，那说明它的严格检查原本就没被测到）。恢复。
- [ ] **Step 5：五条命令 + `gates`**；`e2e` 全量（存档恢复、棋谱库、分享、导入都走这些路径）。
- [ ] **Step 6：提交** —— `refactor(core): 严格重放原语，替换六处手写检查与两处认输叠加`。

## 收尾

- `TEST_REPORT.md` 新节「〇之二六」：门禁在现状上的红单、反向验证表、条数变化、闸门读数；`ROADMAP.md` 记一条；`tests.baseline.json` 只上调（预计 +8 左右，以实跑为准，提交信息写明）。
- 两轴审查（标准轴 + 规格轴，规格 = 本计划），查出与处置记进 `TEST_REPORT.md`，按阶段提交。

## 验收标准

1. `yarn gates` 含依赖方向，且在故意引入越层 import / 纯逻辑层引入 React（含传递）/ 未归类目录时都会红（反向验证 a–d）。
2. `src` 生产代码里不再有 `components → store`、`components → features`、`lib → learn`。
3. 七处手写长度检查（含 `validateSequence`）与两处认输叠加不复存在；既有测试断言未改且全绿；单测条数只增。
4. 五条命令与 `gates` 全绿；入口 gzip 不涨超过几十字节（纯搬家）。

## 自审

**第一轮（对照报告与现状）**
1. 报告 §5.2 说「7 处 import 指向上层」——实算 `components → store` 是 5 个**文件**（`HintPanel`、`SettingsPanel`、`AiPanel`、`MoveList`、`ResultDialog`），`ResultDialog` 同时还指向 `features`，所以「7 处」是 7 条 import 语句、6 个文件。Step 3 的期望按文件数写，避免对不上时误判。
2. 报告说替换「6 处检查与 3 处认输叠加」，本计划只收 2 处认输（D11）。偏离写明理由。
3. `HINT_BUDGET_MS` 放 `ai/difficulty.ts` 而不是做成 `HintPanel` 的 prop：prop 方案要改组件接口与调用方，搬常量是最小改动。

**第二轮（零行为变更的漏洞）**
4. `replayStrict` 用 `replay` 实现，`error` 的判定：截断时若 `state.status !== 'playing'` → `'game_over'`，否则取 `validateMove(state.board, moves[failedAt])`。`replay` 只在这两种情况下停，所以 `validateMove` 必然非空——写成断言式的 `?? 'occupied'` 会是「为不可能的情况写的处理」，改为直接断言非空并在注释里说明。
5. `transfer/validate.ts` 那处检查之后还用 `state` 比 `cells` 与 `nextPlayer`：替换后这两步必须用 `ok` 分支里的 `state`，不能用截断的那份——两者在合法时相同，零变更成立；Step 3 已点名。
6. `GameStatusDescriptor` 挪进 `StatusPill.tsx`：组件文件导出类型会不会触发 react-refresh 的「只导出组件」lint？类型导出不影响（`only-export-components` 只管值）。若 lint 报，就退到同目录的 `status-types.ts`。
7. 门禁 D2 的可达性搜索用的是生产文件的图；纯逻辑层的测试文件 import React（例如测试工具）不受影响，也不该受影响。

**第三轮（门禁自身会不会骗人）**
8. madge 对解析不了的 import 会放进 `skipped` / 不报——若某个文件 import 了解析失败的路径，那条边就看不见。脚本要检查 madge 的 `warnings().skipped`，非空即红（失败关闭，与 `pre-push` 的原则一致）。
9. 动态 `import()`：madge（detective-typescript）会收；`App.tsx` 若将来按页 `lazy(() => import(...))`，边仍在图里。不在本阶段验证范围，阶段 C 拆包时复核一次。
10. 允许表若写成「键可以依赖值」但实现时方向弄反，Step 3 的红单会完全不同——这正是 Step 3「多一条少一条都停下来」要抓的。

## 独立终审（另一个代理，只读；用 madge 的 API 与 /tmp 小工程实测）

七条意见，逐条核实后**全部采纳**（其中前三条我在等终审时试跑门禁草稿也撞上了，草稿已按同样的方式处理）。

| # | 类别 | 发现 | 处理 |
| --- | --- | --- | --- |
| 1 | 会破坏 | 按裸包名找 `react` 会全漏：带 `tsConfig` 时包依赖是 `../node_modules/@types/react/index.d.ts` 这样的路径；`..` 若被当成一层，还会多出一堆假红 | D2 改为按 `node_modules/…` 路径匹配，`..` 目标不参与层归类 |
| 2 | 会破坏 | 「skipped 非空即红」在现状就恒红：skipped 是全局的，固定含两个测试的 `?raw` 与 `tailwindcss` | D4 只放过这两类，其余失败关闭 |
| 3 | 会破坏 | `main.tsx → index.css` 在图里，`index.css` 不在根文件表里 | D4 排除 `*.css` |
| 4 | 边界 | `transfer/validate.ts` 的 `validateSequence` 是第 7 处手写检查，而且正是「第几手、因为什么失败」的原版 | D9 收它；验收标准改「七处」 |
| 5 | 边界 | `'pve' \| 'pvp'` 在 `persist` 里是五处不是三处，`BoardAnnouncer` 还有两处 | D7 改七处，删过时注释 |
| 6 | 边界 | `replayStore` 那处多一个「游标在最后一手」的条件，不是逐字同一个三元式 | D10 写明条件留在调用方 |
| 7 | 约定 | `AGENTS.md` 第 15 行列举了 `learn/` 的纯逻辑文件，挪进 `shape-labels.ts` 要更新 | Task 2 Step 5 补上 |

终审确认没有问题的：现状表与红单（5 + 2 + 1 个文件）与真实依赖图一致，纯逻辑四层目前没有通到 React / Zustand 的路径；
madge 8 收 `import type`、`export … from`、动态 `import()`；允许表不会让现有合法边红；下沉去处不引新越层或循环，
`StatusPill.tsx` 导出类型不触发 lint（`only-export-components` 是 warn 级且不管类型），knip 对类型放行；
D9 的失败原因判定正确、各替换点语义等价；D11 不动 `deriveWinner` 的理由成立（两个生产者都到不了「终局 + 认输」）。
