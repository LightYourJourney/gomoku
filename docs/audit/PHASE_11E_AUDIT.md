# Phase 11E · Phase 11A–11D 独立审计

> **审计基线**：`main` @ `8f2fee3`（审计开始时工作区干净、与 `origin/main` 同步）。
> 本文记录的是**审计及整改后的状态**；代码修复提交 `dfe510e`，发布前评审修复 `20f28a3`。
> 审计当时的结论保留为历史；当前数据版本与生产状态见 §2（已随 0.6.0 更新）。
> **审计身份**：没有参与 Phase 11C/11D 开发的独立评审视角。历史交接文档、
> `TEST_REPORT.md` 与阶段报告只当作**待核验材料**；凡是能实跑的，本次都重跑或补跑。
> **一句话结论**：**P0 = 0，P1 = 4（全部已修复并做反向验证）**。旧版本数据夹具、
> 恶意输入、真实浏览器 A–F 与全部门禁通过，**达到发布候选（RC）条件**；
> 审计时的非阻塞 P2/P3 已在 0.6.0 处理：P2-2 修复；A-05/08/09/10 修复；
> 分支来源已持久化；分享解码有深度闸门；回放越界改为报错；bundle 预算已加。
> **当前生产：0.6.0 热修 `af7ca3e`（部署 `f2b8c458…`）。**

---

## 1. 范围与方法

### 1.1 审计范围

- Phase 11A：外部棋谱/备份格式、严格导入、批量事务、进度合并、会话迁移。
- Phase 11B：Position 模型、局面编辑器、局面库、内部 v1→v2、DB v2→v3。
- Phase 11C：单层分支、回放游标、终局/认输语义、原棋谱保护、分支独立保存。
- Phase 11D：版本化 Fragment 分享、严格解码、只读预览、显式导入、跨上下文导航。
- 横切：数据格式与迁移、事务与内存兜底、大小限制、状态机一致性、AI 版本闸门、
  A11y/响应式/键盘/触摸、分层与依赖方向、性能与构建产物。

### 1.2 取证方式

| 路 | 实际执行 |
| --- | --- |
| 文档 | 通读 `AGENTS.md`、`RULES.md`、`ARCHITECTURE.md`、`ROADMAP.md`、`TEST_REPORT.md`、`docs/data/*`、`docs/positions/*`、`docs/variations/*`、`docs/sharing/*` |
| 代码 | 独立通读 `persist/`（schema/records/positions/progress/storage/transfer）、`sharing/link`、`core/position`、`core/branch`、`store/gameStore`、`store/editorStore`、分享/分支/编辑器 UI 与 `App` |
| 旧数据 | 新增正式旧版本夹具 [`fixtures/phase11e/`](fixtures/phase11e/)；在 fake IndexedDB 与真实 Chrome 中验证升级、读取、导出、干净恢复 |
| 对抗输入 | 临时 Vitest 夹具（17 条）覆盖坏 JSON、超限、深嵌套、类型混淆、坐标/手顺/胜负、分享 fuzz、存储事务失败；证据已整理进本文与安全报告 |
| 浏览器 | 既有完整 E2E + 新增 3 条真实浏览器用例；另用隔离 Vite 服务器跑旧库与分享自动写入实验 |
| 门禁 | `lint` / `typecheck` / `test` / `build` / `e2e` / `e2e:prod` / `e2e:browsers` / `gates` / `bench:check` / `ui:probe` / `check:coverage` 全部实跑 |

**纪律**：不把「文档说做过」当证据；每个 P1 都有复现、修复和反向验证。
审计期间产生的临时脚本已删除，必要夹具与读数留在仓库。

---

## 2. 当前状态

| 项 | 值 |
| --- | --- |
| 审计基线 | `8f2fee3`（Phase 11D 评审整改完成） |
| 应用/引擎 | 审计时 `0.4.0`；现已 `0.6.0` / `search-1` |
| 内部数据版本 | `DB_VERSION=4`；progress 1；records 1；session 3；positions 2 |
| 外部格式 | 棋谱 `formatVersion=1`；备份 `formatVersion=2`；局面 v1；分享外壳 `v=1` |
| 生产 | `0.6.0` 热修 `af7ca3e`，部署 `f2b8c458…`，标签 `v0.6.0+build.1` |
| 计划 | 审计阶段不覆盖生产；最终已发布 `v0.5.0+build.1/2` 与 `v0.6.0`、`v0.6.0+build.1` |

