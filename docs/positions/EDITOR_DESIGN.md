# 局面编辑器设计

## 1. 入口与页面

复盘页顶部「局面研究」进入；编辑器是复盘页内的一个页面状态，不新增顶层导航，
也不改 `lastView` 数据格式。返回按钮回棋谱库。

## 2. 复用棋盘，而不是复制 SVG

`components/board/Board.tsx` 新增**明确的 `editMode`**：

- `editMode=true` 时，点击/回车作用在**任意交叉点**（包括已有棋子），回调 `onEdit`；
- 正式对战/教学/复盘仍走 `onPlay`，占用点依旧被拒绝；
- 保留 ARIA grid、roving tabindex、方向键/Home/End、焦点环、整格命中区；
- `editMode` 下不显示悬停预览棋子（工具可能是擦除）。

编辑器使用同一个 `BoardStage`，视觉与对战棋盘一致；没有第二份 SVG/CSS 实现。

## 3. 工具与编辑历史

- 工具：黑棋 / 白棋 / 擦除；`aria-pressed` 表达当前工具。
- 下一手：黑 / 白；改下一手也是可撤销的编辑。
- 清空、撤销、重做。
- 历史是 `EditorSnapshot { position, provenance }` 的**局部快照栈**：
  - 每次有效编辑压栈，重做栈清空；
  - 撤销/重做恢复盘面、下一手与 provenance；
  - 与 `gameStore.undo()` 无任何复用/调用。
- 同色覆盖是无操作，不产生历史；异色覆盖是替换。
- 上限 200 个快照，避免长时间摆盘无限占内存。

## 4. 保存、打开与文件

- 保存到 IndexedDB `positions` 表（DB_VERSION 3）；标题可编辑。
- 保存失败：内存兜底时明确说「本次会话可用，刷新后可能丢失」；列表降级也会提示。
- 再次保存同一 id 更新原记录，不复制。
- 「打开已保存局面」下拉按 id 降序。
- 导出/导入 `gomoku-lab.position` v1；导入走 Phase 11A 的严格 JSON 检查
  （大小/深度/重复交叉点/未知版本/已知手顺一致性），失败零写入。
- 载入棋谱某一手：选择棋谱 + 手数，用 `positionFromReplay` 生成快照与 provenance。

## 5. AI 分析

- 按钮只在 `analyzePosition(...).searchable` 时可用；否则显示具体原因。
- 请求：`purpose='hint'`、中级、800ms，带 `gameVersion = editor.version`。
- 展示：候选点（棋盘 1/2/3 标记 + 列表）、深度、节点、耗时、精确/启发式。
- 任何编辑递增 version 并清空分析；旧响应按 `requestId + gameVersion` 丢弃。
- 分析只写 `editorStore`，不写正式对战 store，不落子、不改棋谱。

## 6. 响应式

- ≥1024（`wide-layout`）：棋盘为主列、344px 右侧栏（编辑工具 / 局面信息 / AI / 保存）。
- <1024：棋盘在上（`BoardStage` 固定高度），工具与面板在下，自然滚动。
- 390 手机实测无横向溢出；1080 平板两栏不压盖。
- 工具/下一手按钮换行，不挤棋盘。

## 7. 无障碍

- 工具与下一手是两个有名字的 `role=group`；按钮 `aria-pressed`。
- 棋盘编辑模式的可读名与格子标签明确说「可编辑」。
- 键盘：方向键移动、Home/End 行跳、Enter/空格编辑。
- 错误 `role=alert`，保存/载入结果 `role=status`。
- 颜色不是唯一信息：当前工具/下一手同时有文字说明。

## 8. 不做什么

- 不新建第二套棋盘渲染/路由框架；
- 不把编辑器 Undo 接进 `gameStore`；
- 不把自由摆盘包装成带假手顺的 `GameRecord`；
- 不提供「胜率/绝对最佳」结论，只展示引擎实际输出与可靠度。
