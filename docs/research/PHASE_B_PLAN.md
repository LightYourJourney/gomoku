# 阶段 B 实施计划：AI 请求调度层（双 Worker + 真正的取消）

> 出处：评估报告 §4.3、§5.1、§10「阶段 B」；选型裁定见 §14.2 第 13 条（双 Worker），实验记录见 `PHASE_B_C_DECISIONS.md`。

## 目标

1. 引擎有真正的取消：作废的搜索不再占着 Worker，新请求不再排队（`bench:queue` 的 A / B / C 场景从秒级降到十几毫秒）。
2. 落子与只读请求（提示、复盘分析、编辑器分析）分住两个 Worker，互不阻塞；Worker 首次请求时才创建。
3. 复盘分析与编辑器分析有超时兜底（现在只有落子与提示有）。
4. `applyAiResponse` / `applyHintResponse` 与三个 store 现有的作废闸门**一行不动**；既有过期响应用例不改断言全绿。

## 设计决定

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | `AiEngine` 加 `cancel(requestId)`：从待决表摘掉，以「已取消」拒绝那个 Promise（`SearchCancelledError`），并通知传输层中止。对已结算 / 不认识的 id 是空操作 | 原型里被取代的 Promise 永不结算、待决表留一条；正式实现要收干净。拒绝而不是永不结算：调用方的拒绝分支本来就先过闸门（见 D4），不会把取消报成错误 |
| D2 | `createAiEngine(post, abort?)`：第二个参数可选，`engine.ts` 仍不碰 Worker、仍是可单测的纯状态机 | 现有 `engine.test.ts` 用一个参数构造，不改 |
| D3 | `browserEngine.ts` 两条车道。**落子车道**：同一时刻至多一个请求；取消在飞的、或新落子到来时上一个还在飞 → 终止并重建。**只读车道**：串行（Worker 自己的消息队列）；记下已发出未返回的请求；取消排头那个 → 终止重建，把其余的重发给新 Worker；取消排在后面的 → 记为丢弃，它的响应回来时不转交。两条车道都在首次请求时才创建 Worker | 与原型 A 一致，补上显式取消与只读车道的取消。只读车道上同时在飞的最多两三个（分析管线串行、提示至多一个、编辑器至多一个），重发代价可忽略 |
| D4 | **store 不在每条作废路径上手写取消**，而是在创建 store 时订阅一次：`pendingRequestId` / `pendingHintRequestId`（`gameStore`）、`analysis.requestId`（`editorStore`）从某个 id 变走时，对旧 id 调 `engine.cancel`。`analysisStore` 在 `reset()` 里取消在飞的那个 | `gameStore` 置空 `pendingRequestId` 的地方有十来处（悔棋、新局、认输、恢复、挂起 AI、换模式……），逐处加调用容易漏；订阅只有一处。正常结算时 id 也会变走，此时 `cancel` 是空操作（D1）。订阅在 `set` 之后触发，状态已经放弃了那个请求，所以被取消的 Promise 的拒绝分支一定被闸门挡下 |
| D5 | 超时：新增 `store/searchDeadline.ts`，`withDeadline(engine, request, ms)`：到时取消请求并以「AI 超过 N 秒没有响应」拒绝。`analysisStore` 与 `editorStore` 用它（15 秒，同 `AI_RESPONSE_TIMEOUT_MS`）；**`gameStore` 的两处计时器不动** | 验收 ③。`gameStore` 的两处计时器有用例用假时钟钉着行为，改写它们要动这些用例的前提；收益只是少几行。偏离报告「四份生命周期合一」的设想，写明 |
| D6 | 不放开复盘分析的档位与预算 | 那是产品行为的改变，B 只解除它的前提；要不要放、放到多少，之后单独问 |
| D7 | `BattleScreen.test.tsx` 的全局 `FakeWorker` 垫片删掉 | Worker 改为首次请求时创建后，模块加载不再构造 Worker，垫片不再需要（报告 §4.3 的顺带收益）。删了还绿，正好证明 D3 的「按需创建」 |

## Task 1：引擎的取消（先写失败测试）

- [x] `engine.test.ts` 新用例：`cancel` 拒绝那个 Promise 且错误是 `SearchCancelledError`；之后到达的同 id 响应被丢弃；`abort` 被调用一次且带 id；对已结算 / 不存在的 id 不调 `abort`、不抛；`dispose` 之后 `cancel` 是空操作。
- [x] 实现 D1、D2。所有假引擎（`gameStore.test`、`analysisStore.test`、`editorStore.test`、`review.test`、`PositionEditor.test`）补一个 `cancel() {}`（或记录调用的版本），**断言不改**。

