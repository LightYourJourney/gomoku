# Phase 11B · 棋盘编辑器与自定义局面研究

**日期**：2026-10-23
**定位**：独立的局面研究工具；不是第二套五子棋引擎，不引入后端/账号/云同步。
**状态**：功能完成并通过单元、组件、移动/平板/桌面真实浏览器验收；**尚未发布到生产**。
提交 `3444c57`；GitHub Actions `quality` run `39830442402` 四个 job（fast / probe / bench / e2e）全绿。

## 1. 数据模型审计

- `GameState` 由 `replay()` 从手顺重建；`replay` 遇非法手顺**截断**，适合旧存档恢复，
  不适合证明自由摆盘。
- 棋谱库 `GameRecord` 以 `seq` 排序、不存时间；不能把自由摆盘塞进去。
- IndexedDB `DB_VERSION=2`，`progress` + `records` 共库；`ensureSchema` 是唯一建表处。
- 棋盘 `Board` 已有 ARIA grid、roving tabindex、方向键/命中区；编辑模式只需新增
  明确的 `editMode`，不需要复制整份 SVG。

## 2. 实现

### Position 模型

`src/core/position.ts`：`Position {board,nextPlayer}`，不生成 moves；提供
放/擦/清/下一手、全盘五连扫描、`analyzePosition` 分级、`positionFromReplay` 与
`isReplayConsistent`。详见 [POSITION_MODEL.md](POSITION_MODEL.md)。

### 编辑历史

`src/store/editorStore.ts`：局部快照栈的撤销/重做、工具、下一手、载入、分析；
任何编辑递增 `version` 并清空分析。与 `gameStore` 完全分离。

### 棋盘

`Board` 新增 `editMode` / `onEdit`；编辑模式允许作用在任意交叉点（含已有棋子），
正式对战/教学/复盘行为不变；ARIA/键盘/命中区全部复用。

### 持久化

- `src/persist/schema.ts`：`DB_VERSION 2 → 3`，新增 `positions` 表
  `{ keyPath:'id', autoIncrement:true }`；`progress`/`records` 不动。
- `src/persist/positions.ts`：保存/列出/按 id 更新/删除；内存兜底 + `persisted`；
  读到不一致的 provenance 降级为自由摆盘，保留盘面。
- 外部 `gomoku-lab.position` v1：stones 列表 + 可选标题/已知手顺；严格大小/深度、
  重复点、越界、未来版本、provenance 一致性校验。

### UI

复盘页「局面研究」→ `features/positions/PositionEditor.tsx`：棋盘 + 编辑工具 /
局面信息 / AI 分析 / 保存与研究。桌面右侧栏，移动端棋盘优先、面板下排。
详见 [EDITOR_DESIGN.md](EDITOR_DESIGN.md)。

## 3. 测试与验收

- 单元 / 组件：**1,323 / 1,323**（83 文件）。
  - Position 模型 12 条：放置/擦除/覆盖/下一手/五连/双方五连/奇偶/满盘/已知手顺；
  - editorStore 9 条：撤销重做/分支失效/载入重置/下一手/清空/分析不可用/旧响应失效/Worker 错误；
  - positions 7 条：保存/更新/删除/降级/坏 cells/坏手顺降级/v2→v3；
  - position 文件格式 5 条：自由/已知手顺往返、不一致、重复点、未来版本；
  - Board 编辑器模式 +2；编辑器组件 8 条。
- E2E：**174 / 174**。新增 8 条：桌面编辑器 6（编辑/保存刷新/载入棋谱/AI/导入导出/双方五连）
  + 移动 1（触摸/无溢出）+ 平板 1（两栏/触摸）。
- UI 探针：38 状态 / 308 张，七条判据全过；覆盖棘轮 3,084 条未缩小。
- 截图：[桌面](screenshots/editor-desktop.png)、[AI 分析](screenshots/editor-analysis.png)、
  [移动端](screenshots/editor-mobile.png)。

## 4. 已知限制

- AI 分析固定「中级 · 800ms」，不提供档位/预算选择。
- 自由摆盘只做静态检查；不证明存在合法历史（UI 明说）。
- 保存的局面不记时间；列表按自增 id 排序。
- 未做局面删除 UI（存储层有 delete）。
- 仅 Chrome/Chromium 实测；Safari/Firefox 未验。
- **未部署生产**；生产仍是 `0.3.0`（`1cd2be0`）。

## 5. 文件

- `src/core/position.ts` + test
- `src/store/editorStore.ts` + test
- `src/persist/schema.ts`、`src/persist/positions.ts` + test
- `src/persist/transfer/position.ts`、`guards.ts` + test
- `src/components/board/Board.tsx`（editMode）
- `src/features/positions/PositionEditor.tsx` + test
- `src/features/review/GameLibrary.tsx` / `ReviewScreen.tsx`
- `e2e/editor.spec.ts`、mobile/tablet 各 1 条
- 文档：`docs/positions/*`、`docs/data/FILE_FORMAT.md`、`SCHEMA_MIGRATION.md`
