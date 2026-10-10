# Gomoku Lab Phase 1 实施计划

> **执行方式**：本会话内直接实现（Native）。任务之间共享 `core` 类型契约，拆给子代理反而要反复同步接口。

**目标**：交付一个规则完全正确、能真实完整对战一局、界面精致的五子棋应用。

**架构**：`core`（纯逻辑）→ `ai`（Worker 内搜索）→ `store`（Zustand）→ `components`（展示）。详见 `docs/superpowers/specs/2026-10-10-gomoku-lab-design.md`。

**技术栈**：Vite 8 / React 19 / TypeScript 6 / Tailwind v4 / Zustand 5 / Motion / Vitest 5 / Playwright。

**Spec**：`docs/superpowers/specs/2026-10-10-gomoku-lab-design.md`

## 全局约束

- 不使用 `enum`（`erasableSyntaxOnly` 已开启），一律 `as const` 对象 + 联合类型。
- 所有导出函数必须有显式返回类型标注。
- `core` 与 `ai` 不得 import React、DOM 或 Zustand。
- 包管理器固定 yarn；命令用 `yarn test` / `yarn build` / `yarn typecheck`。
- 界面文案一律简体中文。
- 每次提交前必须 `yarn typecheck && yarn test && yarn build` 全绿。

## Review Focus

以下是需求隐含、但单靠规则测试抓不住、最容易伤到真实玩家的输入/情形，每条都绑定到具体任务：

1. **棋盘下满且最后一手同时成五** —— 应先判胜、再判和（Task 3）。玩家预期：赢了就是赢了，不能因为顺手填满棋盘被判和棋。
2. **AI 思考期间玩家连点/抢点** —— 不能出现两颗同色棋、不能卡在「AI 思考中」无法继续（Task 6）。玩家预期：点不动就是点不动，轮到我时一定能下。
3. **AI 思考中玩家悔棋或重开** —— 迟到的 AI 响应必须被丢弃（Task 6）。玩家预期：我按了重开，棋盘就必须是空的。
4. **刷新页面时棋局正处于 AI 思考中** —— 恢复后必须能继续走完，不能卡死（Task 7）。玩家预期：刷新不该毁掉这局棋。
5. **触摸屏上的落子与滚动** —— 棋盘区域不应触发页面滚动与双击缩放（Task 9）。玩家预期：手指按在棋盘上就是下棋。

---

## Task 1：工程基线

**Files**
- Create: `src/core/types.ts`（仅常量与类型，无逻辑）
- Create: `src/test/setup.ts`（已完成）
- Modify: `vite.config.ts`（已完成）、`src/index.css`（已完成）、`index.html`（已完成）
- Delete: `src/App.css`、`src/assets/`、`public/icons.svg`

**Produces**：`BOARD_SIZE`、`CELL_COUNT`、`Player`、`Cell`、`Board`、`Point`、`GameStatus`、`MoveError`

- [ ] 写好 `src/core/types.ts`，跑 `yarn typecheck` 确认通过。
- [ ] 删除模板残留文件，`yarn build` 确认仍可构建（此时 App.tsx 还是模板内容，只需不报错）。
- [ ] 提交。

## Task 2：规则模块（`core/board.ts` + `core/rules.ts`）

**Interfaces**
- Produces:
  - `idx(x: number, y: number): number`
  - `pointFromIdx(i: number): Point`
  - `inBounds(x: number, y: number): boolean`
  - `createBoard(): Board`
  - `cellAt(board: Board, x: number, y: number): Cell`
  - `validateMove(board: Board, p: Point): MoveError | null`
  - `findWinLine(board: Board, last: Point): Point[] | null`
  - `isBoardFull(board: Board): boolean`
- 测试辅助（`src/core/__testutils__.ts`）：`boardFromLines(rows: string[]): Board`，用 `'B' | 'W' | '.'` 描述局面。

- [ ] **Step 1：先写失败测试** `src/core/rules.test.ts`

```ts
describe('findWinLine', () => {
  it('识别横向五连', ...)          // "BBBBB" 于第 7 行
  it('识别纵向五连', ...)
  it('识别主对角线（↘）五连', ...)
  it('识别副对角线（↗）五连', ...)
  it('识别贴左边缘的五连', ...)      // x = 0..4
  it('识别贴右边缘的五连', ...)      // x = 10..14
  it('识别贴顶边与贴底边的五连', ...)
  it('长连（六连）同样判胜，且返回全部六子', ...)
  it('四连不算胜', ...)
  it('被对方棋子隔断的四连不算胜', ...)
  it('五连只在最后一手方向成立时才算胜', ...)   // 棋盘上已有别的四连
})

describe('validateMove', () => {
  it('拒绝越界坐标', ...)            // x = -1 / 15
  it('拒绝非整数坐标', ...)          // x = 1.5
  it('拒绝已占用的位置', ...)
  it('空位返回 null', ...)
})

describe('isBoardFull', () => {
  it('空棋盘为 false', ...)
  it('填满 225 格为 true', ...)
})
```