### 2.1 最终门禁读数

| 命令 | 实际结果 |
| --- | --- |
| `yarn lint` | 通过 |
| `yarn typecheck` | 通过（app + e2e + bench 三个 tsconfig） |
| `yarn test` | **1,397 / 1,397**（88 文件，skip 0） |
| `yarn build` | 通过；`index-*.js` 409.84 kB（gzip 128.15 kB）、CSS 35.31 kB（gzip 7.52 kB）、Worker 13.99 kB |
| `yarn e2e` | **189 / 189**（Chrome 桌面 + 移动 + 平板） |
| `yarn e2e:prod` | **7 / 7** |
| `yarn e2e:browsers` | Firefox 9 + WebKit 9 = **18 / 18** |
| `yarn gates` | 0 循环 / knip 通过 / 0 重复 / 棘轮 1,397 · 189 |
| `yarn bench:check` | 19/19 断言 + 29 项不变量；6 条耗时行按基线跳过 |
| `yarn ui:probe` | **38 状态 / 308 张**，七条量化判据全过 |
| `yarn check:coverage` | 172 条 / 21 状态；实比 3,084 条，未缩小，另有 136 条新增覆盖 |
| CI | ✅ `40666665311` / `40667822033` / `40670683165` 全绿 |

**高负载说明与失败记录**：本机在审计期间长期有外部 `xelatex` 等进程占用 CPU。
第一次全量 `yarn e2e` 与另一次手动 Playwright 试验并发，后者清掉了共享的
`test-results/` 目录，导致 4 条失败：1 条 layout 断言读到 0（页面被 HMR 刷新）
与 3 条 tablet 的 trace/trace.zip `ENOENT`。**这次运行作废，不计入结果**；
无并发重跑 **186/186**（code-review 补 2 条夹具与 1 条 hash 用例后为 **189/189**）。旧实现的最大备份校验用例则真实超时（15 s 断言超时，
进程约 92 s），修复后 493 ms 通过——这不是环境噪声，已保留为回归用例。
上表是**无并发 Playwright** 的最终读数。

---

## 3. 发现与整改

### 3.1 P0

**无。**

### 3.2 P1（全部已修复）

| ID | 问题 | 复现 / 证据 | 修复 | 反向验证 |
| --- | --- | --- | --- | --- |
| **A-11E-01** | **直接打开分享链接会自动续走本地保存的 AI 对局，甚至落子并入库**，违反「预览不自动写入」 | 真实 Chrome：localStorage 存 1 手人机局（轮到 AI），`goto('/#share=…')` 后 2.5 s，session 变成 2 手；换成 8 手、AI 执黑可成的棋，5 s 后 `records` 从 0 变成 1。分享页还会顺手打开/升级学习库 | `restore` 增加 `resumeAi:false`；`bootstrapStore` 在 `#share=` 路径不续走 AI；预览阶段不启动学习库；离开分享页才显式续走 | 新增 E2E：打开有效分享后 session 仍 1 手、`indexedDB.databases()` 无 `gomoku-lab`；点「返回应用」后才变成 2 手。修复后真实浏览器复测通过 |
| **A-11E-02** | **`saveGameReplacing` 只比较「先手 + 手顺」，会删掉内容不同的旧棋谱**。同一手顺、不同模式/执子/难度/认输方的两条独立记录，第二条保存时第一条被永久删除 | 单测复现：先存 `pvp/easy/黑`，再存同手顺 `pve/hard/白`，旧实现只剩 1 条 | 改用与导入去重相同的 `recordContentKey`（先手、手顺、模式、执子、难度、认输方全比） | 新增回归用例；临时撤掉修复后该用例变红（只剩 1 条），恢复后 2 条都在 |
| **A-11E-03** | **接近 10 MiB 的备份校验是 O(n²)**：`validateSequence` 每手调用 `applyMove`，而 `applyMove` 每次都从头 `replay`。2,000 局 × 225 手的主线程校验超过 15 s，旧的临时性能用例进程耗时约 92 s | 临时夹具：2,000 局 × 225 手，**6,830,098 字节**；旧实现 15 s 超时，新实现 **493 ms** 返回 `too_many_moves` | 只 `replay()` 一次；`state.moves.length` 即第一个坏手的位置，再用 `validateMove` 判错误类型。规则仍来自 `core`，没有复制一份 | 新增「接近 10 MiB 备份」用例；用 `HEAD` 旧实现跑该用例 15 s 超时；恢复新实现后通过 |
| **A-11E-04** | **局面文件导入先 `file.text()` 再检查 10 MiB**，超大文件会先整块读入内存；棋谱/备份面板已在读前检查，局面编辑器没有 | 代码路径对比；临时文件夹具可构造 `size > MAX_IMPORT_BYTES` | `PositionEditor.importPosition` 在读文件前检查 `file.size`，超限直接报错 | 新增组件用例：超大文件时 `file.text()` 一次都没被调用；临时移除检查后该用例变红（`text is not iterable`，因为 `text()` 未被调用），恢复后通过 |

