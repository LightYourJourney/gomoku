# Gomoku Lab Phase 4 实施计划：棋谱持久化、回放与 AI 复盘

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一局棋在结束后不消失——存进本地棋谱库，可以随时打开回放每一手，并让引擎用有限预算指出「哪几手下亏了」。

**Architecture:** 三块积木，依赖单向。① `persist/gameRecords.ts`：棋谱库（IndexedDB，多局，带内存降级，完全照 `progress.ts` 的先例）。② `store/replayStore.ts`：回放器状态机——持有**不可变的完整 GameState**，只维护一个「看到第几手」的游标，任何视图都从 `replay(moves.slice(0, cursor))` 派生，绝不增量改棋盘。③ `learn/analyze.ts` 之类的分析层不要——分析直接住在 `store/analysisStore.ts` + Worker 协议扩展：给 `SearchRequest` 加 `purpose: 'analyze'`（语义与 `hint` 相同：只读、不落子），store 层按手排队逐个发请求，复用现有 requestId/gameVersion 双闸门与过期丢弃机制。

**Tech Stack:** 沿用全部现有栈。新增依赖仅 `fake-indexeddb`（已在 Phase 3 装过，devDependencies 里已有，无需新装）。

**Spec:** `docs/ROADMAP.md`「Phase 4 · 棋谱与复盘」7 条验收项 + `AGENTS.md` 全局约束 + `docs/ARCHITECTURE.md` 的「关键数据流」与「并发的五处关键约定」。

---

## 全局约束

- **完全离线**：无后端、无账号、无云 DB。棋谱只存 IndexedDB。
- **不使用 `enum`**（`erasableSyntaxOnly`）：一律 `as const` + 联合类型；类型导入用 `import type`（`verbatimModuleSyntax`）。
- **`core`/`ai` 算法部分不得引入 React/DOM/Zustand/localStorage/IndexedDB/Worker**。`persist/` 与 `store/` 是仅有的两个允许碰存储的层。Worker 只允许 `ai/worker.ts`（入口）与 `ai/browserEngine.ts`（创建）触碰。
- **AI 请求必须绑定 `requestId` 与 `gameVersion`**，两道闸门都过才生效。回放的分析请求不改变对局，但仍走同一套校验——校验的对象是「这个响应还适用于当前正在看的局面吗」。
- **`Date.now()` 只允许出现在 `ai/search.ts` 的时间预算里**（可注入 `now` 覆盖）。分析管线的排队逻辑不得自己读时钟。
- **分析结论必须如实**：注明引擎档位、搜索预算、单手结论的可靠度；**不许用固定阈值把每一手断言成「最佳/好棋/失误/严重失误」**——UI 只呈现「引擎认为的分差」与可靠度，让玩家自己判断。
- **提示与分析请求都是只读的**，不许调用 `applyMove`。
- **界面文案一律简体中文。包管理器固定 yarn。**
- **提交前五条全绿**：`yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e`。
- **写进文档的每个性能数字必须来自 `yarn bench` 或实测**，不许估。
- 文档同步：`ARCHITECTURE.md`（新模块与数据流）、`ROADMAP.md`（勾掉 Phase 4）、`TEST_REPORT.md`（计数与验证记录）、`RULES.md` 不涉及。

## Review Focus

规格隐含、但各任务自身测试不会覆盖、最容易伤到真实用户的情形。每条都绑到 owning task：

1. **复盘时棋谱库写入失败不能炸 UI** —— IndexedDB 被禁、配额满，都可能让「保存这局」失败。玩家应该看到「没存上」的提示而不是白屏。Task 2 的降级测试 + Task 7 的 UI 用例覆盖。
2. **回放游标越界或空棋谱** —— 打开一局 0 手的棋谱（刚开就认输）、把游标推过最后一手，都不能画出错误的棋盘或崩溃。Task 3 的边界测试。
3. **分析请求与真实对局互相干扰** —— 复盘分析时若同时有对局在跑，两个 store 的请求号必须互不挤占（共用计数器）；分析响应迟到时必须作废而不是画出错误的标注。Task 5 的并发测试。
4. **自动播放定时器泄漏** —— 自动播放打开后切走视图/关闭面板，定时器必须清掉，否则后台一直跑。Task 3 的 fake-timer 测试 + Task 7 的 e2e。
5. **分析结论不能过期** —— 缓存键必须带引擎版本、档位与预算指纹（`cacheKey` 的 `v1:${ENGINE_VERSION}:...` 前缀），换了任何一项都重算而不是给出过期结论；「看到第几手」有意不持久化（回放是浏览行为不是进度）。Task 4 的缓存键测试 + Task 5 的缓存复用测试。

