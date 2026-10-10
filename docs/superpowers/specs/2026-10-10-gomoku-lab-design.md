# Gomoku Lab 技术设计文档

**日期**：2026-10-10
**状态**：已确认（架构由用户批准：core/ai/store/features 分层 + Worker 协议）

---

## 1. 目标

构建一款离线可用的 15×15 自由规则五子棋 Web 应用，包含人机对战、AI 提示、互动教学、残局挑战、对局复盘五项能力。

判断标准不是「页面能打开」，而是：**真实玩家能和它下完一局、AI 会赢也会防、刷新页面棋局还在、教学与残局能真做对做错**。

明确不做：其他棋类、通用多棋类抽象、后端、账号、云同步、在线对战、第三方大模型 API。

## 2. 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 构建 | Vite 8 + React 19 + TypeScript 6 | 用户指定；`erasableSyntaxOnly` 已开，因此**不使用 enum**，统一用 `as const` 对象 + 联合类型 |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite`） | 用户指定；v4 用 CSS 优先配置，设计令牌写在 `@theme` |
| 状态 | Zustand 5 | 用户指定；store 是纯函数式的，可直接单测，不需要渲染 React |
| 动画 | Motion（`motion/react`） | 用户指定；落子与面板过渡 |
| 并发 | Web Worker（Vite `?worker` 导入） | 需求硬性要求 AI 不得阻塞主线程 |
| 持久化 | localStorage（Phase 1）→ IndexedDB（Phase 4） | Phase 1 只存当前对局；棋谱库与课程进度在 Phase 4 迁到 IndexedDB |
| 测试 | Vitest 5 + @testing-library/react + Playwright | 用户指定 |
| 包管理 | yarn 1.22 | 用户指定 |

字体使用系统中文字体栈，不引入 Web Font（离线优先、首屏无闪烁）。

## 3. 目录结构与职责边界

```
src/
├─ core/          纯逻辑。零 React、零 DOM、零时间、零随机 —— 可被 UI / AI / 教学 / 残局共用
│  ├─ types.ts     常量与类型
│  ├─ board.ts     索引换算、边界、读写
│  ├─ rules.ts     胜负判定、合法落子、满盘
│  └─ game.ts      对局状态机（落子 / 悔棋 / 认输 / 重放）
├─ ai/            AI 引擎。纯函数 + 一层 Worker 适配
│  ├─ types.ts     难度、请求 / 响应协议
│  ├─ patterns.ts  线段棋型扫描
│  ├─ evaluate.ts  局面评估
│  ├─ search.ts    着法搜索（Phase 2 升级为 Negamax + αβ + 迭代加深）
│  ├─ difficulty.ts 难度参数表
│  ├─ worker.ts    Worker 入口
│  └─ engine.ts    主线程侧客户端（请求 / 取消 / 错误）
├─ store/         Zustand：对局状态、设置
├─ persist/       序列化与本地存储
├─ lib/           无状态工具（音效、坐标格式化）
├─ components/    展示层
│  ├─ ui/         通用原子组件
│  ├─ board/      棋盘
│  └─ panels/     面板
├─ features/      按功能组织的容器组件（battle / hint / lessons / puzzles / review）
└─ test/          测试基础设施
```

**依赖方向单向**：`components → features → store → ai/core`，`ai → core`。`core` 不依赖任何其他层。

## 4. 核心数据模型与接口契约

### 4.1 类型（`core/types.ts`）

```ts
export const BOARD_SIZE = 15
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE

/** 1 = 黑（先手），2 = 白 */
export type Player = 1 | 2
/** 0 = 空 */
export type Cell = 0 | Player
/** 长度 225 的一维棋盘，索引 = y * 15 + x */
export type Board = Uint8Array
/** 0-based，左上角为 (0, 0) */
export interface Point { readonly x: number; readonly y: number }

export type GameStatus = 'playing' | 'won' | 'draw' | 'resigned'
export type MoveError = 'out_of_bounds' | 'occupied' | 'game_over'
```

坐标约定**只有一套**：对外一律 `{x, y}`，0-based，左上 `(0,0)`；内部线性索引 `y * BOARD_SIZE + x`。UI 坐标标签显示为 `A1..O15`（列字母 + 从下往上的行号），仅用于展示，不参与任何逻辑。

### 4.2 规则（`core/rules.ts`）

```ts
export function validateMove(board: Board, p: Point): MoveError | null
export function findWinLine(board: Board, last: Point): Point[] | null
export function isBoardFull(board: Board): boolean
```

- 自由规则：横、竖、两条对角线任意方向**连续 5 枚或更多**同色即胜（长连有效，无禁手）。
- `findWinLine` 只从**最后一手**出发检查 4 个方向，返回该方向上完整的连续同色棋子序列（长连时长度 > 5，UI 整段高亮）。
- 边界通过 `inBounds` 逐点判断，不做数组越界访问。

### 4.3 状态机（`core/game.ts`）

```ts
export interface GameState {
  readonly board: Board
  readonly moves: readonly Point[]   // 手顺，索引 i 即第 i+1 手
  readonly current: Player           // 轮到谁
  readonly status: GameStatus
  readonly winner: Player | null
  readonly winLine: readonly Point[] | null
  readonly lastMove: Point | null
  readonly version: number           // 任何变更 +1，用于作废过期的 AI 响应
}

export function createGame(firstPlayer?: Player): GameState
export function applyMove(state: GameState, p: Point):
  | { ok: true; state: GameState }
  | { ok: false; error: MoveError }
export function undo(state: GameState, plies?: number): GameState
export function resign(state: GameState, player: Player): GameState
export function replay(moves: readonly Point[], firstPlayer?: Player): GameState
```