### 3.3 P2（审计时记录；0.6.0 起全部处理）

| ID | 问题 | 影响 | 处理建议 |
| --- | --- | --- | --- |
| **A-11E-05** | **「完整备份」不包含自定义局面** | 用户按提示导出完整备份后换设备/清缓存，局面不会回来；可单独导出局面文件 | **已修复（0.6.0）**：备份 `formatVersion=2` 含 `positions`，v1 仍可导入 |
| **A-11E-06** | 局面写入在事务提交阶段失败时，退回内存兜底并返回 `persisted:false`；但 `list()` 仍读 IndexedDB，刚写的记录在本次会话的列表里也看不到 | 提示说「本次会话可用」，实际列表不可见；刷新后丢失 | 已修复（2026-10-28）：事务失败抛错，界面标保存失败 |
| **A-11E-07** | 学习进度 `saveProgress` 吞掉落盘失败；偏好写入同样没有可观测信号。数据管理面板会把「进度合并完成 / 偏好已恢复」显示成功 | 存储失败时刷新后进度/偏好丢失，用户已被告知成功 | 已修复（2026-10-28）：导入进度严格落盘、偏好回读回滚；普通课时写入仍为尽力而为 |
| **A-11E-08** | 导出「全部棋谱/完整备份」忽略 `GameRecordList.skipped`；一条损坏或未结束的旧记录会让 `toBackupFile` 整个抛错 | 可能静默少导出旧记录，或一条坏记录阻断全部导出 | **已修复（0.6.0）**：导出跳过坏记录并显示计数 |
| **A-11E-09** | 局面编辑器「保存局面」没有 in-flight 守卫；快速双击可能以 `savedId=null` 并发新增两条相同内容。分享预览的局面保存也是先 `list()` 去重再 `save()`，跨标签页存在同类竞态 | 重复局面记录，不丢旧数据 | **已修复（0.6.0）**：保存按钮 `saving` 闸门 + DB v4 `contentKey` 唯一索引 |
| **A-11E-10** | `parseRecord` 只校验记录结构/坐标，不验证手顺是否合法/已结束；`positionFromReplay` 对非法 `ply` 静默 clamp | 损坏旧记录可能在列表/回放中显示截断结果，导出/分享可能失败或生成接收端拒绝的链接 | **已修复（0.6.0）**：`parseRecord` 严格校验手顺；`positionFromReplay` 越界/非法前缀均报错 |

### 3.4 P3（记录，不影响 RC）

- ~~分支来源元数据不持久化~~：**0.6.0 已修**（session v3 持久化 `branch`，刷新后横幅恢复）。
- ~~在已经运行着的应用内手动改 hash 进入分享页，不会暂停已经在飞的 AI 请求~~：**发布前 code-review 已修复**（`suspendAi`），见 §8。
- ~~没有仓库级 bundle budget 门禁~~：**0.6.0 已加**（入口 gzip ≤ 135 kB）。
- `positionContentKey` 依赖 provenance 对象键序；当前生产路径的键序稳定，但不是规范化的序列化。
- ~~分享解码没有独立深度闸门~~：**0.6.0 已加**（`jsonDepth` 先于 `JSON.parse`）。
- ~~`positionFromReplay` 越界 clamp~~：**0.6.0 已改为报错**（含非法前缀）。
- 空字符串标题的局面文件可被解析，分享预览保存后标题为空；UI 正常路径会回落为「未命名局面」。
- `goTo(NaN)` 未显式拒绝；只可能来自程序调用，不是用户滑杆输入。

---

## 4. 状态机与不变量审计