---

## 文件结构

```
src/
├─ ai/
│  ├─ types.ts                  [改] SearchRequest/Response 加 purpose: 'analyze' 与 moveIndex 字段
│  ├─ worker.ts                 [不改] chooseMove 对新 purpose 天然兼容（同步纯函数）
│  └─ search.ts                 [不改] searchBoard 不感知 purpose
├─ persist/
│  ├─ gameRecords.ts            [新] 棋谱库：IndexedDB，多局，内存降级（照 progress.ts 先例）
│  └─ gameRecords.test.ts       [新]
├─ analysis/
│  └─ analyze.ts                [新] 纯逻辑：单手分析的输入输出形状、结论文案、缓存键
│  └─ analyze.test.ts           [新]
├─ store/
│  ├─ replayStore.ts            [新] 回放器：棋谱 + 游标 + 派生局面 + 自动播放
│  ├─ replayStore.test.ts       [新]
│  ├─ analysisStore.ts          [新] 分析管线：排队、缓存、结论状态机
│  ├─ analysisStore.test.ts     [新]
│  └─ learnStore.ts             [改] View 加 'review'，导航四页
└─ features/
   └─ review/                   [新] 回放与复盘页
      ├─ ReviewScreen.tsx       [新] 列表 + 回放器 + 分析面板
      ├─ GameLibrary.tsx        [新] 棋谱列表
      └─ ReplayBoard.tsx        [新] 回放棋盘（Board + 落子编号覆盖层）
```

**为什么分析逻辑放 `store/analysisStore.ts` 而不是新层**：它是「请求编排 + 缓存」逻辑，不是算法——算法全在 `ai/`（复用），结论文案在 `analysis/analyze.ts`（纯函数）。编排逻辑本来就住在 store 层（`gameStore` 的提示管线就是先例），不新开层。

**为什么回放游标不持久化**：回放是浏览行为，每次从第 0 手开始是自然语义；持久化它反而会让「打开另一局」后回到一个错的位置。分析结论缓存持久化（IndexedDB），因为算一次很贵。

---

## Task 1：AI 协议扩展 —— `purpose: 'analyze'`

**Files:**
- Modify: `src/ai/types.ts`
- Test: `src/ai/search.test.ts`（追加用例）

**Interfaces:**
- Consumes: 现有 `SearchRequest`/`SearchResponse`/`RequestPurpose`
- Produces:
  - `RequestPurpose = 'play' | 'hint' | 'analyze'`
  - `SearchRequest.moveIndex?: number`（分析第几手，0-based；仅 `analyze` 用，主线程到 Worker 一路透传）
  - `SearchResponse.moveIndex?: number`（原样回传，供 store 配对）
  - `export const ENGINE_VERSION: string`（`ai/version.ts`，格式 `'search-1'`；复盘 UI 注明「引擎版本」用这一常量，后续搜索算法演进时递增）

- [ ] **Step 1: 写失败测试** —— 在 `src/ai/search.test.ts` 追加：

