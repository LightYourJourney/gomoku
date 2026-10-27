# Phase 11E 旧版本数据夹具

这些文件是 **Phase 11E 独立审计**使用的旧版本夹具，**不是**当前导出器生成的
往返样本。它们按下列历史实现的真实字段形状手工构造：

- `session-v1.json`：Phase 11A 之前的 `localStorage: gomoku-lab:session` v1
  （没有 `resignedBy`）。
- `progress-v1.json`：`progress` 表的 v1 记录（键 `learning`）。
- `records-v1.json`：数据库 v2 的 `records` 表记录（`schemaVersion: 1`，
  带旧版存储的 `winner` 字段）。
- `positions-v1.json`：Phase 11B 最初版本的 `positions` 表 v1 记录
  （没有 `createdAt` / `updatedAt`）。
- `game-v1.json` / `backup-v1.json` / `position-v1.json`：外部格式 v1 文件。

审计时用它们在 fake IndexedDB 与真实 Chrome 中验证：v1 库 → v3 升级、
v1 记录只读迁移、旧文件严格解析、导出后在干净库恢复并比较内容身份。
当前代码导出器不会生成 `records-v1.json` 里的 `winner`（winner 读取时推导），
保留它是为了确保旧记录即使带旧字段也仍可读。