**不可变**：`applyMove` / `undo` / `resign` 都返回新状态，绝不原地修改。棋盘是 `Uint8Array`，每次复制 225 字节，代价可忽略，换来免费的快照语义与零成本的结构共享（对 Worker 传输尤其重要）。

**单一路径**：`applyMove` 与 `undo` 都委托给 `replay()` 从手顺重建。撤销不需要单独的历史栈，也不存在「棋盘与手顺不同步」这类 bug。

### 4.4 难度与 AI 协议（`ai/types.ts`）

```ts
export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert'

export interface SearchRequest {
  requestId: number
  gameVersion: number
  board: Board
  player: Player
  difficulty: Difficulty
  budgetMs: number
}

export interface SearchResponse {
  requestId: number
  gameVersion: number
  move: Point | null          // null = 无棋可走
  score: number
  depth: number
  nodes: number
  elapsedMs: number
  confidence: 'exact' | 'heuristic'
  reason: 'win' | 'block' | 'search' | 'opening' | 'timeout' | 'no_move'
}
```

**过期响应的处理**：每个请求带 `requestId` 与 `gameVersion`。主线程只接受「`requestId` 仍是当前挂起请求」且「`gameVersion` 等于当前棋局版本」的响应，其余一律丢弃。这是需求「取消或过期的请求不能改变当前棋局」的实现方式，且该判断位于 store 的纯函数 action 中，可脱离浏览器直接单测。

`confidence: 'heuristic'` 用于 Phase 2 的提示功能：搜索预算不足时如实标注为启发式建议，不冒充最优解。

## 5. 分层与并发

```
用户点击 → GameStore.playHuman → core.applyMove → 新状态
                                      ↓
                            轮到 AI 时 requestAiMove
                                      ↓
                          AiEngine(Worker) 搜索（不阻塞主线程）
                                      ↓
                    applyAiResponse：校验 requestId + gameVersion
                                      ↓
                          通过 → 落子；不通过 → 丢弃
```

Worker 通过 Vite 的 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` 创建，构建时自动产出独立 chunk。`AiEngine` 在主线程维护 `requestId → resolver` 映射，支持 `dispose()` 时统一拒绝挂起请求。

## 6. 持久化

Phase 1 只存「当前对局 + 设置」到 localStorage。序列化格式带 `schemaVersion`，读取时逐字段校验；任何校验失败一律当作没有存档（回到新对局），绝不把损坏数据灌进状态机。

Phase 4 会把棋谱库、课程进度、残局进度迁到 IndexedDB；届时 localStorage 只保留设置。

## 7. UI 架构

- **布局**：桌面为三栏（左：对局与显示设置 / 中：棋盘 / 右：对局信息与操作），移动端纵向堆叠。
- **棋盘自适应**：用 CSS 容器查询取「能容纳的最大正方形」——`width: min(100cqw, 100cqh)`，避免用 JS 测量。
- **棋盘渲染**：整体单张 SVG，`viewBox` 覆盖棋盘 + 坐标留白，交叉点坐标直接等于 SVG 用户坐标，不需要任何百分比换算。棋子为 SVG `<circle>` + 径向渐变 + 投影，天然对齐且任意缩放下清晰。
- **设计令牌**：浅色 / 深色两套 CSS 变量挂在 `:root` 与 `.dark`，经 `@theme inline` 暴露成 Tailwind 语义色（`bg-surface`、`text-muted`）。组件里不写 `dark:` 前缀，主题切换只改 `<html>` 上的一个类。
- **触屏**：棋盘容器 `touch-action: manipulation`，避免双击缩放与滚动误触。

## 8. 测试策略

| 层 | 工具 | 覆盖重点 |
| --- | --- | --- |
| core | Vitest | 五连全方向、边缘、长连、未成五、重复落子、终局后落子、满盘和棋、悔棋 |
| ai | Vitest | 立即取胜、必防对手、无候选、超时回退、难度差异 |
| store | Vitest | 过期响应丢弃、人机悔棋撤销一轮、终局拒收落子、（Phase 4）刷新恢复 |
| persist | Vitest | 序列化往返、损坏数据降级 |
| components | Vitest + RTL | 棋盘渲染 225 个交叉点、点击落子、终局禁点 |
| e2e | Playwright（本机 Chrome，不下载 Chromium） | 完整对局流、悔棋、重开、刷新恢复 |

**满盘和棋的构造**：使用 `(x + 2y) mod 4 < 2` 判定黑子的填充模式。该模式在横、竖、两条对角线上最长连续同色都是 2，因此终局无五连；其黑子数恰为 113、白子数恰为 112，与「黑先、轮流落子下满 225 格」的奇偶性完全吻合。由于「无五连局面的任意子集仍无五连」，全部中间局面也都合法——这是一个可真正走完的和棋，不是硬塞的棋盘快照。

## 9. 阶段划分

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| Phase 1 | 规则 + 棋盘 + 初级 AI + 悔棋重开 | 真实玩家能完整对战一局 |
| Phase 2 | 棋型 + Negamax/αβ + 五档难度 + Worker + 提示 | AI 会赢会防会做战术威胁，界面不卡 |
| Phase 3 | 课程运行器 + 残局挑战 | 课程与题目可操作、可完成、答案经过验证 |
| Phase 4 | 棋谱 + 持久化 + 回放 + 复盘 | 对局可保存、恢复、回放并真实分析 |
| Phase 5 | 打磨 + 移动端 + 音效 + 自动化测试 | 稳定、无关键规则错误、可部署 |
