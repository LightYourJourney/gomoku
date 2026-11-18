# 阶段 E 其余四项实施计划：恢复编排、入库链、解析收口、测试环境

> 出处：`REFACTORING_ASSESSMENT.md` §5.4、§5.5、§5.6、§5.7、§9 H-5、§10「阶段 E」第 3–6 项。前两项已在
> [PHASE_E_GUARDS_PLAN](PHASE_E_GUARDS_PLAN.md) 完成。**四项都是零行为变更**：以「测试前后全绿且断言不改」为准，
> 只新增用例、不改已有断言。

## 现状核对（对照源码，不是对照报告）

| 报告说的 | 现在 | 本阶段做什么 |
| --- | --- | --- |
| 5.5 `confirmImport` 130 多行编排在组件里 | 仍在 `DataManagementPanel.tsx`（`confirmImport`，约 135 行），只能经组件测 | E3 平移 |
| 5.4 `makeNotifier` 在 `gameStore.ts` 闭包里 | 仍在（约 110 行），`gameStore.ts` 809 行 | E4 平移 |
| 5.6 `isPlayer` ×4、坐标解析 ×3 | `isPlayer`：`storage` / `positions` / `gameRecords` / `transfer/guards`；坐标：`storage.parsePoint`、`gameRecords.parseRecord` 内联、`positions.parseProvenance` 内联（手写 `0 ≤ x < 15`）；另有 `positions.isTimestamp` 与阶段 D 的 `lib/time-format.millisOrNull` 同一规则 | E5 收口 |
| 5.7 三处「文件:行号」引用已指错 | `AiPanel` 那处已不在；剩 `gameStore`（`gameRecords.ts:188`，已错）、`GameLibrary`（`Board.tsx:374`）、`patterns`（`threat.ts:283`）；`AI_ENGINE.md` 已知局限与 `ARCHITECTURE.md` 箭头两条此前已修 | E5 一并改成符号名 |
| H-5 纯逻辑测试换 node 环境 | 未量 | E6 先量（已量，见下）再定 |

## E3 恢复编排平移为注入依赖的函数

- 新文件 `src/persist/transfer/restore.ts`：`restoreImport(plan, deps): Promise<RestoreResult>`。
  - `plan`：要导入的棋谱、无效条数、四段（进度 / 偏好 / 会话 / 局面）各自的内容与「是否选中」，`kind: 'game' | 'backup'`。
  - `deps`：`records: Pick<GameRecordsStorage, 'importMany'>`、`positions: Pick<PositionStorage, 'list' | 'save'>`、
    `mergeProgress` / `restorePreferences` / `restoreSession` / `now`。
  - 结果：`{ ok: false, error }`（棋谱写入抛错；或备份的棋谱段 `storage === 'failed'`——其余各段不动）或 `{ ok: true, outcome }`。
  - `SectionOutcome` / `RestoreOutcome` 类型随之搬过来，组件 import。
- 组件 `confirmImport` 只剩：置忙 → 调用 → 按结果 `fail` 或 `setOutcome` → 清 `pending` → `onImported`（**仅成功时**，与现在一致）。
- 分支、顺序、文案逐字搬，不改：进度 `await`、偏好 / 会话同步调用、局面「先列一次已有键 → 逐条去重逐条写、单条失败计数、列取失败整段计失败」。
- 新增 `restore.test.ts` 直接测这段策略（不渲染）：棋谱整笔失败其余不动、单盘不受此限、各段独立成败、未选中记 `skipped`、
  文件里没有记 `absent`、局面去重 / 单条失败 / 列取失败 / 落内存计数。现有 `DataManagementPanel.test.tsx` 原样保留作集成层。

## E4 入库链平移出 `gameStore.ts`

- 新文件 `src/store/recordNotifier.ts`：`createRecordNotifier(onGameEnd, set)`，返回 `{ notifyGameEnd, reset }`，函数体与注释逐字搬。
  `set` 只收 `{ recordSaveState, recordedSeq }`；`notifyGameEnd(before, after)` 的 `before` 收它真正读的五个字段（`game` / `mode` /
  `humanColor` / `difficulty` / `branch`），不收整个 `GameStore`。
- `GameEndInput` 随之搬到 `recordNotifier.ts`（它是这条链的输入），`gameStore.ts` 从那里 import 并 re-export 原名，调用方不动；
  避免 `recordNotifier` 反过来 import `gameStore` 形成环（`check:cycles` 会查）。
- `gameStore.test.ts` 里入库链的用例一条不动（它们走 store 的公开行为）。

## E5 解析小函数收口 + 注释

- 新文件 `src/persist/parse.ts`：`isObj` / `isPlayer` / `isFiniteInt`（从 `transfer/guards.ts` 挪来）+ `parsePoint`（从 `storage.ts` 挪来）。
  `storage` / `positions` / `gameRecords` 删掉各自的 `isPlayer`，坐标解析改用 `parsePoint`；`transfer/*` 从 `../parse` 取；
  `guards.ts` 只留导入告警相关的（`ImportIssue` / `issue` / 错误码）。