```ts
describe('analyze 用途', () => {
  it("purpose: 'analyze' 的请求走完整搜索并回传 moveIndex", () => {
    const board = parseBoardLines(Array(15).fill('...............'))
    const request: SearchRequest = {
      requestId: 1, gameVersion: 0, board, player: BLACK,
      difficulty: 'easy', purpose: 'analyze', moveIndex: 5,
    }
    const response = chooseMove(request)
    expect(response.moveIndex).toBe(5)
    expect(response.move).not.toBeNull()
    expect(response.confidence).toBe('exact')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**（`SearchRequest` 没有 `moveIndex` 字段 → typecheck 红）

- [ ] **Step 3: 最小实现** —— `src/ai/types.ts`：`RequestPurpose` 加 `'analyze'`；`SearchRequest`/`SearchResponse` 各加 `readonly moveIndex?: number`。`chooseMove`（`search.ts:550`）把 `moveIndex: request.moveIndex` 加进返回值。新建 `src/ai/version.ts` 导出 `ENGINE_VERSION = 'search-1'`（`as const` 字符串，非 enum）。`searchBoard` 完全不感知 purpose。

- [ ] **Step 4: 全量测试过**（现有 play/hint 路径不受影响）

- [ ] **Step 5: Commit** `feat(ai): 分析用途的协议扩展`

## Task 2：棋谱库 `persist/gameRecords.ts`

**Files:**
- Create: `src/persist/gameRecords.ts`
- Test: `src/persist/gameRecords.test.ts`

**Interfaces:**
- Consumes: `persist/storage.ts` 的 `PersistedSession` 形状（对局的手顺/模式/难度等，直接复用它的字段校验思路）
- Produces:
  ```ts
  export const GAME_RECORDS_SCHEMA_VERSION = 1
  export interface GameRecord {
    /** IndexedDB 自增主键（store 分配，0 表示未入库的临时记录）。列表按它降序 = 最近的在前。 */
    readonly seq: number
    readonly schemaVersion: number
    readonly moves: readonly Point[]
    readonly firstPlayer: Player
    readonly mode: GameMode
    readonly humanColor: Player
    readonly difficulty: Difficulty
    readonly resignedBy: Player | null
    /** 由 createGameRecord 内部 replay 推导；null = 和棋。认输时为认输方的对手。 */
    readonly winner: Player | null
  }
  export interface GameRecordsStorage {
    list(): Promise<readonly GameRecord[]>
    get(seq: number): Promise<GameRecord | null>
    put(record: Omit<GameRecord, 'seq' | 'schemaVersion'>): Promise<GameRecord>  // 返回带 seq 的完整记录
    delete(seq: number): Promise<void>
  }
  export const indexedDbGameRecords: GameRecordsStorage
  export const memoryGameRecords: () => GameRecordsStorage  // 每次新实例，测试用
  export function createGameRecord(input: Omit<GameRecord, 'seq' | 'schemaVersion' | 'winner'>): Omit<GameRecord, 'seq' | 'schemaVersion'>
  // 不存时间戳：AGENTS.md 限定 Date.now() 只能出现在 ai/search.ts，棋谱的先后次序由自增 seq 表达，
  // ROADMAP 也不要求「保存时间」。这同时消灭了「同毫秒两局撞 id」的问题。
  ```

- [ ] **Step 1: 失败测试**（照 `progress.test.ts` 的结构）：put 一局能读回且带自增 seq、再 put 一局 seq 递增、列表按 seq 降序、delete 后列表变短、`winner` 推导正确（五连黑胜 / 认输局 = 认输方对手 / 和棋 null）、解析损坏记录时**整体丢弃并继续**（不是抛错）、`__setIndexedDbFactory(null)` 语义下的降级——**真的摘掉全局 indexedDB**（`Reflect.deleteProperty` + finally 恢复 + 前提自检，照 Phase 3 第五轮修正后的写法）验内存降级。
- [ ] **Step 2: 确认红**
- [ ] **Step 3: 实现** —— DB 名 `gomoku-lab`（与进度同库），object store `records`，**keyPath `seq` + `autoIncrement: true`**。结构校验照 `decodeSession` 的口径：任何一处不符整条跳过。`winner` 在 `put` 时用 `replay` 推导，不在存储层信任调用方。
- [ ] **Step 4: 过绿**
- [ ] **Step 5: Commit** `feat(persist): 多局棋谱库（IndexedDB + 内存降级）`

## Task 3：回放器状态机 `store/replayStore.ts`

**Files:**
- Create: `src/store/replayStore.ts`
- Test: `src/store/replayStore.test.ts`

**Interfaces:**
- Consumes: `core/game` 的 `replay`/`createGame`、Task 2 的 `GameRecord`、Task 1 的 analyze 协议（不直接用，由 analysisStore 用）
- Produces:
  ```ts
  export interface ReplayStore {
    readonly record: Omit<GameRecord, 'seq' | 'schemaVersion'> | null
    readonly cursor: number                    // 当前看到第几手（0 = 空盘，moves.length = 终局）
    readonly playing: boolean                  // 自动播放中
    readonly position: GameState               // 派生：replay(record.moves.slice(0, cursor))
    readonly hasPrev: boolean
    readonly hasNext: boolean
    open(record: GameRecord): void             // 载入一局，cursor=0
    close(): void
    stepPrev(): void
    stepNext(): void
    goTo(index: number): void                  // clamp 到 [0, moves.length]
    play(): void
    pause(): void                              // 自动播放：每 REPLAY_STEP_MS stepNext，到尾自动停
  }
  export function createReplayStore(): UseBoundStore<StoreApi<ReplayStore>>
  export const REPLAY_STEP_MS = 900
  ```
  **position 的语义**：`position = replay(record.moves.slice(0, cursor), record.firstPlayer)`。认输标记（`record.resignedBy`）**只在 cursor === moves.length 时应用**——游标没走到最后，局面就该是「对局进行中」的样子。`hasNext = cursor < moves.length`（认输局 moves 为空数组时 hasNext 恒 false）。
  自动播放用 `setInterval`（store 层允许，它本来就住在浏览器），`close()`/`pause()`/到尾都必须 `clearInterval`；`play()` 在已在播放时是空操作，不叠加定时器。

- [ ] **Step 1: 失败测试**：
  - `open` 后 `position.version === 0`、`position.board` 全空
  - `stepNext` 一次后 `position.version === 1` 且 `position.lastMove === moves[0]`
  - `goTo(-5)` → 0、`goTo(999)` → `moves.length`（clamp）
  - 连续 `stepNext` 到尾后 `hasNext === false`，再 `stepNext` 是空操作
  - 0 手棋谱（认输局）打开不崩，`cursor === 0 === moves.length`；**cursor === 0 时 `position.status` 是 'playing'**（认输标记不提前应用）；`goTo(moves.length)` 后 `position.status` 反映认输（`resign(position, record.resignedBy)` 的效果）
  - **派生完整性**：`position.moves` 恒等于 `record.moves.slice(0, cursor)`（随机长度序列抽查 3 组）
  - **自动播放**（`vi.useFakeTimers()`）：`play()` 后 `advanceTimersByTime(REPLAY_STEP_MS)` 恰好 `stepNext` 一次；连续推进到尾后 `playing === false`（到尾自停）；`pause()` 后再推进时间游标不再动
  - **反向验证**：把 `goTo` 的 clamp 去掉跑一次确认红，再恢复
- [ ] **Step 2: 确认红**；**Step 3: 实现**；**Step 4: 过绿**；**Step 5: Commit** `feat(store): 回放器状态机（游标 + 派生局面 + 自动播放）`

## Task 4：分析层纯函数 `analysis/analyze.ts`

**Files:**
- Create: `src/analysis/analyze.ts`
- Test: `src/analysis/analyze.test.ts`

**Interfaces:**
- Consumes: `ai/types` 的 `SearchResponse`、`ai/difficulty` 的 `DIFFICULTY_PARAMS`、Task 2 的 `GameRecord`
- Produces:
  ```ts
  /** 一手的结论。不设「最佳/失误」档位——分差与可靠度由玩家自己解读。 */
  export interface MoveVerdict {
    readonly moveIndex: number          // 第几手（0-based）
    readonly move: Point
    /** 引擎为该局面给出的最佳着法（对当时行棋方而言） */
    readonly engineMove: Point
    /** 玩家实际着法与引擎着法的评分差，恒 ≥ 0。0 = 与引擎一致 */
    readonly loss: number
    /** 单手结论的可靠度：搜完 = exact，超时 = heuristic */
    readonly confidence: Confidence
    readonly engineDepth: number
    readonly engineNodes: number
  }
  export interface AnalysisSummary {
    readonly moveVerdicts: readonly MoveVerdict[]
    /** 分差最大的前 3 手（loss 排序），文案见 verdictLabel */
    readonly topLosses: readonly MoveVerdict[]
  }
  export function buildVerdict(args: {
    moveIndex: number; played: Point; response: SearchResponse; winScore: number
  }): MoveVerdict | null   // response.move 为 null（无棋可走）时返回 null
  export function buildSummary(verdicts: readonly MoveVerdict[]): AnalysisSummary
  export function verdictLabel(v: MoveVerdict): string
  // verdictLabel 口径：loss===0 →「与引擎一致」；0 < loss < WIN_SCORE/2 →「分差约 N 子」
  // （N = Math.round(loss / 10_000)，10_000 是 shapeScore 里「一档棋型」的量级，注释里写明这是粗略换算）；
  // loss ≥ WIN_SCORE/2 →「错过直接取胜」。**不出现「失误」字眼**，只是描述分差。
  export function cacheKey(seq: number, difficulty: Difficulty, budgetMs: number): string
  // 格式：`v1:${ENGINE_VERSION}:${seq}:${difficulty}:${budgetMs}` —— 掺引擎版本：换版本必须重算；
  // 换档位或预算同样重算。前缀 v1 是缓存键自身的版本，将来键结构变了递增。
  ```

- [ ] **Step 1: 失败测试**：
  - `buildVerdict`：response.move === played → loss 0；engineMove ≠ played → loss = engineScore − (−replyScore)（replyScore 为对手视角评分，negamax 取负，见实现注记）；clamp 到 ≥ 0；**终局手**（moveIndex 是最后一手且该手成五）→ loss 0（赢棋不存在亏损，无下一局面可算）
  - `buildVerdict`：response.move === null（无棋可走）→ 返回 null
  - `buildSummary`：5 条 verdict 按 loss 降序取前 3
  - `verdictLabel`：三种文案各断言一条，且不含「失误」二字
  - `cacheKey(1, 'easy', 400)` vs `cacheKey(1, 'medium', 400)` vs `cacheKey(1, 'easy', 800)` vs `cacheKey(2, 'easy', 400)` 两两不同；`ENGINE_VERSION` 变化 → 键变化（测试里直接断言键以 `v1:${ENGINE_VERSION}:` 开头）
- [ ] **Step 2: 确认红**；**Step 3: 实现**

**实现注记（loss 怎么算）**：一次 `analyze` 请求只返回「引擎在该局面的最佳着法 + 它的评分」。要得到玩家实际着法的评分，**不发第二个请求给同一局面**——对「玩家实际着法之后的局面」（对手行棋）再发一次 analyze，它返回对手视角的最佳评分 s2；negamax 语义下玩家着法的评分 ≈ −s2。`loss = max(0, engineScore − (−s2))`。**终局手的边界**：若该手直接成五（对局结束，没有下一局面），loss = 0——赢下的手不存在亏损，也不必再算。**这段编排逻辑放进 Task 5，本 Task 只定义形状、label 与键。**

- [ ] **Step 4: 过绿**；**Step 5: Commit** `feat(analysis): 单手结论的形状、文案与缓存键`

## Task 5：分析管线 `store/analysisStore.ts`

**Files:**
- Create: `src/store/analysisStore.ts`、`src/store/requestCounter.ts`
- Modify: `src/store/gameStore.ts`（改用共享计数器）
- Test: `src/store/analysisStore.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `purpose: 'analyze'`、Task 4 的 `buildVerdict`/`cacheKey`、Task 2 的 `GameRecord`、现有 `AiEngine` 接口
- Produces:
  ```ts
  export interface AnalysisStore {
    readonly target: { seq: number; difficulty: Difficulty; budgetMs: number; engineVersion: string } | null
    readonly verdicts: ReadonlyMap<number, MoveVerdict>   // 按 moveIndex
    readonly total: number                                 // 需要分析的总手数
    readonly running: boolean
    readonly error: string | null
    start(input: { record: GameRecord; engine: AiEngine; difficulty: Difficulty; budgetMs: number }): void
    stop(): void
  }
  export function createAnalysisStore(): UseBoundStore<StoreApi<AnalysisStore>>
  export const ANALYSIS_BUDGET_MS = 400
  ```
  排队语义：`start` 后按手序逐个发请求（**同一时刻最多 1 个在飞**），每个请求 `purpose: 'analyze'`、`gameVersion: 0`（分析不碰对局；过期校验改走 moveIndex——见下）、`moveIndex` = 手序号。
  **响应配对**：`applyResponse`（由页面层在 engine 回调里调用，与 gameStore 的模式一致）校验 `response.moveIndex === 当前队列头` 且 `response.gameVersion === 0`，不匹配即静默丢弃——这是「迟到的响应不能污染结论」的闸门。
  **双请求语义**（Task 4 注记）：第 i 手需要 2 个请求——局面 i 的最佳着法（返回 engineMove + engineScore）+ 局面 i+1 的对手视角评分。两个响应都到齐才 `buildVerdict`。相邻两手**共享**局面 i+1 的请求（手 i 的「应对评分」= 手 i+1 的「局面最佳」请求，局面连续时天然成立），队列里每个局面只入队一次；**终局手**（该手成五）没有局面 i+1，只发 1 个请求、loss 直接记 0。
  **取消**：`stop()` 清队列；在飞响应到达时因队列头不匹配而自然丢弃。
  **会话内缓存**：`start` 时先查 `cacheKey(seq, difficulty, budgetMs)` 命中的完整结果（内存 Map，store 实例存活期间有效），命中则直接填充 verdicts、零请求。**跨会话持久化有意不做**——分析结论依赖 `ENGINE_VERSION`，版本演进后旧结论全部作废，持久化的收益撑不起失效管理；记入 ROADMAP 已知不足。