## Task 2：双 Worker 传输层

- [x] `browserEngine.ts` 按 D3 重写。传输层的车道逻辑抽成纯函数 / 可注入 `spawn` 的工厂（`createLanes(spawn)`），放在 `ai/` 下、不碰 `Worker` 全局，好在 jsdom 里用假 Worker 单测：落子车道新请求终止旧 Worker；取消在飞的落子终止重建；只读车道取消排头的重发其余、取消排后的丢弃响应；两条车道都按需创建、互不影响；Worker 的 `error` 事件让对应车道的在飞请求失败（走 `engine.handleError` 的现有语义——**只失败那条车道上的请求**，见自审 4）。
- [x] `AGENTS.md` 的「只有 `worker.ts` 与 `browserEngine.ts` 允许触碰 Worker」照旧成立：车道工厂只拿到注入的 `spawn`。

## Task 3：store 接上取消与超时

- [x] 失败测试：`gameStore` 悔棋 / 新局 / 认输 / 求提示后落子各一例——被放弃的请求 id 被 `cancel`；正常结算的不会被 `cancel` 成功（空操作也行，断言「待决表里已经没有它」即可）；`analysisStore` 的 `stop()` 与换局取消在飞的那个；`editorStore` 编辑局面后取消在飞的分析；`analysisStore` / `editorStore` 超时（假时钟 15 秒）落到错误状态并取消请求。
- [x] 实现 D4、D5；删 `BattleScreen.test.tsx` 的垫片（D7）。
- [x] 既有的过期响应用例、超时用例一条不改断言全绿。

## Task 4：验收

- [x] 五条命令 + `gates`；`e2e:browsers`（Firefox / WebKit 的模块 Worker 与 `terminate`）。
- [x] `yarn bench:queue` 在生产构建上：A / B / C 场景排队降到几十毫秒以内、B 不累积；与实验记录对照。探针 D 场景要能在按需创建下找到 Worker 脚本——若找不到，改探针的取法（只改 `bench/`，不改产品代码）。
- [x] 真实浏览器复核：专家档思考中悔棋再落子，AI 很快应手；复盘页分析中切回对战页落子，不被挡；DevTools 里每页 Worker 数量：只下棋 1 个，求过提示或复盘过 2 个。
- [x] 文档：`ARCHITECTURE.md`（引擎与 Worker 一节）、`AI_ENGINE.md`（若提到单 Worker 与无取消）、`TEST_REPORT.md`「〇之二七」、`ROADMAP.md`；`tests.baseline.json` 只上调。
- [x] 两轴审查 → 提交 → 推送 → 盯 CI 全档。

## 验收标准

1. `bench:queue` A、B、C 场景的排队 < 50 ms，B 不随悔棋次数累积。
2. 既有过期响应与超时用例断言不改、全绿。
3. 复盘与编辑器分析有超时兜底（用例钉住）。
4. `e2e:browsers` 全绿。
5. 每页 Worker 数量符合预期，并有用例钉住（车道工厂的单测：只发落子 → 只 spawn 一次）。

## 自审

**第一轮（与裁定、报告对照）**
1. 报告 §10 的 B 写「`gameStore` 净减约 80 行」「四份生命周期合一」。本计划只统一了取消（订阅一处）与分析侧的超时，没有重写 `gameStore` 的请求代码（D5）。如实写为偏离，收益（延迟、超时兜底）不受影响。
2. 报告提到「Worker 重建时脚本若不在缓存里且断网会失败，走现有 `aiError` + 重试路径，要有用例」：车道工厂的单测里让 `spawn` 抛错，断言那条请求以错误结算、下一次请求会再试着 `spawn`。

