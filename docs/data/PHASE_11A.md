# Phase 11A · 数据备份、棋谱导入导出与版本迁移

**日期**：2026-10-22
**定位**：建立本地数据备份/恢复体系；不引入后端、账号、云数据库或第三方同步。
**结论**：功能完成并通过单元、组件与真实浏览器验收；**尚未发布到生产**。

## 1. 现有数据模型审计

| 数据 | 形状 | 版本 | 备注 |
| --- | --- | --- | --- |
| IndexedDB | `gomoku-lab`，`progress` + `records` | `DB_VERSION = 2` | 两表共用库，`ensureSchema` 统一建表 |
| 学习进度 | `completedLessons` / `solvedPuzzles` / `lastVisited` / `lastView` | `1` | 版本不符退回空进度 |
| 棋谱 | 自增 `seq` + 手顺 + 模式/执子/难度 + `resignedBy` + 推导 `winner` | `1` | **不存时间**；`seq` 只在本库有效 |
| 对局会话 | `localStorage` JSON | `2` | v1 没有 `resignedBy` |
| 内存兜底 | 模块内单例 | — | IndexedDB 失败时本次会话可读，刷新丢失 |

现有 `replay()` 对非法手顺**截断**到合法前缀；这适合旧存档恢复，但会把坏文件
偷偷变短。导入路径因此另写严格序列校验，不复用截断语义。

## 2. 外部格式

- 单盘：`gomoku-lab.game`（格式/版本/棋盘/规则/手顺/模式/执子/难度/结束方式/来源）。
- 完整备份：`gomoku-lab.backup`（`games` + 可选 `progress` / `preferences` / `session`）。
- 只导出棋谱沿用备份格式，省略可选段。
- 重复身份：`[firstPlayer, mode, humanColor, difficulty, resignedBy, moves]`，
  不比较 `seq`，不把来源元数据算进去。
- 规范全文：[FILE_FORMAT.md](FILE_FORMAT.md)。

## 3. 严格校验

`parseImportText` 在 `JSON.parse` 前先查大小与嵌套深度；之后检查：

1. JSON 合法性 / 顶层对象 / 格式标识 / 版本；
2. 棋盘尺寸与规则；
3. 坐标是有限整数且在 0–14；
4. 手顺逐手用 `applyMove` 严格应用——重复落子、终局后落子直接拒绝；
5. 结束方式与手顺一致：五连赢家、和棋满盘、认输方与赢家互斥且认输前未结束；
6. 零手认输合法；
7. 数组/字符串/局数/总手数上限；
8. 未知字段只警告；未来版本明确拒绝；
9. 单条坏棋谱不会截断成合法前缀，也不会让整份备份静默清空。

## 4. 写入与失败恢复

- `GameRecordsStorage.importMany`：一个 IndexedDB `readwrite` 事务内 `getAll`
  去重 + 逐条 `add`；事务失败整笔回滚。失败/不可用退回内存，`persisted=false`。
- 进度在棋谱之后单独合并（并集，保留本地位置）；失败分项报告。
- 偏好/会话默认不覆盖；需用户显式勾选，会话还会提示「替换当前进行中的棋局」。
- 解析失败、校验失败、取消：零写入。
- **本阶段不提供替换**：不拿「删除后插入」冒充完整恢复。

## 5. 迁移

- 本阶段**未改内部 schema**，不为「有迁移」而递增版本。
- 会话 v1→v2：只读迁移，补 `resignedBy: null`，下次写入自然升到 v2。
- 未来规则见 [SCHEMA_MIGRATION.md](SCHEMA_MIGRATION.md)。

## 6. UI

复盘页「数据管理」面板：导出全部棋谱 / 完整备份 / 导入文件；每条棋谱有单盘导出。
导入预览显示版本、总数、可导入、重复、无效、无效原因与可选恢复段；移动端按钮换行。

截图：

- [数据管理面板](screenshots/data-management.png)
- [导入预览](screenshots/import-preview.png)
- [导入结果](screenshots/import-result.png)
- [导入后回放](screenshots/replay-imported.png)
- [移动端数据管理](screenshots/mobile-data-management.png)

## 7. 测试与验收

- 单元 / 组件：**1,269 / 1,269**（78 文件）。新增覆盖格式往返、严格校验 21 类、
  批量事务/去重/降级、进度合并、会话 v1 迁移、面板导入取消/重复/无效/偏好。
- E2E：**166 / 166**；新增 `e2e/backup.spec.ts` 4 条：
  单盘导出→干净上下文导入→回放/刷新；完整备份恢复四类数据并重复导入跳过；
  坏文件零写入与取消零写入；v1 会话在真实浏览器升级并恢复。
- 最终验收（本地生产构建 + 真实 Chrome）：用当前正式版本的数据形状（v2 库、
  progress v1、records v1、session v2）种子 → 导出完整备份 → 干净上下文导入：
  - 棋谱 1 条，回放末手 **9 子**；
  - 进度「已完成 1 / 8 节」；
  - 深色偏好恢复；
  - 进行中会话恢复 **3 手**；
  - 刷新后棋谱仍在。
- 原始结果：[phase11a-restore.json](evidence/phase11a-restore.json)。

### 门禁

| 命令 | 结果 |
| --- | --- |
| `yarn lint` / `yarn typecheck` | 通过 |
| `yarn test` | **1,269 / 1,269**（78 文件） |
| `yarn build` | 通过 |
| `yarn e2e` | **166 / 166**（完整运行；高系统负载下复跑见下方说明） |
| `yarn e2e:prod` | **6 / 6** |
| `yarn gates` | 循环 0 / knip 通过 / 0 重复 / 棘轮 1,269 · 166 |
| `yarn bench:check` | 19/19 断言 + 29 不变量 |
| `yarn ui:probe --out ci` | 38 状态 / 308 张，七条判据全过 |
| CI @ `3e0518b` | 成功（run `39727977371`；fast / e2e / probe / bench 四个 job 全绿） |
| 覆盖棘轮 | 3,084 条，未缩小（+136 新增覆盖） |

**环境说明**：本机在系统 load average 52–103 时，全量 e2e 有若干时序用例
（复盘回放、刷新持久、学习/残局刷新）超时；`--last-failed --workers=2` 全部复过。
这是机器负载，不是断言失败；功能代码未改这些路径。

## 8. 已知限制

- 只提供合并，不提供替换/清空恢复。
- 无压缩；10 MiB、2,000 局上限，超大库需分批。
- 进度是并集，不处理「备份里删掉了某节课」这种反向差异。
- 偏好/会话写 `localStorage`，与 IndexedDB 不同事务；失败分项报告。
- 仅 Chrome/Chromium 实测；Safari/Firefox 未验。
- 未部署到生产；生产仍是 Phase 10F 的 `0.2.0`。

## 9. 文件

- `src/persist/recordIdentity.ts`
- `src/persist/transfer/format.ts`
- `src/persist/transfer/validate.ts`
- `src/persist/gameRecords.ts`（`importMany`）
- `src/persist/progress.ts`（`mergeProgress`）
- `src/persist/storage.ts`（会话 v1→v2）
- `src/store/learnStore.ts`（`adoptProgress`）
- `src/features/review/DataManagementPanel.tsx`
- `src/features/review/download.ts`
- `src/features/review/GameLibrary.tsx` / `ReviewScreen.tsx`
- 文档：`docs/data/*`；测试：`src/persist/transfer/*.test.ts`、`e2e/backup.spec.ts`