- [ ] **Step 1: 失败测试**（注入 fake engine，`search` 返回预设响应）：
  - `start` 后逐手发起请求，fake engine 记录请求序列，断言 `purpose === 'analyze'`、`gameVersion === 0`、`moveIndex` 按局面序递增、**同一时刻最多 1 个在飞**（fake engine 里挂起计数 ≤ 1）
  - **请求共享**：一局 3 手（最后一手成五）的记录总请求数 = **5 个**（局面 0/1/2 各 1 + 手 0/1 复用局面 1/2 的后续评分请求；终局手无后续局面）——不是 3×2=6
  - 两个响应都到 → verdicts 里出现该手，loss 值符合 Task 4 公式（含对手视角取负）；终局手 loss === 0
  - **过期丢弃**：中途 `stop()` 后再来的响应不写入 verdicts；`moveIndex` 对不上队列头的响应同样丢弃
  - **错误路径**：engine.search reject → `error` 置位、`running` false，已完成的 verdicts 保留
  - **缓存复用**：同 seq+difficulty+budget 的第二次 `start` 且 verdicts 已齐全 → 零新请求（fake engine 断言）
  - **并发安全**：`requestCounter.ts` 提供 `nextRequestId(): number`（模块级闭包计数，只增不减）；gameStore 的 `nextRequestId` 局部变量删除、改调 `nextRequestId()`。测试：gameStore 落子请求与分析请求交错取号，断言两序列**全局严格递增、从不重复**