- [ ] **Step 2：`yarn test src/core/rules.test.ts` 确认失败**（模块不存在 → 失败原因必须是「找不到模块」，不是语法错误）。
- [ ] **Step 3：实现 `board.ts` 与 `rules.ts`**，`findWinLine` 用「沿 4 个方向正反双向延伸」实现，不做字符串匹配。
- [ ] **Step 4：`yarn test` 全绿。**
- [ ] **Step 5：提交。**

## Task 3：对局状态机（`core/game.ts`）

**Interfaces**
- Consumes：Task 2 的全部导出
- Produces：`GameState`、`createGame`、`applyMove`、`undo`、`resign`、`replay`

- [ ] **Step 1：先写失败测试** `src/core/game.test.ts`

```ts
it('新建对局为黑先、空盘、playing', ...)
it('落子后切换手番并写入手顺', ...)
it('落子后 version 递增', ...)
it('applyMove 不修改传入的 state（不可变性）', ...)
it('已占用的位置返回 occupied 且状态不变', ...)
it('越界返回 out_of_bounds', ...)
it('终局后落子返回 game_over', ...)
it('第五手成五时 status = won 且 winner 正确', ...)
it('最后一手填满棋盘同时成五 → 判胜而非和棋', ...)   // ← Review Focus 1
it('棋盘填满且无五连 → status = draw', ...)
it('悔棋撤销最后一手并恢复手番', ...)
it('悔棋可从已结束的对局回到 playing', ...)
it('悔棋 plies=2 撤销一轮', ...)
it('悔棋超过已有手数时回到空盘而不是报错', ...)
it('认输后 status = resigned、winner = 对方', ...)
it('replay 从手顺重建出的状态与逐步落子一致', ...)
```

满盘和棋测试用 spec 第 8 节描述的模式生成 225 手：

```ts
function drawMoves(): Point[] {
  const black: Point[] = [], white: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++)
    for (let x = 0; x < BOARD_SIZE; x++)
      ((x + 2 * y) % 4 < 2 ? black : white).push({ x, y })
  // black 113 手、white 112 手，交替生成即为合法手顺
  return black.flatMap((p, i) => (white[i] ? [p, white[i]] : [p]))
}
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现 `game.ts`**——`applyMove` / `undo` 都委托 `replay`。
- [ ] **Step 4：全绿。**
- [ ] **Step 5：提交。**

## Task 4：AI 引擎（`ai/`）

**Interfaces**
- Consumes：`core` 全部
- Produces：
  - `Difficulty`、`SearchRequest`、`SearchResponse`
  - `chooseMove(req: SearchRequest): SearchResponse` —— 同步纯函数，Worker 与单测共用
  - `DIFFICULTY_PARAMS: Record<Difficulty, { width: number; depth: number; budgetMs: number }>`
  - `candidateMoves(board: Board, radius?: number): Point[]` —— 只取已有棋子邻域

**Phase 1 的引擎能力（真实实现，非随机）**：
1. 若有立即成五的点 → 直接下（`reason: 'win'`）。
2. 若对手下一手能成五 → 堵（`reason: 'block'`）。
3. 否则对候选点做棋型评分（活四 / 冲四 / 活三 / 眠三 / 活二 / 眠二），按「我方收益 × 进攻权重 + 对方在此点的收益 × 防守权重」排序，取前 `width` 个做 `depth` 层浅搜索。
4. 超过 `budgetMs` 立即用当前最优解返回（`reason: 'timeout'`）。
5. 空盘时下天元（`reason: 'opening'`）。

- [ ] **Step 1：先写失败测试** `src/ai/search.test.ts`

```ts
it('黑棋有四连时立即补成五（reason = win）', ...)
it('对手有四连时立即堵住（reason = block）', ...)
it('无威胁时选择靠近已有棋子的点，而不是远处的空位', ...)
it('空盘时下天元', ...)
it('棋盘已满时返回 move = null（reason = no_move）', ...)
it('极小预算下仍返回一个合法着法并标记 timeout', ...)
it('候选点全部落在已有棋子的邻域内', ...)
it('返回的着法一定落在空位上', ...)
it('beginner 与 easy 在「对手活三」局面下都会防守', ...)
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现 `patterns.ts` / `evaluate.ts` / `difficulty.ts` / `search.ts`。**
- [ ] **Step 4：全绿。**
- [ ] **Step 5：提交。**

## Task 5：Worker 适配（`ai/worker.ts` + `ai/engine.ts`）

- [ ] **Step 1：先写失败测试** `src/ai/engine.test.ts`（用假的 Worker 实现，只验证协议行为）