- `positions.isTimestamp` 改用 `lib/time-format.millisOrNull`（同一规则：非负安全整数、≤ 8.64e15）。
- 等价性：`inBounds` 本身就查整数与 0–14，`positions` 手写的 `Number.isInteger && 0 ≤ x < 15` 与它逐项相同；`parsePoint` 只取 `x` / `y`
  两个字段，与三处现写法一致。
- 三处「文件:行号」改成符号名（`TECH_DEBT.md` 的教训：核对以符号名为准）。`gameStore` 那句「存储层拿到它就无条件删掉那一条」按阶段 D 后的
  实情改为「`putReplacing` 按号删掉那一条」。

## E6 纯逻辑测试换 node 环境：量了，不采用

在 `src/core src/ai src/learn src/analysis`（505 条，`lib` 里有读 DOM 的用例，不算纯逻辑）上交替各跑三次（`--environment`，1 分钟负载 12–16）：

| 环境 | 三次墙钟 | 中位 |
| --- | --- | --- |
| node | 11.11 / 11.49 / 9.19 s | 11.11 s |
| jsdom | 11.06 / 11.93 / 11.88 s | 11.88 s |

省下的是 jsdom 的环境初始化（报告里占累计时间 35–37%），但墙钟由最慢的几个搜索用例决定，中位只差约 0.8 s（7%），与次间波动同量级。
报告设想的第二个好处——「纯逻辑层不碰 DOM」由测试强制——已经有 `check:layers` 在 import 层面守着（React / Zustand / 浏览器入口）。
**结论：不采用**，不为它多一套测试配置。数字与理由记入 `TEST_REPORT`，以后真要提速时从这里接着量。

## 验收

1. 五条命令 + `gates` 全绿；**已有用例的断言零改动**（`git diff` 里测试文件只有新增，`gameStore.test.ts` / `DataManagementPanel.test.tsx` 不出现 `-` 行）。
2. `restore.test.ts` 覆盖 E3 列出的各条策略；反向验证一次（把「棋谱段整笔失败就停」那一行注释掉，新用例与组件用例都要红）。
3. `gameStore.ts` 行数下降（预计 ~700）；`check:cycles` 通过。
4. `grep -rnE '[A-Za-z]+\.tsx?:[0-9]{2,}' src`（排除测试）为空。
5. 文档：`ARCHITECTURE.md`（`persist/parse.ts`、`transfer/restore.ts`、`store/recordNotifier.ts`）、`TEST_REPORT`「〇之三十」、`ROADMAP`、`TECH_DEBT`（若有对应条目）。

## 自审

**第一轮（与报告对照）**
1. 阶段 E 六项：1、2 已完成；3、4、5、6 各对应 E3–E6。§5.6 第 3 条（每次开关库）报告明说不必动——不做。
2. 报告要求 E3「组件只留预览与结果展示；现有组件测试原样保留作为集成层」——计划照此；`openPreview` 里的预览与去重计数属于「预览」，留在组件。
3. 报告 §5.4 说「请求生命周期（随 4.3 抽走）」——阶段 B 已做（`withDeadline` + 订阅取消），本阶段只剩 `makeNotifier`。

**第二轮（零行为变更的边界）**
4. E3：组件里 `setBusy(false)` 在三个出口各写一次，抽走后由组件一处 `finally` 收——`busy` 的可见时序不变（都在 `await` 之后同一个任务里置回）。
   `onImported()` 仍只在成功出口调用；`setPending(null)` 在三个出口都有，保持。
5. E3：`gamePayloadToRecordInput` 的映射搬进 `restoreImport`，阶段 D 加的 `createdAt` 随之一起走，不另写。
6. E4：`options.onGameEnd` 现在是在 `createGameStore` 调用时读一次的闭包变量；搬走后改为参数传入——同一个值、同一时刻读，不变。
7. E5：`gameRecords.parseRecord` 的坐标循环里「不是对象就整条丢」与 `parsePoint` 返回 null 后整条丢等价；`storage` 本来就用 `parsePoint`。
8. E5：`transfer/guards.ts` 里的 `isFiniteInt` 等被 `validate.ts` / `position.ts` 用；挪走后 knip 会抓遗留的未用导出。

**第三轮（门禁与文档）**
9. 依赖方向：`persist/parse.ts` 与 `persist/transfer/restore.ts` 都在 `persist` 内，`restore` 只依赖 `persist` 自己的类型与注入的回调，不引 `store` / `features`。
10. 条数棘轮只增（`restore.test.ts` 新增）；jscpd：`restore.test.ts` 与组件测试的夹具若重复，抽共用夹具，不加豁免。
11. E6 不改配置，没有门禁变化。