- [ ] **Step 2: 确认红**；**Step 3: 实现**（含 `requestCounter.ts` + gameStore 改接线）；**Step 4: 过绿**（全量）；**Step 5: Commit** `feat(store): 分析管线（排队、请求共享、缓存复用、共享请求号）`

## Task 6：回放与分析的页面 `features/review/`

**Files:**
- Create: `src/features/review/ReviewScreen.tsx`、`GameLibrary.tsx`、`ReplayBoard.tsx`
- Modify: `src/store/learnStore.ts`（`View` 加 `'review'`）、`src/features/shell/AppHeader.tsx`（导航加「复盘」）、`src/App.tsx`（挂载第四页）
- Test: `src/features/review/review.test.tsx`（组件测试，fake storage + fake engine）

**Interfaces:**
- Consumes: replayStore、analysisStore、`GameRecordsStorage`、现有 `Board`/`BoardStage`/`Panel`/`AppHeader`
- Produces: 顶层导航第四项「复盘」；`ReviewScreen` 从 `useLearnStore.view === 'review'` 挂载

- [ ] **Step 1: learnStore 的 View 扩展**——先写失败测试（`src/store/learnStore.test.ts` 追加）：

```ts
it("view 可以是 'review'", async () => {
  const { useLearnStore } = createLearnStore(memoryGameRecords())
  act(() => useLearnStore.getState().setView('review'))
  expect(useLearnStore.getState().view).toBe('review')
})
```