```ts
it('request 返回与 requestId 匹配的响应', ...)
it('dispose 后所有挂起请求以错误结束，不悬挂', ...)
it('worker 触发 onerror 时挂起请求以错误结束', ...)
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现 `engine.ts`（注入式 Worker 工厂，便于测试）与 `worker.ts`。**
- [ ] **Step 4：全绿。**
- [ ] **Step 5：提交。**

## Task 6：对局 Store（`store/gameStore.ts`）

**Interfaces**
- Produces：`useGameStore`，含 `game`、`mode`、`humanColor`、`aiThinking`、`aiError`、`aiInfo`，以及 `newGame`、`playHuman`、`undoMove`、`resign`、`requestAiMove`、`applyAiResponse`、`dismissAiError`

- [ ] **Step 1：先写失败测试** `src/store/gameStore.test.ts`

```ts
it('玩家执黑时点击空位立即落子', ...)
it('玩家执白时开局轮空，等待 AI 落子', ...)
it('AI 思考期间玩家的点击被忽略', ...)
it('非玩家回合的点击被忽略', ...)
it('过期 gameVersion 的 AI 响应被丢弃', ...)        // ← Review Focus 3
it('requestId 不匹配的 AI 响应被丢弃', ...)         // ← Review Focus 3
it('AI 落子后恢复玩家回合', ...)
it('人机模式悔棋撤销双方各一手', ...)
it('AI 尚未落子时悔棋只撤销玩家那一手', ...)         // ← Review Focus 2
it('本地双人模式悔棋只撤销一手', ...)
it('终局后 playHuman 无效', ...)
it('重新开始后棋盘清空、version 递增、aiThinking 归零', ...)  // ← Review Focus 3
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现 store**，AI 响应校验逻辑放在纯函数 `shouldAcceptAiResponse(res, current)` 中。
- [ ] **Step 4：全绿。**
- [ ] **Step 5：提交。**

## Task 7：持久化（`persist/storage.ts`）

- [ ] **Step 1：先写失败测试** `src/persist/storage.test.ts`

```ts
it('对局序列化后可完整还原（棋盘 / 手顺 / 手番 / 结果）', ...)
it('schemaVersion 不匹配时返回 null', ...)
it('JSON 损坏时返回 null 而不抛错', ...)
it('棋盘长度非法时返回 null', ...)
it('手顺指向已占用位置时返回 null', ...)
it('AI 思考中存档 → 恢复后可以继续走完这局', ...)     // ← Review Focus 4
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现 `serialize` / `deserialize` / `save` / `load` / `clear`。**
- [ ] **Step 4：全绿。**
- [ ] **Step 5：提交。**

## Task 8：棋盘组件（`components/board/`）

**Interfaces**
- Produces：`<Board board lastMove winLine onPlay showCoords disabled />`

- [ ] **Step 1：先写失败测试** `src/components/board/Board.test.tsx`

```tsx
it('渲染 225 个交叉点', ...)
it('点击空交叉点回调对应坐标', ...)
it('点击已占用交叉点不回调', ...)
it('disabled 时点击不回调', ...)
it('最后一手带 data-last 标记', ...)
it('胜利时整条连线带 data-win 标记', ...)
it('坐标标签随 showCoords 开关显隐', ...)
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现 SVG 棋盘（`Board.tsx` + `Stone.tsx`）。**
- [ ] **Step 4：全绿。**
- [ ] **Step 5：提交。**

## Task 9：界面组装（`components/ui`、`components/panels`、`features/battle`、`App.tsx`）

- [ ] **Step 1：实现 `ui/` 原子组件**：`Panel`、`Button`、`Segmented`、`Switch`、`Modal`。
- [ ] **Step 2：实现 `panels/`**：`StatusBar`（当前回合 / 执子 / AI 状态）、`MoveList`（棋谱）、`ControlBar`（悔棋 / 重开 / 认输）、`SettingsPanel`（模式 / 执子 / 难度 / 音效 / 坐标 / 主题）、`ResultDialog`（终局弹窗）。
- [ ] **Step 3：实现 `lib/sound.ts`**：WebAudio 合成落子音，无音频资源文件。
- [ ] **Step 4：组装 `features/battle/BattleScreen.tsx` 与 `App.tsx`。**
- [ ] **Step 5：响应式与触屏**：桌面三栏 / 移动纵向；棋盘容器 `touch-action: manipulation`，容器查询控制正方形尺寸。← Review Focus 5
- [ ] **Step 6：`yarn typecheck && yarn test && yarn build` 全绿。**
- [ ] **Step 7：提交。**

## Task 10：浏览器验证与文档

- [ ] **Step 1：`yarn dev` 启动，用 Chrome DevTools MCP 打开真实页面。**
- [ ] **Step 2：实走一局**：落子 → AI 应手 → 悔棋 → 重开 → 再走到分出胜负 → 弹窗出现。
- [ ] **Step 3：刷新页面验证棋局恢复（含 AI 思考中刷新的情形）。**
- [ ] **Step 4：移动端视口（390×844）截图核对布局与棋盘尺寸。**
- [ ] **Step 5：深浅两套主题截图核对。**
- [ ] **Step 6：记录发现的问题并修复，问题与修复过程写进 `docs/TEST_REPORT.md`。**
- [ ] **Step 7：补齐 `README.md`、`AGENTS.md`、`CLAUDE.md`、`docs/ARCHITECTURE.md`、`docs/RULES.md`、`docs/AI_ENGINE.md`、`docs/ROADMAP.md`。**
- [ ] **Step 8：最终 `yarn typecheck && yarn test && yarn build`，提交。**