| 检查 | 结论 | 证据 |
| --- | --- | --- |
| 唯一 `GameState` 构造路径 | `replay()` 是唯一来源；分支只取合法前缀 | `core/game.ts`、`core/branch.ts`、单元测试 |
| 分支游标 | `cursor` 0..`moves.length`；越界/非整数拒绝 | `branch.test.ts` |
| 终局阻止继续 | 五连/和棋拒绝建立分支；认输按棋盘状态判断，不继承认输 | `branch.test.ts`、`gameStore.test.ts` |
| 来源完整性 | 先校验整条来源手顺，损坏尾段也拒绝；不拿 `replay` 截断结果当成功 | `buildBranchGame` 测试 |
| 原棋谱内容 | 分支只读来源；保存分支不修改来源内容；内容身份去重不会误删不同配置的旧记录 | A-11E-02 修复 + 单测 + E2E 47 手原谱保留 |
| 分支独立保存 | 完成分支走普通终局入库；源棋谱删除后分支仍可回放 | `gameStore.test.ts`、`variations.spec.ts` |
| AI 双闸门 | 所有落子/提示/分析/编辑器响应都检查 `requestId` + `gameVersion`；分支接管清 pending | `gameStore.test.ts`、`editorStore.test.ts` |
| 编辑器隔离 | 编辑历史是局部快照栈；不调用 `gameStore.undo`；分析只写 `editorStore` | `editorStore.test.ts`、E2E「编辑/分析不改变正式棋盘」 |
| 认输语义 | `resignerFor` 单一出处；人机认玩家、双人认当前手方；刷新恢复认输终局不会复活 | `gameStore.test.ts`、E2E |
| 分享只读 | 预览不写棋谱/局面；直接打开不续走 AI、不建学习库；离开才续走 | A-11E-01、E2E |
| 分享/导入不自动覆盖 | 预览后必须显式点击；棋谱按内容去重；局面先查内容身份 | `SharePreview`、`DataManagementPanel` 测试 |
| 事务与兜底 | 棋谱批量导入单事务，失败整笔回滚；打不开库才内存兜底 | `gameRecords.test.ts`、E2E 事务失败 |
| 旧数据 | v1/v2 库、v1 记录、v1 会话、v1 外部文件均可读；见兼容性报告 | 夹具 + 真实 Chrome |

### 4.1 工程约束

- **规则/校验没有第二份**：严格导入只调用 `core/game.replay` 与
  `core/rules.validateMove`；内容身份统一走 `recordContentKey`，导入去重与终局替换
  使用同一套字段。没有为分享/分支另写一套坐标或胜负规则。
- **依赖方向**：`persist/transfer` 不碰 React/DOM；`sharing/link` 只做编码与分发；
  `App`/`main` 是组合根，负责装配「分享预览不续走 AI / 不启动学习库」。
- **无新增运行时依赖**；发布提交只改 `package.json` 的 version，`yarn.lock` 未改。
- **全局状态**：分享没有新增模块级可变状态；`learnBootstrapped` 是单个组件内的
  `useRef`，不跨页面泄漏。AI Worker 仍是单例，没有为分享新建第二套请求通道。
- **无 `enum` / `eval` / `Function` / 动态脚本**。

---

## 5. 真实浏览器流程 A–F

| # | 流程 | 结果 | 用例 |
| --- | --- | --- | --- |
| A | 棋谱导出 → 干净上下文导入 → 回放 → 刷新 | 通过；9 手，刷新仍在 | `e2e/backup.spec.ts` |
| B | 47 手 → 第 26 手 → 分支 → AI → 认输保存 → 原谱不变 → 刷新 | 通过；27 手分支 + 47 手原谱 | `e2e/variations.spec.ts` |
| C | 自由局面编辑 → AI 分析 → 保存 → 刷新/重开 | 通过；编辑/分析不污染正式对局 | `e2e/editor.spec.ts`（Chrome/Firefox/WebKit） |
| D | 分享链接在独立 context 预览 → 显式保存 → 刷新/重开/重复 | 通过；B 预览前 0 条，保存后 1 条，重复不增 | `e2e/sharing.spec.ts` |
| E | 坏文件导入 → 错误 → 零写入；取消预览 → 零写入 | 通过 | `e2e/backup.spec.ts` |
| F | 棋谱事务失败 → 明确「没有写入任何棋谱」，不退内存冒充 | 通过 | `e2e/backup.spec.ts`（页面内覆写 `IDBDatabase.transaction`） |
| D+ | 回放第 5 手分享 → 独立 context 预览 5 子 → 保存到局面库 | 通过 | `e2e/sharing.spec.ts` |
| D++ | 打开分享不自动续走/不建库；返回后才续走 | 通过 | `e2e/sharing.spec.ts` |

