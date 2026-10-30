# Phase 11E · 数据兼容性报告

> 对象：Phase 11A–11D 的本地数据、外部文件与升级路径。
> 夹具：[`fixtures/phase11e/`](fixtures/phase11e/)。
> 本文只记录**实际跑过**的路径；没有跑过的组合明确标成「未验证」。

## 1. 版本矩阵

| 数据 | 位置 | 当前版本 | 旧版本 | 读取策略 |
| --- | --- | --- | --- | --- |
| IndexedDB 库 | `gomoku-lab` | `DB_VERSION=4` | v1/v2/v3 | `ensureSchema` 补建缺表与 `contentKey` 唯一索引；旧表不改写 |
| 学习进度 | `progress` 表，键 `learning` | schema 1 | v1（同形状） | 版本不符返回空；不做逐字段猜测 |
| 棋谱 | `records` 表 | schema 1 | v1（同 schema，旧记录可能带 `winner`） | 逐条校验；`list()` 报告 `skipped` |
| 对局会话 | `localStorage: gomoku-lab:session` | schema 3 | v1（无 `resignedBy`）、v2（无 `branch`） | 只读迁移，补 `resignedBy:null` / `branch:null`；不立即回写 |
| 自定义局面 | `positions` 表 | schema 2 | v1（无时间字段） | 只读迁移，时间标 `null`；下次保存写 v2 |
| 外部棋谱/局面 | JSON 文件 | 棋谱 v1、局面 v1 | v1 | 严格校验；未来版本拒绝 |
| 外部完整备份 | JSON 文件 | `formatVersion=2`（含局面） | v1 | 严格校验；v1 仍可导入 |
| 分享链接 | URL Fragment | `v=1` | 无更早版本 | 版本过新拒绝；内容复用上述校验器 |

## 2. 旧版本夹具

夹具按历史实现的**实际字段形状**构造，不是当前导出器的往返：

| 夹具 | 验证点 |
| --- | --- |
| `session-v1.json` | 无 `resignedBy`；只读迁移；v1 里伪造的 `resignedBy` 不采信 |
| `progress-v1.json` | 完成课程/残局、`lastVisited`、`lastView` 原样读回 |
| `records-v1.json` | 两条 v1 记录（五连、零手认输），带旧 `winner` 字段；读取时重新推导 |
| `positions-v1.json` | 一条自由摆盘 + 一条已知手顺；v1→v2 时间未知 |
| `game-v1.json` / `backup-v1.json` / `position-v1.json` | 外部格式 v1 严格解析、导出后再解析 |

## 3. 升级 / 读取 / 导出 / 恢复实测

### 3.1 fake IndexedDB（可重复的单测级验证）

| 场景 | 结果 |
| --- | --- |
| v1 库（只有 progress）打开到 v3 | progress 原样可读；`positions/progress/records` 三表就位；库版本 3 |
| v2 库（progress+records）打开到 v3 | 2 条旧棋谱可读，`skipped=0`；五连胜者黑、零手认输胜者白；旧进度保留 |
| v2 记录导出 → 解析 → 干净内存库导入 | 2 条记录；内容身份与导出前一致；无重复 |
| positions v1 读取 | `schemaVersion=2`、`createdAt/updatedAt=null`；盘面与 provenance 保留 |
| positions v1 更新保存 | 写回 v2，`createdAt`/`updatedAt=1234`（注入时钟）；永久用例见 `src/persist/positions.test.ts` |
| 外部 game/backup/position v1 | 严格校验通过；重新导出后内容身份不变；备份重复导入 `imported=0, duplicates=2` |
| session v1 | 迁移为 v2，`resignedBy=null`；损坏坐标/未来版本拒绝 |

### 3.2 真实 Chrome（隔离 Vite 服务器）

用 `records-v1.json` + `progress-v1.json` 种一个 **v2 库**，再打开当前应用：

| 检查 | 实测 |
| --- | --- |
| 升级后的库版本 | 3 |
| 表 | `positions`、`progress`、`records` |
| 棋谱列表 | 2 条 |
| 学习进度 | 「已完成 1 / 8 节」 |
| 「完整备份」文件 | `gomoku-lab.backup`、2 局、进度 `completedLessons=['rules']`、`session=null`（种库时没有会话） |
| 干净上下文导入 | 「已导入 2 条，跳过重复 0 条」，刷新后仍 2 条 |
| 旧 `lastView` | 恢复后按备份进入对应页；用户点击后位置正常更新 |

### 3.3 旧会话与局面

- `e2e/backup.spec.ts` 的 v1 会话在真实 Chrome 升级到 v2，3 手仍恢复；下一次落子后
  localStorage 写成 `schemaVersion:2`。
- `e2e/editor.spec.ts` 的 v2→v3 真实浏览器用例保留了旧进度与棋谱；`positions` 表可写。
- `positions v1` 的真实浏览器读取由组件/单测覆盖；没有单独为它增加一条 E2E，
  但同一条 `ensureSchema` / `parseSavedPosition` 路径已被上述用例执行。

## 4. 兼容性结论

| 结论 | 状态 |
| --- | --- |
| v1 库 → v3 | **通过**；旧 progress 保留，缺表补建 |
| v2 库 → v3 | **通过**；旧 records/progress 保留 |
| 旧 records v1 | **通过**；旧 `winner` 不采信，按手顺推导 |
| session v1 → v2 | **通过**；只读迁移，下一次写入落 v2 |
| positions v1 → v2 | **通过**；时间未知，不伪造 1970 |
| 外部 v1 棋谱/备份/局面 | **通过**；严格解析、可再导出、可干净恢复 |
| 未来内部/外部版本 | 明确拒绝或降级/报错，不猜测字段 |

**没有发现升级路径上的 P0/P1 数据丢失。** 本轮唯一确认的永久删除风险
（A-11E-02：同手顺、不同模式/执子/难度/认输方被内容匹配误删）已修复并反向验证。

## 5. 已知边界（P2/P3）

1. **完整备份不包含自定义局面**（A-11E-05）。面板已明示；局面只能逐个导出。
   若产品要求「完整备份覆盖全部数据」，需要扩展外部备份格式。
2. **存储失败提示（0.6.0 已修复）**：局面事务失败抛错；导入进度的严格落盘；偏好回读校验并回滚。
3. **导出跳过坏记录（0.6.0 已修复）**：跳过数量会在结果里显示；只含坏记录时提示跳过数。
4. **分支来源（0.6.0 已修复）**：session v3 与备份 v2 持久化 `branch`；刷新后横幅恢复。
5. **读入侧校验**：`parseRecord` 只做结构/坐标校验，不验证手顺完整合法；
   损坏旧记录可能显示截断结果。对外导入路径已严格校验，不受此影响。
6. **回滚**：生产 `0.4.0` 已经是 DB v3；本轮没有 DB 版本变化。回滚到 0.3.0（DB2）
   仍不能直接打开 v3 库，必须按 11B 的导出/回滚说明处理。

## 6. 复现方式

- 单测级：`yarn test` 覆盖 `persist/*`、`transfer/*`、`store/gameStore`、
  `features/positions`、`features/sharing`。
- 真实浏览器：`yarn e2e`（189 条）与 `yarn e2e:prod`（7 条）。
- 旧夹具：可直接用 `docs/audit/fixtures/phase11e/` 的 JSON 重建库或文件；
  夹具 README 说明了每个文件的来源形状。