实现：`LearningProgress.lastView` 类型加 `'review'`。**进度 schemaVersion 不递增**——联合类型放宽不破坏旧数据（旧数据里不会有 'review'，读回来照常解析）。
- [ ] **Step 2: GameLibrary**——失败测试（关键断言）：

```ts
it('空库显示引导文案', async () => {
  render(<GameLibrary storage={memoryGameRecords()} onOpen={vi.fn()} />)
  expect(await screen.findByText('还没有保存的对局')).toBeInTheDocument()
})

it('列出棋谱并按 seq 降序，点击打开', async () => {
  const storage = memoryGameRecords()
  const first = await storage.put({ ...fiveMoveRecord() })
  const second = await storage.put({ ...threeMoveRecord() })
  const onOpen = vi.fn()
  render(<GameLibrary storage={storage} onOpen={onOpen} />)

  const items = await screen.findAllByTestId(/^record-/)
  expect(items[0]).toHaveAttribute('data-testid', `record-${second.seq}`)  // 最近的在前
  expect(within(items[0]).getByText(/9 手|5 手|和棋|认输/)).toBeInTheDocument()
  fireEvent.click(items[0])
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ seq: second.seq }))
})
```
- [ ] **Step 3: ReplayBoard**——失败测试（关键断言）：

```ts
it('渲染派生局面与手数计数，且不可落子', () => {
  useReplayStore.getState().open(recordWith3Moves)
  render(<ReplayBoard />)
  expect(screen.getByTestId('move-counter')).toHaveTextContent('0 / 3')

  // 落子编号：第 1 手在盘上有编号标记
  act(() => useReplayStore.getState().stepNext())
  // Board 的 marks 渲染编号文本，沿用 Phase 3 的 data-testid 约定
  expect(screen.getByTestId('mark-0')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('intersection-7-7'))
  // 不可交互：棋盘没有任何新子、也没有报错
  expect(useReplayStore.getState().cursor).toBe(1)
})
```
  工具条按钮（上一步/下一步/自动播放/回到列表）的禁用态各断言一条（cursor=0 时「上一步」禁用；cursor=total 时「下一步」禁用）。**分析面板的头部必须注明引擎档位、预算与版本**：`分析 · {DIFFICULTY_LABELS[difficulty]} · {budgetMs}ms · 引擎 {ENGINE_VERSION}`——这是「分析结果注明引擎版本、搜索预算与结论局限」验收项的 UI 落点；`topLosses` 每条同时显示**引擎推荐的着法坐标**（`formatPoint(v.engineMove)`，用 `lib/coords.ts` 的现有函数）与玩家实际着法坐标。