**第二轮（取消的竞态）**
3. 订阅里的 `cancel` 与正常结算的先后：响应到达 → `engine.handleResponse` 先从待决表摘掉并结算 → 之后 `applyAiResponse` 把 `pendingRequestId` 置空 → 订阅对旧 id `cancel`，此时已不在待决表，空操作，不会误杀下一个请求。用例钉住。
4. 现在 `browserEngine` 把 Worker 的 `error` 事件交给 `engine.handleError`，它让**所有**待决请求失败。两条车道后，落子 Worker 出错不该让只读车道上的分析一起失败。车道工厂要按车道把失败交给对应的请求：需要 `engine` 有「只让这几个 id 失败」的入口——给 `handleError` 加一个可选的 id 列表，不传时保持现状（`engine.test` 现有用例不改）。
5. 只读车道「取消排头 → 重发其余」：重发时这些请求在新 Worker 里重新开始计时，`withDeadline` 的 15 秒是从最初发起时算的，不受影响（宁可早超时也不漏）。

**第三轮（测试与门禁）**
6. 删掉 `FakeWorker` 垫片后，若某个测试间接触发了落子请求，会在 jsdom 里 `new Worker` 失败——那说明那个测试原本就依赖了真引擎，按失败暴露出来正好；处理方式是给它注入假引擎，不是把垫片加回来。
7. `quality/layers.mjs`：新文件都在 `ai/` 与 `store/`，方向不变；`ai/` 的新车道工厂不得 import React（门禁自动查）。
8. 条数棘轮只增；`bench/baseline.json` 不动（引擎搜索本身没改）。

## 独立终审

终审者只读源码与计划，九条意见逐条核实后处理如下（「已在实现中」= Task 1 / 2 动手前后已经这么做了，核对无误）。

| # | 意见 | 核实 | 处理 |
| --- | --- | --- | --- |
| 1 | `withDeadline` 若先 `cancel` 再拒绝外层，内层的 `SearchCancelledError` 先结算，store 仍认这个 id，界面显示「已取消」而不是超时 | 成立（`editorStore` / `analysisStore` 的拒绝分支只比 id / run） | 实现时改为：`cancel` 带可选的拒绝原因，`withDeadline` 到时以超时错误取消、返回 `search` 的原 Promise（包一层会让 31 条既有用例晚一个微任务而红，见 `TEST_REPORT.md`「〇之二七」）；用例断言文案 |
| 2 | `cancel` 在 zustand 监听器里同步执行（在 `set` 内部），抛错会穿出 `set`，打断后续动作与存档订阅 | 成立 | 落子车道的中止只 `terminate`、懒建；只读车道重建失败转成 `handleError(ids)`，不抛（已在实现中，有用例） |
| 3 | 「被取消的拒绝一定被闸门挡下」没有用例证明：假引擎的 `cancel` 只记账不拒绝 | 成立 | Task 3 每个 store 至少一例用真的 `createAiEngine`，断言错误字段没被写 |
| 4 | `analysisStore` 没记在飞请求的 id；`start()` 先换引擎再 `reset()`，会拿新引擎取消旧 id | 成立（`analysisStore.ts` `pump` 内联 `nextRequestId()`；`start` 先 `engine = eng`） | 在飞请求连同发出它的引擎一起记下，`reset()` 用记下的那个引擎取消 |
| 5 | 离开编辑器不取消它的分析，孤儿分析留在只读车道挡住随后的提示 | 成立（`PositionEditor` 无卸载清理，`requestId` 不变订阅不触发） | `editorStore` 加 `dispose()`，`PositionEditor` 卸载时调用 |
| 6 | 车道记账按 id、只认当前 Worker 的消息；排头已回响应未处理时取消会重复响应；落子被抢占时旧 id 要在待决表里失败；出错后丢弃实例 | 成立 | 均已在实现中：按 id 记账；每个 Worker 的事件先比对是否当前实例；重复响应由引擎按 id 丢弃；抢占时对旧 id `cancel`；出错即终止并置空 |
| 7 | `handleError` 传空列表必须是空操作 | 成立 | 已在实现中；补一例 |
| 8 | D7 漏了 `bootstrapStore.test.ts` 的同款垫片；`AGENTS.md` 只点名两个文件可碰 Worker；`useGameStore.ts`、`ReviewScreen.tsx`、`gameStore.ts` 的注释「共用同一个 Worker」「引擎没有取消接口」会变成错话 | 成立 | 两个垫片一起删；车道工厂用自己的 `LaneWorker` 接口，`AGENTS.md` 点名它不碰 Worker；三处注释随改 |
| 9 | `bench:queue` 的 D 场景页面一打开就读 Worker 脚本的资源记录，按需创建后必然为空 | 成立 | 探针先触发一次落子再取（只改 `bench/`），不是「若找不到再改」 |
