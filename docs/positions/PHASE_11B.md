# Phase 11B · 棋盘编辑器与自定义局面研究

**日期**：2026-10-23（2026-10-24 补齐已知限制）
**定位**：独立的局面研究工具；不是第二套五子棋引擎，不引入后端/账号/云同步。
**状态**：功能完成并通过单元、组件、桌面/移动/平板真实浏览器验收，编辑器主路径另过
Firefox/WebKit；**尚未发布到生产**。
提交 `3444c57`；GitHub Actions `quality` run `39830442402` 四个 job（fast / probe / bench / e2e）全绿。

## 1. 数据模型审计

- `GameState` 由 `replay()` 从手顺重建；`replay` 遇非法手顺**截断**，适合旧存档恢复，
  不适合证明自由摆盘。
- 棋谱库 `GameRecord` 以 `seq` 排序、不存时间；不能把自由摆盘塞进去。
- IndexedDB `DB_VERSION=3`（Phase 11B 新增 `positions`），`progress` + `records` + `positions`
  共库；`ensureSchema` 是唯一建表处。
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
- `src/persist/positions.ts`：保存/列出/按 id 更新/删除；记录 `createdAt` / `updatedAt`
  （时钟由调用方注入），列表按最近保存排序；内部 schema 从 v1 只读迁移到 v2，
  旧记录时间显示为「时间未知」。删除返回 `{deleted,persisted}`，内存兜底时如实说明
  「刷新后可能仍在」。
- 内存兜底 + `persisted`；读到不一致的 provenance 降级为自由摆盘，保留盘面。
- 外部 `gomoku-lab.position` v1：stones 列表 + 可选标题/已知手顺；严格大小/深度、
  重复点、越界、未来版本、provenance 一致性校验。

### UI

复盘页「局面研究」→ `features/positions/PositionEditor.tsx`：棋盘 + 编辑工具 /
局面信息 / AI 分析 / 保存与研究。桌面右侧栏，移动端棋盘优先、面板下排。
保存面板显示最近保存时间；已保存记录可二次确认删除，删除后当前棋盘保留。
AI 分析可选五档（入门/初级/中级/高级/专家），预算取该档难度参数；切换档位会作废
在飞响应。详见 [EDITOR_DESIGN.md](EDITOR_DESIGN.md)。

## 3. 测试与验收

- 单元 / 组件：**1,330 / 1,330**（83 文件）。
  - Position 模型 12 条：放置/擦除/覆盖/下一手/五连/双方五连/奇偶/满盘/已知手顺；
  - editorStore 10 条：撤销重做/分支失效/载入重置/下一手/清空/分析不可用/旧响应失效/Worker 错误/档位；
  - positions 10 条：保存/更新/删除/排序/时间/降级/坏 cells/坏手顺降级/位置 v1→v2/库 v2→v3；
  - position 文件格式 5 条：自由/已知手顺往返、不一致、重复点、未来版本；
  - Board 编辑器模式 +2；编辑器组件 10 条；音效上下文卸载拒绝 +1。
- E2E：**174 / 174**。新增 8 条：桌面编辑器 6（编辑/保存刷新/载入棋谱/AI/导入导出/双方五连）
  + 移动 1（触摸/无溢出）+ 平板 1（两栏/触摸）。
- 跨浏览器：`yarn e2e:browsers` 在 Firefox 与 WebKit 各跑 6 条编辑器主路径，**12 / 12**。
- UI 探针：38 状态 / 308 张，七条判据全过；覆盖棘轮 3,084 条未缩小。
- 截图：[桌面](screenshots/editor-desktop.png)、[AI 分析](screenshots/editor-analysis.png)、
  [移动端](screenshots/editor-mobile.png)。

## 4. 已知限制

- 自由摆盘只做静态检查；不证明存在合法历史（UI 明说）。
- AI 分析档位之间的差异来自真实参数（宽度/深度/算杀/预算），但专家档更慢；
  不提供自定义预算或「绝对最佳」结论。
- 编辑器主路径已过 Chrome / Firefox / WebKit；未做 Safari 真机、iOS 真机与全套
  174 条 E2E 的三引擎矩阵。
- 局面记录可删除，但暂不支持重命名已保存记录（改名后保存会更新同一 id）。
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
- `playwright.browsers.config.ts`（Firefox/WebKit 专项）
- 文档：`docs/positions/*`、`docs/data/FILE_FORMAT.md`、`SCHEMA_MIGRATION.md`