- [ ] **Step 4: ReviewScreen 组装**——失败测试：列表 → 点击 → 回放器出现；点「分析」调 `analysisStore.start`；进度显示 `verdicts.size / total`；完成后 `topLosses` 列表渲染（`verdictLabel` 文案）；「错过直接取胜」的结论排最前。
- [ ] **Step 5: App.tsx 挂载 + AppHeader 导航**，`NAV_LABELS`/`NAV_ORDER` 加 `'review': '复盘'`。
- [ ] **Step 6: 全量测试过**；**Step 7: Commit** `feat(review): 复盘页——棋谱列表、回放器与分析面板`

## Task 7：对局结束后写库 + 端到端 + 文档

**Files:**
- Modify: `src/store/gameStore.ts`（终局时产出记录）、`src/store/useGameStore.ts`（接 storage）、`src/features/battle/BattleScreen.tsx`（保存提示）
- Create: `e2e/review.spec.ts`
- Modify: `docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、`docs/TEST_REPORT.md`

**Interfaces:**
- Consumes: Task 2 的 `GameRecordsStorage`、`core/game` 的终局判定
- Produces: 终局自动入库；e2e 套件 + 更新后的文档

- [ ] **Step 1: 失败测试（gameStore）**——终局（status 变为 won/draw/resigned）时 gameStore 调用注入的 `onGameEnd` 回调（`createGameStore(engine, options?)` 加第二个可选参数），回调参数含完整对局信息；`newGame`/`restore` 不触发。**实现注记**：store 不直接依赖 storage（保持可注入测试），`useGameStore.ts` 里组装 `createGameStore(engine, { onGameEnd: (record) => void indexedDbGameRecords.put(record) })`。
- [ ] **Step 2: 确认红 → 实现 → 过绿。** UI 层在终局弹窗补一行「这局已存入棋谱库」（失败时「没能保存，可稍后在复盘页重试」——复用 record.put 的 promise 结果）。
- [ ] **Step 3: e2e 用例**（`e2e/review.spec.ts`，桌面 chrome 项目）。**成局方式**：本地双人模式（`pvp`，无 AI 应手、每手都由测试点出，完全确定），黑棋沿第 7 行连下 (3,7)(4,7)(5,7)(6,7)(7,7) 五点、白棋在远处随便点五个不相干的点，第 9 手黑棋成五终局。走真实 UI 点击，不用 `page.evaluate`：
  1. 下完一局 → 终局弹窗出现「这局已存入棋谱库」；切到复盘页，列表出现该记录
  2. 打开回放，验证落子编号与 `move-counter` 计数
  3. 走一步、退一步，棋盘正确变化
  4. 自动播放开启后等两手，暂停
  5. 刷新页面，记录仍在（IndexedDB 持久）
  6. 发起分析，等待完成（每手 2 请求 × 400ms 预算 × 9 手 ≈ 7s，`test.setTimeout` 放宽到 30s），结论列表与「分析 · 入门 · 400ms · 引擎 search-1」标注出现
  7. 分析进行中切到对战页再切回，分析状态保持（verdicts 不清空）
- [ ] **Step 4: 真实浏览器目视复核**（截图存 `docs/screenshots/phase4-*.png`）
- [ ] **Step 5: 文档同步**：
  - `ARCHITECTURE.md`：分层图加 `analysis/`；「关键数据流」加「终局 → 棋谱库」「复盘分析管线」两条；「并发的五处关键约定」核实是否需要改成六处（共享请求计数器）
  - `ROADMAP.md`：Phase 4 勾选完成，如实记已知不足（朴素版双请求、分析预算 400ms 的局限、回放游标不持久化是有意的）
  - `TEST_REPORT.md`：新增测试文件与计数、e2e 计数、浏览器验证记录、反向验证记录
- [ ] **Step 6: 五道闸门全绿**；**Step 7: Commit** `feat(review): 终局入库、端到端验收与文档`

---

## 收尾自审清单（写计划时已核，执行时每任务完成后再核一遍）

- [x] 7 条验收项 → 任务映射：棋谱库=Task 2 + 7（终局入库）；回放=Task 3 + 6；落子编号=Task 6 Step 3；失误识别=Task 4+5（以「分差+可靠度」呈现，不设固定档位）；注明引擎/预算/局限=Task 1 `ENGINE_VERSION` + Task 6 Step 3 面板头标注（档位·预算·引擎版本）；缓存=Task 4 cacheKey + Task 5 复用；关键局面推荐=Task 4 engineMove + Task 6 topLosses（含推荐坐标）
- [x] 无占位符（每个测试都给了断言内容或真实代码；全文无 TBD/TODO/「类似 Task N」）
- [x] 类型一致性：`GameRecord.seq`（T2 定义，T3/T5/T6 消费，无遗留 recordId）；`MoveVerdict`（T4 定义，T5/T6 消费）；`moveIndex`（T1 定义，T5 消费）；`ENGINE_VERSION`（T1 定义，T4 cacheKey 与 T6 面板头消费）；`nextRequestId()`（T5 定义，gameStore 改接线）
- [x] Review Focus 五条各绑对任务：1→T2/T7；2→T3；3→T5；4→T3/T7；5→T4/T5
- [x] 约束自查：无 `enum`；`Date.now()` 不进新代码（savedAt 已删，用自增 seq）；分析请求只读不落子；Worker 只在既有两个文件
- [x] 计数换算有出处：loss→子数用 10_000（`SHAPE_VALUE.openThree` 的量级），已在 verdictLabel 注释写明粗略性
