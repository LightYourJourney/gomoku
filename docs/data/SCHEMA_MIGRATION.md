# 数据版本与迁移

## 1. 当前版本（0.6.0）

| 数据 | 位置 | 版本常量 | 当前值 |
| --- | --- | --- | --- |
| IndexedDB 库 | `gomoku-lab` | `DB_VERSION` | `4` |
| 学习进度 | `progress` 表 | `PROGRESS_SCHEMA_VERSION` | `1` |
| 棋谱 | `records` 表 | `GAME_RECORDS_SCHEMA_VERSION` | `1` |
| 对局会话 | `localStorage: gomoku-lab:session` | `SCHEMA_VERSION` | `3` |
| 自定义局面 | `positions` 表 | `POSITION_SCHEMA_VERSION` | `2` |
| 外部棋谱/局面 | 文件 | `GAME_FORMAT_VERSION` / position v1 | `1` |
| 外部完整备份 | 文件 | `BACKUP_FORMAT_VERSION` | `2` |

Phase 11B 新增 `positions` 把 `DB_VERSION` 升到 3；0.6.0 为局面内容唯一索引升到 4，
并把 session 升到 v3、备份外部格式升到 v2。`progress` / `records` 不动。
外部格式版本与内部版本独立（见 [FILE_FORMAT.md](FILE_FORMAT.md)）。

## 2. 已有迁移：会话 v1 → v2 → v3

`storage.ts` 的 v1 存档没有 `resignedBy`（那一版认输局无法恢复）。`decodeSession`
现在接受 `schemaVersion === 1`：

1. 校验 v1 的既有字段（手顺、先手、模式、执子、难度、坐标）；
2. 在内存里补 `resignedBy: null`，返回 `schemaVersion: 2`；
3. **只读迁移**：不立即改写 `localStorage`；下一次真正落子/状态变化时，
   `persistSession` 自然写成 v2。

v1 里即使出现 `resignedBy` 也不采信——那一版没有这个语义。无法解析的 v1 存档
仍然整条拒绝，不会把半截数据灌进状态机。

v3 增加 `branch`（分支来源）；v1/v2 读取时补 `null`，v3 校验四个字段后恢复横幅。

启动时 `loadSessionResult()` 会区分「没有存档」「JSON 损坏」「版本不支持」
「字段不完整/类型错误」，把具体原因放进 `GameStore.sessionError`，对战页显示警告；
`loadSession()` 保持返回 `null` 的旧接口。

## 2.1 Phase 11B：v2 → v3（新增 positions）

- 升级只做一件事：`ensureSchema` 在 `onupgradeneeded` 里补建 `positions`
  `{ keyPath:'id', autoIncrement:true }`；不迁移、不改写 `progress`/`records`。
- 旧 v2 库（含进度/棋谱）打开后三张表都在；已有数据逐条按原校验读取。
- 回滚到 0.3.0（DB 2）时，旧代码不认识 positions 表；IndexedDB 允许打开低版本？
  **不允许**——降级打开会触发 `VersionError`。因此回滚必须同时回滚数据库版本或
  接受编辑器不可用；生产回滚到 0.3.0 前应先导出需要保留的局面。
- 单条局面读不出时只跳过该条；坏 provenance 降级为自由摆盘，不丢盘面。

## 2.2 Phase 11B 限制补齐：局面记录 v1 → v2（只读迁移）

- v2 新增 `createdAt` / `updatedAt`，由调用方注入时钟后随保存写入；列表按最近保存排序。
- v1 记录读取时在内存里补 `createdAt: null`、`updatedAt: null` 并规范为 v2；
  不立即改写数据库，下次保存该条时才写成 v2。
- 时间未知的旧记录 UI 显示「时间未知（旧记录）」，不伪造 1970 年。
- `DB_VERSION` 不变（3）：这是对象字段形状变化，不是新表/新索引。

## 2.3 Phase 11E 审计（无 schema 变更）

- 审计用 [audit/fixtures/phase11e/](../audit/fixtures/phase11e/) 的 v1/v2 夹具重新验证：
  v1 库（仅 progress）→ v3、v2 库（progress+records）→ v3、positions v1→v2、
  session v1→v2、外部 v1 文件读取/导出/恢复，均通过。
- 本轮未改 `DB_VERSION` 或任何 `schemaVersion`；修复只涉及匹配语义、输入校验与分享启动时序。
- 新增的审计边界：完整备份仍不含自定义局面（见 [FILE_FORMAT.md](FILE_FORMAT.md) §3），
  局面需单独导出。

## 2.4 0.6.0：DB 3 → 4 与 session v3 / 备份 v2

- `DB_VERSION 3 → 4`：`positions` 增加 `contentKey` 唯一索引，跨标签页并发保存同一盘面
  只留一条。旧记录没有 `contentKey`，升级时不会被索引；下次保存时补上。
- `SCHEMA_VERSION 2 → 3`：session 增加 `branch`；旧 v1/v2 读取补 null，不写回。
- 外部备份 `formatVersion 1 → 2`：新增 `positions` 段；v1 备份仍可导入，按「文件中没有局面」处理。
- 回滚到 0.5.0：旧代码以 DB 3 打开 v4 会触发 `VersionError`；必须先导出完整备份，
  且不能直接降级打开。session v3 在 0.5.0 会被当作未来版本拒绝（只丢会话，不丢棋谱/局面）。

## 3. 旧库/旧记录的行为

- IndexedDB 老库（v1、只有 `progress` 表）打开时由 `ensureSchema` 补建 `records`；
  这是已有行为，Phase 09A 起由测试钉住。
- 单条棋谱读不出（版本/字段/坐标非法）时，`list()` 只跳过该条并报 `skipped` 数量；
  **不会清空整表**。
- 学习进度版本不符时退回空进度；这是当前策略，尚未做逐字段迁移。
- 外部导入中单条棋谱无效时，只拒绝该条并点名索引，其余有效棋谱仍可导入。

## 4. 未来新增内部版本的规则

1. **先写失败测试**：旧形状读入、迁移后形状、无法迁移时的具体错误。
2. 迁移函数与解析/校验分离：`migrateX(raw) -> X | MigrationError`，
   不把迁移逻辑塞进 `parseX` 的字段白名单里。
3. IndexedDB 结构性变更（新表/新索引）才递增 `DB_VERSION`；只改对象字段形状
   用各模块的 `schemaVersion` + 迁移，不动库版本。
4. **迁移前不破坏旧数据**：先读、校验、迁移到内存；成功后再写。
   写失败保留旧值；需要时用 `records` 现有记录逐条迁移，失败条目保留原样并报告。
5. 不因为单条无效而清空全部记录；批量迁移结果必须给出成功/失败/跳过计数。
6. 迁移必须有可回滚路径：发布前导出完整备份；迁移失败时 UI 说明具体版本与原因。
7. 外部格式的版本演进独立：新增可选字段不升版本；改变必填语义才升，
   旧解析器明确拒绝未来版本。

## 5. 明确不做

- 不建通用迁移框架/版本注册表：真正的数据迁移只有会话 v1→v2，v2→v3 只是补建
  `positions` 表；为假想的几十个版本写框架是过度设计。
- 不做「自动猜测字段」的兼容：猜错比拒绝更危险。
- 不在本阶段引入新的压缩格式。