---

## 6. 性能与兼容性

- **导入校验**：6,830,098 字节、2,000 局 × 225 手，从「旧实现 >15 s 超时」降到
  **493 ms**；单次 `replay` 后只做一次 `validateMove`。
- **分享**：225 手整盘与满盘局面 token 均在 12,000 字符内；解码为同步小对象。
- **数据升级**：真实 Chrome 中 v2 库打开后版本 3，`positions/progress/records`
  三表就位；2 条旧棋谱可读，导出备份 2 条，干净上下文恢复 2 条，刷新仍 2 条；
  旧进度显示「已完成 1 / 8 节」。
- **构建**：`index-*.js` 409.84 kB（gzip 128.15 kB），CSS gzip 7.52 kB，Worker 13.99 kB。
  没有新增运行时依赖（发布提交只改 version；`yarn.lock` 未改）。
- **A11y/响应式**：UI 探针 38 状态 / 308 张，七条判据全过；新增 E2E 覆盖
  分享预览、回放分享、事务失败；Firefox/WebKit 编辑器 18/18。

---

## 7. 已知问题与发布判断

**RC 条件**：本轮修复后没有开放 P0/P1；本地全档门禁、旧数据夹具、恶意输入与
真实浏览器 A–F 均通过，**可以作为发布候选**。

**但不能把「RC」当成「已发布」**：

- 生产已发布 `0.5.0`（热修 `db8881c` / `f3301897…`）；`v0.5.0` 标签指向首发 `6616ebe`，热修标签 `v0.5.0+build.2`。
- P2-1/3 已接受并披露；P2-2（存储失败提示）作为发布阻断已修复。
- CI 前两轮已运行：`40666665311`（代码/版本）与 `40667822033`（文档）全绿；第二轮整改 `fb7fe61` 推送后重跑。
- 预览 `a7b4ac2d…` 与生产 `f3301897…` 均通过 `e2e:remote` 189/189。

**结论**：**Phase 11C/11D + 本轮审计修复达到 RC；不建议在未处理 P2 发布决策前
自动上线。** 发布动作必须等待用户明确授权。

详见 [DATA_COMPATIBILITY_REPORT.md](DATA_COMPATIBILITY_REPORT.md)、
[IMPORT_SECURITY_REPORT.md](IMPORT_SECURITY_REPORT.md) 与
[PHASE_11_READINESS.md](../release/PHASE_11_READINESS.md)。

## 8. 发布前 code-review 跟进（2026-10-27）

在发布评审前对 `v0.4.0...HEAD` 跑了 Standards / Spec 两轴评审（修复提交 `20f28a3`），并做了以下修复：

- **文档同步**：`ARCHITECTURE.md` 的严格校验描述改为「单次 `replay()`」；
  `IMPORT_SECURITY_REPORT.md` 同步；`sharing/` 的描述补上分享内容/URL 生成。
- **播报**：分支横幅从 `role="status"` 改为 `role="note"`，回到「只有一个 live region」；
  `e2e/variations.spec.ts` 在分支态断言 `role=status` 仍只有 `board-announcer`。
- **应用内 hash 进入分享**：`gameStore.suspendAi()` 中止在飞 AI；`App` 的 `hashchange`
  在进入分享时调用，离开时续走。补了「迟到响应不落子」单测。
- **旧夹具自动化**：新增 `e2e/fixtures.spec.ts`，直接读取
  `docs/audit/fixtures/phase11e/` 并把旧 v2 库升级、导出完整备份、干净恢复纳入主套件。
- **模块边界**：`ShareLinkDialog` 从 `features/review/` 移到 `features/sharing/`；
  根容器样式抽成 `ROOT_CLASS`，避免分享页与四模块页漂移。

未改的 judgement：`BranchOrigin.sourceContentKey` 仍作为来源元数据保留（当前无 UI 读取）；
两处小的「胜方文案」与 `{origin,pathname}` 仍各写一份；`SharePreview.savePosition`
仍先查后写（P2 竞态未被本次 code-review 扩大为修复项）。

**最终门禁（code-review 后）**：单测 **1,397 / 1,397**；E2E **189 / 189**；
生产冒烟 7；Firefox/WebKit 18；UI 探针 308；覆盖 3,084；bench 19+29。
