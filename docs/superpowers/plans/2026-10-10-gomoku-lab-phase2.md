# Gomoku Lab Phase 2 实施计划 · 强化 AI

> **归档文件**：这是**当时的实施计划**，不是当前状态。文中的路径、符号名与 `- [ ]` 复选框
> 都停在写作那一刻——**别照着执行，也别当成现状**。当前进度见 `docs/ROADMAP.md`，
> 实际交付见 `docs/TEST_REPORT.md`。

> **执行方式**：本会话内直接实现（Native）。任务之间共享 `ai/` 的内部接口，且第 4、5、6 三个任务反复在同一批文件上调参与验证，拆给子代理要来回同步状态。

**目标**：把 AI 从「会赢会堵」提升到「有真实战术能力」，开放全部五档难度，并加上 AI 提示。

**架构**：在既有 `core → ai → store → components` 分层内演进。新增 `ai/transposition.ts`（Zobrist 置换表）与 `ai/threat.ts`（VCF / VCT 算杀）；重写 `ai/patterns.ts` 的棋型识别；`ai/search.ts` 拆出可注入选项的算法入口 `searchBoard`，`chooseMove` 退化为协议外壳。提示走同一套引擎，只换 `purpose`，且**从不落子**。

**技术栈**：不新增任何运行时依赖，算法全部自研。

**Spec**：`docs/superpowers/specs/2026-10-10-gomoku-lab-design.md`、`docs/ROADMAP.md` 的 Phase 2 一节、`docs/AI_ENGINE.md`（当前引擎的权威描述与已知局限）。

## 全局约束

- 不新增运行时依赖；`motion` 仍留到 Phase 5。
- 不使用 `enum`、不使用 `any`、不使用 BigInt（BigInt 算术慢一到两个数量级，无法放进每节点的哈希更新）。
- 所有导出函数必须有显式返回类型标注。
- `ai/` 的算法模块不得引入 React、DOM、Zustand、Worker（例外只有 `worker.ts` 与 `browserEngine.ts`）。
- `Date.now()` 只允许出现在 `ai/search.ts`，且超时必须能通过 `budgetMs` 在测试里强制触发。
- 界面文案一律简体中文。
- 每次提交前 `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e` 五条全绿。
- **性能数字必须实测后写进文档，不得估算。**

## Review Focus

规格隐含、但各任务自身的测试不会覆盖、且最容易伤到真实玩家的情形，每条绑定到具体任务：

1. **AI 深算期间界面必须仍然可操作** —— 专家档单次搜索可达数秒。玩家此时悔棋 / 重开 / 认输 / 切难度，迟到的结果绝不能让棋局倒退或错位（Task 7、Task 8）。
2. **提示绝不能改动真实棋局** —— 提示与落子共用引擎，只要有一处忘了隔离，就会「请求提示反而下了一子」（Task 7）。
3. **提示结果必须随棋局失效** —— 提示算出后玩家先落了子，旧推荐点指向的是过时局面，高亮必须消失（Task 7、Task 8）。
4. **算杀不得误报** —— 声称「有强制取胜路线」时那条路线必须真的走得通；误报会让 AI 走出一连串送死的冲四（Task 5）。
5. **接近满盘时不得崩** —— 空位很少时候选集、威胁枚举、算杀都容易越界或死循环；且最后一手仍要判胜而不是判和（Task 1–5）。

---

## 文件结构

```
src/ai/
├─ types.ts            [改] 请求加 purpose；响应加 candidates / urgency；新增棋型与提示类型
├─ patterns.ts         [重写] 基于成五点的棋型识别，支持隔子棋型
├─ evaluate.ts         [改] 线段评估支持隔子四威胁（有明确的范围界定，见 Task 2）
├─ transposition.ts    [新] Zobrist 哈希与置换表
├─ threat.ts           [新] VCF（连续冲四）与 VCT（连续威胁）算杀
├─ search.ts           [改] 拆出 searchBoard；接入置换表、杀手着法、窄窗迭代加深
├─ difficulty.ts       [改] 五档参数落地，开放全部难度
├─ candidates.ts       [不变]
├─ engine.ts           [不变]
├─ worker.ts           [不变]
└─ browserEngine.ts    [不变]

src/store/gameStore.ts                [改] 提示请求编排（与落子请求共用过期校验但互不挤占）
src/components/board/Board.tsx        [改] 提示落点标记
src/components/panels/HintPanel.tsx   [新] 提示面板
src/components/panels/SettingsPanel.tsx [改] 难度全开
src/features/battle/BattleScreen.tsx  [改] 接入提示面板与棋盘标记
```

---

## Task 1：棋型识别的模式化重写

**Files**
- Rewrite: `src/ai/patterns.ts`
- Test: `src/ai/patterns.test.ts`（新建）

**问题**：现有 `analyzePoint` 只数「连续同色 + 两端开合」，识别不了 `B B _ B` 这类隔子结构（`docs/AI_ENGINE.md` 已知局限第 1 条）。

**算法**：不再数连续子，改为**枚举成五点**。

取以 `point` 为中心、长度 9 的窗口（越界记为「被堵」）。假定 `player` 已在该点落子后：

- 枚举全部**包含中心点**的 5 连窗口（共 5 个）。
- 某窗口 5 格全己方 → **成五**。
- 某窗口恰 4 格己方、1 格空 → 那个空格是一个**成五点**。
- 按该方向的成五点集合判定：
  - ≥ 2 个不同成五点 → **活四**（对手堵不住）
  - 恰 1 个 → **冲四**
  - 0 个 → 再看三：对该方向每个空位 `q` 试放一子，重跑上面的成五点统计。若能让成五点 ≥2 → `q` 是**活三点**；只到 1 → `q` 是**眠三点**。有活三点即记活三，否则有眠三点记眠三。

这个定义自动覆盖隔子型：`mm.mm` 恰 4 己方 1 空，成五点就是中间那个空位。

**双威胁**：不由 `analyzePoint` 判定，而由 `shapeScore` 的**组合加成**判定——四个方向上同时出现多个四 / 一个四加一个活三 / 两个活三，才是真正的双威胁。这部分逻辑 Phase 1 已有，本任务补测试把它钉住。

**两档精度（关键，直接决定搜索跑不跑得动）**：判定「三」需要对该方向每个空位试放一子再重数成五点，单点约上千次读格。这个代价放不进搜索热路径——`moveOrderScore` 在每个节点要对**全部**候选（可上百）各算两次，一乘就是十万量级。所以拆成两个函数：

| 函数 | 判到什么 | 单点代价 | 用在哪 |
| --- | --- | --- | --- |
| `analyzeFast` | 成五 / 活四 / 冲四 | 约百次读格 | **搜索内部**：着法排序、`canWinNow`、威胁检测 |
| `analyzePoint` | 再加活三 / 眠三 | 约千次读格 | 只在**提示与威胁展示**里调用，绝不出现在每节点的路径上 |

`moveOrderScore`、`isWinningPoint`、`threatAt` 一律基于 `analyzeFast`。这条边界必须守住，否则专家档会慢到不可用。

```ts
export type ThreatKind = 'five' | 'openFour' | 'four' | 'openThree' | 'three' | 'none'

export interface DirectionThreat {
  readonly kind: ThreatKind
  /** 该方向上全部能立刻成五的空点 */
  readonly winningPoints: readonly Point[]
}

export function analyzeDirection(board: Board, point: Point, player: Player, dir: Point): DirectionThreat

/** 廉价档：只判成五与活四 / 冲四。搜索内部只许用这个。 */
export interface FastThreat {
  readonly five: boolean
  readonly openFour: boolean
  readonly four: boolean
  readonly winningPoints: readonly Point[]
}
export function analyzeFast(board: Board, point: Point, player: Player): FastThreat

/** 四方向汇总。字段名沿用 Phase 1，语义改为按上面的定义计数。 */
export interface ShapeCount {
  five: number; openFour: number; four: number
  openThree: number; three: number; openTwo: number; two: number
}
export function analyzePoint(board: Board, point: Point, player: Player): ShapeCount
export function shapeScore(counts: ShapeCount): number
export function isWinningPoint(board: Board, point: Point, player: Player): boolean
export function threatAt(board: Board, point: Point, player: Player): number
export function moveOrderScore(board: Board, point: Point, player: Player): number
```

`two` 仍沿用「连续两子 + 两端开合」的旧口径——二只影响排序，不值得为它做窗口枚举。这一点要写进注释，免得后来人以为漏了。

- [ ] **Step 1：写失败测试** `src/ai/patterns.test.ts`

```ts
describe('analyzeDirection —— 成五与四', () => {
  it('连续四子补上第五子判成五')
  it('.mmmm. 是活四：两个成五点')
  it('mmmm. 是冲四：只有一个成五点')
  it('mm.mm 是冲四，成五点是中间的空位')      // ← 隔子型，旧实现漏判
  it('m.mmm 是冲四')
  it('mmm.m 是冲四')
  it('贴边的 mmmm. 仍是冲四而不是活四')        // ← 越界端不算开口
  it('被对手堵死的 mmmmo 什么都不是')
})

describe('analyzeDirection —— 三', () => {
  it('.mmm. 是活三：存在能做成活四的点')
  it('.mm.m. 是活三：中间空位能做成活四')      // ← 跳三，旧实现漏判
  it('.m.mm. 是活三')
  it('ommm. 是眠三：只能做成冲四')
  it('.mm.mo 是眠三')
  it('两子不构成三')
})

describe('analyzePoint —— 汇总', () => {
  it('两个方向各有冲四时分别计入')
  it('成五时只计 five，不再计更低级棋型')
  it('空盘上任意点都是 none')
  it('贴四边与四角都不越界、不死循环')
})

describe('shapeScore —— 棋型与双威胁', () => {
  it('活四 > 冲四 > 活三 > 眠三 > 活二')
  it('成五的分值高于任何组合')
  it('双冲四高于单个冲四加活三')               // ← 双威胁
  it('四三组合高于单个活三')
  it('双活三高于单个活三')
  it('单活三高于双活二')
})
```

- [ ] **Step 2：`yarn test src/ai/patterns.test.ts` 确认失败**，失败原因必须是断言不符或模块缺失，不是语法错误。
- [ ] **Step 3：实现。** 保证 5 个窗口枚举出的同一个成五点不会重复计数。
- [ ] **Step 4：全绿。**
- [ ] **Step 5：回归 `search.test.ts` / `evaluate.test.ts`。** 若因棋型语义变化而破，先判断是「新语义更正确」还是「实现有 bug」——前者改测试并写明理由，后者改实现。
- [ ] **Step 6：提交。**

## Task 2：评估函数支持隔子四威胁

**Files**
- Modify: `src/ai/evaluate.ts`
- Test: `src/ai/evaluate.test.ts`

**问题**：`scoreLine` 按「连续同色段 + 两端开合」打分，`B B _ B B` 这种必胜形状只被当成一个二。

**范围界定（重要）**：叶子节点每毫秒要算上万次，**不能**把 Task 1 的完整成五点分析搬进来——那需要每个空位试放一子，单条线段就要几百次操作，72 条线乘两个颜色直接超出预算。所以这里只做一件精准的补强：

把线段切成「段」（被对手子或棋盘边夹住的一段连续非对手格），对每个长度 ≥5 的段滑一个 5 窗口，统计窗口内的己方子数 `n`：

- 出现 `n === 5` → 该段记成五
- 否则若存在 `n === 4` 的窗口 → 该段记**四威胁**，成五点就是那些窗口里的唯一空位，按成五点数量区分：**≥2 个 → 活四，恰 1 个 → 冲四**。这一步是本次升级真正要拿到的东西（`mm.mm` 这类隔子四，旧实现看不见）
- 否则若存在 `n === 3` 的窗口 → 该段记**三威胁**，活三 / 眠三沿用 **Phase 1 的连续口径**（连续三子 + 两端可延展）判定

**为什么三不用精确口径**：精确区分活三与眠三，要对该段每个空位试放一子再重数成五点，单条线段就是上千次操作。这里有个容易写错的陷阱——**成五点只可能由 `n === 4` 的窗口产出**，而能走到「三」这一支就说明段内根本没有 `n === 4` 的窗口，此时「段内成五点数」恒为 0，拿它区分活三眠三会永远分不开，比 Phase 1 还差。所以三继续用便宜且已经被验证过的连续口径，精确口径留给 `analyzePoint`（提示与威胁展示用）。

**每个段最多计一次**，不是每个窗口计一次——否则 `.mmmm.` 会被两个窗口各命中一次，活四算成两份。

```ts
export function evaluateBoard(board: Board, player: Player): number   // 签名不变
export { WIN_SCORE }
```

- [ ] **Step 1：写失败测试**

```ts
it('隔子四 BB_BB 的分值高于普通活二')          // ← 新能力
it('成五仍是最高分')
it('活四高于冲四')                              // 既有断言必须继续成立
it('活三高于眠三')                              // ← 三沿用连续口径，这条必须仍然成立
it('.mmmm. 只计一次活四，不因滑窗重复累加')      // ← 防重复计数的关键回归
it('.mm.mm. 是冲四而不是活四')                  // ← 成五点只有中间那一个
it('黑白互换后分值相等')
it('空盘双方都是 0')
it('两端堵死的段不计分')
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现。**
- [ ] **Step 4：全绿，且既有 `evaluate.test.ts` 断言全部保持成立**（它们描述的是「更高级棋型分值更高」，与实现方式无关，不该需要改）。
- [ ] **Step 5：实测单次 `evaluateBoard` 耗时**，与 Phase 1 的实现对比，把数字记进 Task 9 的基准。
- [ ] **Step 6：提交。**

## Task 3：Zobrist 置换表

**Files**
- Create: `src/ai/transposition.ts`
- Test: `src/ai/transposition.test.ts`

**方案**：用两个 32 位分量表示局面哈希（不用 BigInt，理由见全局约束）。

```ts
export interface ZobristKey {
  readonly hi: number   // 32 位无符号
  readonly lo: number
}

/** 局面哈希的三种操作，严格互逆、可增量维护。 */
export function computeKey(board: Board, player: Player): ZobristKey
export function toggleStone(key: ZobristKey, index: number, player: Player): ZobristKey
export function toggleTurn(key: ZobristKey): ZobristKey

export type TtFlag = 'exact' | 'lower' | 'upper'

export interface TtEntry {
  readonly lo: number
  readonly depth: number
  readonly score: number
  readonly flag: TtFlag
  readonly move: Point | null
}

export interface TranspositionTable {
  probe(key: ZobristKey, depth: number): TtEntry | null
  store(key: ZobristKey, entry: TtEntry): void
  readonly size: number
  clear(): void
}

export function createTranspositionTable(): TranspositionTable
```

- 为每个 `(格下标, 颜色)` 预生成一对随机 32 位数，另有「轮到谁走」的一对。
- 置换表用 `Map<number, TtEntry>`，**键是 `key.hi`**；命中后必须比对 `entry.lo === key.lo` 才算真命中。十万级条目下 32 位主键会有个位数碰撞，靠 `lo` 兜住——这比字符串键快得多，也比单 32 位键安全。
- 替换策略：同一个 `hi` 冲突时保留 `depth` 更大的；深度相同则覆盖。

- [ ] **Step 1：写失败测试**

```ts
describe('Zobrist 哈希', () => {
  it('同一局面多次计算得到同一个键')
  it('落子后再撤销，哈希回到原值')               // ← 增量互逆
  it('增量落子算出的键与一次性计算一致')
  it('只差一颗子，hi 与 lo 至少有一个不同')
  it('同一棋盘、轮到不同方，键不同')
  it('黑白互换后的局面键不同')
  it('空盘与只放一子的局面键不同')
})

describe('置换表', () => {
  it('存入后能按同一 key 取出')
  it('lo 对不上时视为未命中')                    // ← 碰撞防护
  it('深度不足时不返回')
  it('同 key 冲突时保留深度更大的条目')
  it('clear 之后取不到东西')
  it('size 反映当前条目数')
})
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现。**
- [ ] **Step 4：全绿。**
- [ ] **Step 5：提交。**

## Task 4：搜索接入置换表并调优迭代加深

**Files**
- Modify: `src/ai/search.ts`
- Test: `src/ai/search.test.ts`

**结构调整**：把算法入口从协议里拆出来，`chooseMove` 退化成薄壳。

```ts
export interface SearchOptions {
  readonly width: number
  readonly maxDepth: number
  readonly budgetMs: number
  readonly transposition: boolean
  // Task 5 会加上 threatPlies，Task 7 会给 SearchOutcome 加上 candidates。
  // 刻意不在本任务里预留：预留会让 Task 4 单独做完无法通过类型检查。
}

export interface SearchOutcome {
  readonly move: Point | null
  readonly score: number
  readonly depth: number
  readonly nodes: number
  readonly reason: SearchReason
}

export function searchBoard(
  board: Board,
  player: Player,
  options: SearchOptions,
  now: () => number,
): SearchOutcome
```

`now` 注入进来是为了让超时行为可测——全局约束要求超时必须能通过 `budgetMs` 强制触发，注入时钟让「确定性地制造超时」成为可能，不必依赖真实时间。

`transposition: false` 是**正式选项**（对照基准用），不是测试专用钩子。

**要点**

1. `negamax` 每节点先 `probe`：命中且深度足够就按 `flag` 剪枝或收紧边界。
2. 每节点结束 `store`，`flag` 由「是否发生过 beta 截断 / 是否提升过 alpha」决定。
3. 着法排序：置换表里的最佳着法优先，其次 `moveOrderScore`（**走 `analyzeFast`，不是 `analyzePoint`**），再叠加**杀手着法**（同层造成过截断的两个着法）。
4. 迭代加深：逐层加深，超时返回上一层结果；根节点用上一层分数做**窄窗**试探，失败则全窗重搜——这是专家档能搜得更深的关键。
5. **必胜分值必须按 ply 归一化后再进置换表**。当前 `canWinNow` 返回 `WIN_SCORE - (params.depth - depth)`，这个差值耦合了「本次迭代的目标深度」：同一局面在第 4 层搜到和第 8 层搜到会得到不同分值，直接存表就会让 AI 放弃立刻成五、去追一条「更早赢」的假路线。做法是显式跟踪 `ply`（距本次搜索根的手数），存表时把必胜分换算成距**该节点**的步数、查表时再换算回距根的步数——这是标准做法，约四行代码，但不做就是错的。

**必须保持的既有契约**：`search.test.ts` 现有 14 条断言（立即取胜 / 必防 / 能赢就不防 / 白棋同样会赢 / 活三应对 / 成四机会 / 天元开局 / 满盘无着 / 落点合法 / 超时回退 / 精确结论 / 节点与耗时 / 难度差异 / 请求标识回传）**一字不得改**。

- [ ] **Step 1：先加失败测试**

```ts
it('开启置换表后节点数显著少于关闭时')                // 同局面同深度对照
it('置换表确实产生过命中（命中数为正）')              // ← 防止上一条其实在比较两个相等的数
it('开启置换表不改变必胜局面的结论')                  // ← 正确性护栏
it('必胜分值不随迭代深度漂移：同一局面在不同 maxDepth 下给出同一个着法')
it('注入的时钟走到预算耗尽时返回超时回退，并给出合法着法')
```

**关于「开启置换表节点数更少」这条用例**：换位只在「不同着法次序到达同一局面」时才发生，随手挑一个局面很可能一次都命中不了，两个节点数相等，用例就变成废话。必须先挑一个真会产生换位的局面（中盘、多个方向都有应手），并让「命中数为正」这条独立断言把前提钉死。

**关于「不改变搜索结果」**：α-β 在**同分着法**之间换次序是合法的，直接断言「着法相同」会脆断。所以用**有唯一正确着法的局面**（例如必须堵的冲四、或直接取胜点），断言结论一致——这样既严格又不会因为排序优化而误报。

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现。**
- [ ] **Step 4：全绿，且既有 14 条断言一字未改。**
- [ ] **Step 5：提交。**

## Task 5：算杀搜索（VCF 与 VCT）

**Files**
- Create: `src/ai/threat.ts`
- Test: `src/ai/threat.test.ts`

**术语**

- **VCF**（Victory by Continuous Fours）：只走冲四的强制取胜搜索。攻方每步都造成「对手不堵就输」的威胁，守方因此没有选择余地。
- **VCT**（Victory by Continuous Threats）：在 VCF 基础上再允许**活三**做强制着法。活三的应手不止一个，分支更大、更贵，但能发现 VCF 看不到的杀。

两者共用同一套递归，用 `allowThrees` 切换——不写成两份代码。

**为什么值得做**：它能在很浅的深度里发现普通搜索看不到的十几步杀，代价远低于同深度的全宽搜索，是五子棋引擎性价比最高的战术能力。

```ts
export interface ThreatSearchResult {
  /** 找到的强制取胜着法；没有则为 null */
  readonly move: Point | null
  /** 取胜链长度（手数） */
  readonly plies: number
  readonly nodes: number
}

export interface ThreatSearchOptions {
  readonly maxPlies: number
  /** 是否允许活三作为强制着法（VCT）。false 即纯 VCF。 */
  readonly allowThrees: boolean
  readonly deadline: number
}

export function findForcedWin(
  board: Board,
  player: Player,
  options: ThreatSearchOptions,
): ThreatSearchResult
```

**递归（攻方恒为 `player`，措辞里严格区分「我」与「对手」）**

1. 若**我**有直接成五点 → 返回该点，`plies = 1`。
2. 枚举**我**全部冲四点：落下后**我**的成五点恰好一个的那些点，记为 `q`。
3. 对每个 `q`：
   1. 落子。若此时**我**的成五点变成 ≥2 个 → 这已经是活四，对手只能堵一个，**我**下一手必成五 → 直接返回 `q` 为胜。
   2. 若**我**的成五点恰好一个 `w`：
      - 先看**对手**此刻有没有自己的成五点。若有，说明这个冲四不成立（对手不理会，直接自己成五赢）→ 放弃 `q`。
      - 否则对手**被迫**只能下在 `w`（不下则**我**下一手成五）。落下 `w`，`maxPlies` 减 2，递归。
   3. 若**我**的成点数为 0 → `q` 不是冲四，跳过。
4. `allowThrees` 为真时，除冲四外再枚举**我**的活三点，对每个活三枚举对手的**全部**应手（堵住该活三可以成四的每个点、以及对手自己的反冲四），逐个递归——这正是 VCT 比 VCF 贵的地方，分支因子从 1 变成 2~3。
5. 任一支路走通即返回；全部走不通返回 `null`。
6. 每节点检查 `deadline`，超时立即收手返回 `null`——**宁可说「没找到」，也绝不给出没验证过的杀**。

**代价与调用位置**：`findForcedWin` 在**根节点、主搜索之前**调用一次，与主搜索**共用同一个 `budgetMs`**——它先花掉一部分，剩余预算才交给迭代加深。找到杀就直接返回，不再跑主搜索。这是必须写死的约定，否则「专家档 4000ms」会被算杀悄悄翻倍。

**一个有意留下的漏杀**：VCT 只枚举守方的「堵活三」与「反冲四」，不枚举守方用**自己的活三**反制。加入它会让分支因子再翻一倍以上，收益远不及代价。这是**漏杀而非误报**——方向是安全的：可能错过某些杀，但绝不会谎报一个不存在的杀。这一条要如实写进 `docs/AI_ENGINE.md` 的已知局限。

- [ ] **Step 1：写失败测试**

```ts
describe('findForcedWin —— VCF', () => {
  it('一步成五时直接返回该点')
  it('找得出两步的连续冲四杀')
  it('找得出四步以上的连续冲四杀')
  it('没有杀时返回 null')
  it('对手能反先成五时不算杀，返回 null')        // ← 防误报核心：对手不理会，直接自己赢
  it('落子后我方成五点变成两个时判为活四胜，不要求对手应手')
  it('我方成点数恰为一个时，对手被迫下在那个成五点')   // ← 强制链成立的核心
  it('maxPlies 用尽即收手，返回 null')
  it('超时返回 null，绝不返回未验证的着法')       // ← 防误报核心
  it('返回的杀着一定落在空位上')
  it('接近满盘时不越界、不死循环')
})

describe('findForcedWin —— VCT', () => {
  it('找得出 VCF 看不到、但靠活三能成立的杀')     // ← 证明 VCT 确实更强
  it('allowThrees 为 false 时同一局面返回 null')   // ← 与上一条对照，证明差别来自活三
  it('同样不误报')
})
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现。**
- [ ] **Step 4：全绿。**
- [ ] **Step 5：实测单次算杀耗时与命中率**（对一组固定局面，记录有杀局面数 / 耗时），记进 Task 9 的基准。
- [ ] **Step 6：提交。**

## Task 6：五档难度落地与引擎对局验证

**Files**
- Modify: `src/ai/difficulty.ts`、`src/ai/search.ts`、`src/components/panels/SettingsPanel.tsx`
- Test: `src/ai/difficulty.test.ts`、`src/ai/selfplay.test.ts`（均新建）

| 难度 | width | maxDepth | budgetMs | 算杀手数 |
| --- | --- | --- | --- | --- |
| 入门 | 6 | 1 | 400 | 关 |
| 初级 | 10 | 2 | 900 | 关 |
| 中级 | 10 | 4 | 1500 | 6 |
| 高级 | 12 | 6 | 2500 | 10 |
| 专家 | 14 | 10 | 4000 | 14 |

难度差异来自**真实的能力差异**：入门 / 初级关闭算杀且深度只有 1–2，中级以上开启算杀并逐级加深。

**`maxDepth` 是安全上限，不是承诺**。真正约束搜索的是 `budgetMs`——迭代加深在预算耗尽时就会停。把上限设成 12 只会让文档看起来更强，实际到不了；`14^6` 量级的节点下界在 4 秒内不可能走完（浏览器 JS 4 秒大约只能处理 10^5~10^6 个节点，而每个叶子还要扫 72 条线）。所以专家档的上限压到 10，并在 `AI_ENGINE.md` 里如实写明「实际达到的深度由时间预算决定，见实测数据」。**该让步的是深度上限，不是叶子评估的精度**——评估精度是棋力的地基，砍它等于整体变弱。

**置换表五档一律开启**——它只影响速度不影响棋力，对低档关掉属于人为削弱，没有意义，因此不进参数表。

**算杀与主搜索共用 `budgetMs`**，不额外加时。详见 Task 5 的「代价与调用位置」。

- [ ] **Step 1：写难度参数测试**

```ts
it('五档的时间预算递增')
it('算杀手数随难度单调不减，且只有入门与初级为 0')
it('AVAILABLE_DIFFICULTIES 覆盖全部五档')
it('五档参数都能通过 isDifficulty 校验（存档兼容）')
it('中级能找出初级找不到的杀：同一有杀局面下两者结论不同')  // ← 行为差异，不是复述常量
it('同一局面下，高档在相同预算内达到的深度不低于低档')
```

「搜索深度严格递增」这条**不写**——它只是把常量表用断言再抄一遍，恒真、零信息。真正要证明的是**行为差异**：中级的算杀开关确实让它看见初级看不见的杀，高档在同一预算内确实搜得更深。后者用固定预算跑同一局面比较实际达到的 `depth`，不依赖机器速度（比较的是同机两次运行）。

- [ ] **Step 2：写引擎对局测试** `src/ai/selfplay.test.ts`

**必须用固定深度而非时间预算**——按时间搜索时超时命中哪一层依机器而定，结果不可复现，测试会变成掷骰子。做法是把 `budgetMs` 给足、让 `maxDepth` 成为真正的约束。

```ts
it('高级在四个不同开局下至少赢下入门三局')
it('同一难度自对弈时，不同开局会走出不同棋局')     // 防止「其实只跑了一局」
it('五档都能走完一整局，且全程不产生非法着法')
it('自对弈结果可复现：同一开局跑两次得到完全相同的棋谱')  // ← 确定性护栏
```

**不断言「必然全胜」**——棋类对局有偶然性，断言一个可复现的多数优势即可。若实测达不到多数优势，说明难度参数没拉开差距，回头调参数，**不放宽断言**。

**时长控制**：先测实际耗时。若整个文件超过 15 秒，拆成独立的 `yarn test:engine` 脚本，从 `yarn test` 的默认集合里排除，但在最终验收与提交前必跑。这个取舍必须在 `TEST_REPORT.md` 里写明。

- [ ] **Step 3：确认失败。**
- [ ] **Step 4：实现参数与调度。**
- [ ] **Step 5：全绿，记录实测胜率与耗时。**
- [ ] **Step 6：界面开放全部五档**（去掉 `SettingsPanel` 里的 disabled 与「Phase 1 开放两档」文案）。
- [ ] **Step 7：提交。**

## Task 7：提示与分析协议

**Files**
- Modify: `src/ai/types.ts`、`src/ai/search.ts`、`src/store/gameStore.ts`
- Test: `src/ai/search.test.ts`、`src/store/gameStore.test.ts`
- **也要改**：`src/ai/engine.test.ts`（`request()` / `response()` 两个字面量缺 `purpose` 与 `candidates`/`urgency`，加了必填字段后无法通过类型检查）、`src/ai/selfplay.test.ts`（Task 6 新建，同样直接构造响应与请求）

**协议扩展**

```ts
export type RequestPurpose = 'play' | 'hint'

export interface SearchRequest {
  readonly requestId: number
  readonly gameVersion: number
  readonly board: Board
  readonly player: Player
  readonly difficulty: Difficulty
  readonly budgetMs?: number
  /** 'play' 出着法；'hint' 只做分析，绝不落子。 */
  readonly purpose: RequestPurpose
}

export interface MoveSuggestion {
  readonly move: Point
  readonly score: number
  /** 我在这里落子能形成的最好棋型 */
  readonly attack: ThreatKind
  /** 对手在这里落子能形成的最好棋型，也就是我堵掉了什么 */
  readonly defense: ThreatKind
}

export type Urgency = 'win' | 'mustBlock' | 'danger' | 'normal'

export interface SearchResponse {
  // …既有字段不变…
  /** 按推荐度降序，最多 3 条。purpose 为 'play' 时是空数组。 */
  readonly candidates: readonly MoveSuggestion[]
  /** purpose 为 'play' 时为 'normal'。 */
  readonly urgency: Urgency
}
```

两个新字段是**必填**（不是可选）：可选会让每个消费点都要处理 `undefined`，而「没有候选」本来就有「空数组」这个自然表示。`respond()` 里给 `purpose === 'play'` 的分支填空数组与 `'normal'`。

**store 侧**

```ts
readonly hint: readonly MoveSuggestion[] | null
readonly hintUrgency: Urgency | null
readonly hintThinking: boolean
readonly hintError: string | null

requestHint(): void
applyHintResponse(response: SearchResponse): void
clearHint(): void
```

- 提示请求与落子请求**共用同一个 `requestId` 计数器**，但分别记在 `pendingHintRequestId` 与 `pendingRequestId` 上，**互不挤占**——提示在飞时玩家仍能落子，反之亦然。
- 提示响应**只写 hint 状态，绝不调用 `applyMove`**。
- 玩家落子 / 悔棋 / 重开 / 认输后一律清空提示（局面变了，高亮必须失效）。
- 不额外记录 `hintGameVersion`：过期判定由「响应里的 `gameVersion` 等于当前 `game.version`」加「`requestId` 仍在飞」两道闸门完成，再存一份版本号是冗余状态。

- [ ] **Step 1：写失败测试**

```ts
// ai/search.test.ts
it('purpose 为 hint 时返回最多三个候选，按分数降序')
it('purpose 为 play 时候选为空数组、紧急度为 normal')
it('purpose 为 hint 时同样能识别必胜与必防的紧急度')
it('hint 返回的着法全部落在空位上')
it('候选带攻击与防守的棋型标注')
it('接近满盘时 hint 不崩，候选数量随空位减少')

// store/gameStore.test.ts
it('请求提示不会改变棋局')                       // ← Review Focus 2
it('提示结果写入 hint 状态')
it('玩家落子后提示被清空')                       // ← Review Focus 3
it('悔棋后提示被清空')
it('重新开始后提示被清空')
it('过期棋局版本的提示响应被丢弃')                // ← Review Focus 3
it('提示在飞时玩家仍然可以落子')                  // ← Review Focus 1
it('落子在飞时仍然可以请求提示')
it('提示失败只影响提示，不影响对局与 AI 落子')
it('AI 深算期间悔棋会作废落子响应，棋局不会倒退')   // ← Review Focus 1
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现。**
- [ ] **Step 4：全绿，既有断言不得改动。**
- [ ] **Step 5：提交。**

## Task 8：提示界面

**Files**
- Modify: `src/components/board/Board.tsx`
- Create: `src/components/panels/HintPanel.tsx`、`src/components/panels/HintPanel.test.tsx`
- Modify: `src/features/battle/BattleScreen.tsx`

**棋盘标记**：`Board` 新增可选 prop `hints?: readonly Point[]`，按推荐顺序画编号 1/2/3 的圆形标记，用强调色，与「最后一手」的朱砂环区分。只画在空位上；未传或为空时不渲染任何东西。

**提示面板**：包含「求提示」按钮（AI 思考中或提示计算中禁用）、紧急程度徽标（必胜 / 必须防守 / 危险 / 一般）、前三个候选（序号、坐标、评分、攻防棋型中文说明）、结论可靠度与预算说明，并明确标注「提示只是建议，不保证最优」。

- [ ] **Step 1：写组件测试**

```tsx
// Board
it('传入 hints 时按顺序渲染编号标记')
it('hints 为空时不渲染标记')
it('标记不会画在已占用的交叉点上')

// HintPanel
it('未求过提示时显示引导文案')
it('计算中禁用按钮并给出提示')
it('展示最多三个候选与坐标')
it('必胜时显示必胜徽标')
it('必须防守时显示防守徽标')
it('标注提示不保证最优')
it('提示请求失败时显示错误且不显示候选')
```

- [ ] **Step 2：确认失败。**
- [ ] **Step 3：实现。**
- [ ] **Step 4：全绿。**
- [ ] **Step 5：补端到端用例**（`e2e/battle.spec.ts`）

```ts
it('请求提示后在棋盘上出现候选标记，且棋局手数未变')   // ← Review Focus 2
it('提示之后落子，提示标记消失')                        // ← Review Focus 3
it('专家档深算期间悔棋仍然可用，且棋局不会倒退')          // ← Review Focus 1
```

- [ ] **Step 6：提交。**

## Task 9：文档、基准与浏览器验证

- [ ] **Step 1：实测并记录基准**：五档 × 五个固定局面（开局 / 中盘 / 四连威胁 / 双三 / 接近满盘）的 depth、nodes、elapsedMs；单次 `evaluateBoard` 耗时；算杀命中率与耗时。**数字必须是跑出来的**，写进 `docs/AI_ENGINE.md` 的「实测」一节。
- [ ] **Step 2：重写 `docs/AI_ENGINE.md`**：棋型定义、评估、置换表、VCF/VCT、五档参数表、实测数据、**更新后的已知局限**（删掉已解决的，如实写下新出现的）。
- [ ] **Step 3：更新 `docs/ARCHITECTURE.md`**：新增模块职责、`searchBoard` 与 `chooseMove` 的分工、提示请求与落子请求的隔离约定。
- [ ] **Step 4：更新 `docs/ROADMAP.md`**：Phase 2 勾选完成，写清移交 Phase 3 的事项；若自对弈测试被拆成独立脚本，在这里写明。
- [ ] **Step 5：更新 `docs/TEST_REPORT.md`**：测试计数、浏览器验证记录、本轮发现的问题与修法。
- [ ] **Step 6：真实浏览器验证**：Chrome 实走——五档难度各下一局、请求提示并核对标记位置、提示后落子确认标记消失、专家档深算时悔棋/重开不出现错位。截图存 `docs/screenshots/`。
- [ ] **Step 7：更新 `README.md`** 的功能清单与截图。
- [ ] **Step 8：两轴代码审查**，修完再提交。
- [ ] **Step 9：最终 `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e`，提交。**

---

## 自审记录

三轮自审查出并已修正的问题，逐条记录以便回溯：

**第 1 轮（覆盖性，对照 ROADMAP 逐条核）**

| 查出 | 修法 |
| --- | --- |
| 漏了 ROADMAP 明列的「威胁空间搜索」 | Task 5 扩为 VCF + VCT 共用递归，用 `allowThrees` 切换，并加对照组测试证明 VCT 确实更强 |
| 「双威胁识别」没有显式验证 | Task 1 补 `shapeScore` 的双四 / 四三 / 双活三测试 |
| 验收标准「界面不被搜索阻塞」无可执行验证 | Task 7 与 Task 8 各加一条用例（深算期间悔棋可用、提示与落子互不挤占） |

**第 2 轮（可执行性）**

| 查出 | 修法 |
| --- | --- |
| Task 6 自相矛盾：参数表把入门标为「置换表关」，正文却写「低档关掉是人为削弱，不做」 | 删掉该列，明确五档一律开启 |
| Task 2 算法不可实现：「滑窗后去重」会让 `.mmmm.` 被两个窗口各计一次；改用长度启发式又会把 `.mm.mm.` 误判成活四 | 改为「按段计一次 + 用段内成五点数区分活四与冲四」，并写明为什么不把完整分析放进叶子评估 |
| Task 5 的 `ctx` 里塞了一个 `nodes` 回调，职责混乱 | 简化为 `{ maxPlies, allowThrees, deadline }`，节点数内部统计后返回 |
| Task 3 的 `createZobrist()` 返回 `hash` 与 `keyFor` 两个含义重叠的方法 | 拆成 `computeKey` / `toggleStone` / `toggleTurn` 三个职责单一的函数 |
| Task 7 的 `hintGameVersion` 是冗余状态 | 删除，过期判定交给既有的两道闸门 |
| Task 4 无法验证置换表是否真的生效 | 拆出 `searchBoard(board, player, options, now)`，`transposition` 是正式选项而非测试钩子 |

**第 3 轮（风险）**

| 查出 | 修法 |
| --- | --- |
| 自对弈测试按时间预算搜索会 flaky（超时命中哪层依机器而定） | 改为固定深度、预算给足，并加一条「同一开局跑两次得到相同棋谱」的确定性护栏 |
| 自对弈测试可能拖慢 `yarn test` 最多 30 秒 | 要求先实测耗时；超过 15 秒就拆成 `yarn test:engine`，并在 `TEST_REPORT.md` 写明取舍 |
| 超时行为依赖真实时间，难以确定性测试 | `searchBoard` 注入 `now: () => number`，可确定性地制造超时 |

**第 4 轮（独立终审，由另一个代理执行）**

| 查出 | 修法 |
| --- | --- |
| **Task 2 的三威胁判别恒失效**：成五点只可能由 `n===4` 窗口产出，而能走到「三」这一支就说明没有这种窗口，点数恒为 0，活三眠三永远分不开——比 Phase 1 更差，还与既有断言冲突 | 三改回 Phase 1 的连续口径，并把「为什么三不用精确口径」写进计划正文，避免实现时再踩 |
| **性能热路径找错**：只约束了叶子评估，漏了 `moveOrderScore`——它每节点对全部候选各算两次完整分析，一乘就是十万量级 | Task 1 拆出 `analyzeFast`（只判成五/四，约百次读格）供搜索内部使用，完整版 `analyzePoint` 只留给提示与威胁展示；并写明这条边界必须守住 |
| **专家档 depth 12 超出预算一个数量级** | 上限压到 10，并明确 `maxDepth` 是安全上限、真正约束是时间预算；文档不得暗示「depth 12」是承诺 |
| **置换表分值耦合剩余深度**：`WIN_SCORE - (params.depth - depth)` 在不同迭代里对同一局面给出不同分值，会让 AI 放弃立刻成五去追假路线 | 显式跟踪 `ply`，存表/查表时按 ply 归一化必胜分 |
| **Task 4 前向依赖**：`MoveSuggestion` 要到 Task 7 才定义、`threatPlies` 要到 Task 5 才有实现，Task 4 单独做完无法 typecheck | 从 Task 4 的类型里移除这两项，由后续任务各自添加 |
| **算杀的调用位置与预算归属没写**，会让「专家档 4000ms」被悄悄翻倍 | Task 5 写明：根节点、主搜索之前调用一次，与主搜索共用同一份 `budgetMs` |
| **Task 5 递归措辞歧义**：「对手恰有一个成五点」没说清是谁的，按字面写会变成让守方落到自己的成五点上 | 重写为严格区分「我」与「对手」的七步，并补两条针对性用例 |
| **VCT 漏了守方用活三反制**（漏杀，方向安全） | 不改实现（分支因子会翻倍），但要求如实写进 `AI_ENGINE.md` 已知局限 |
| **Task 7 加必填字段会打破未列出的文件** | Files 里补上 `engine.test.ts` 与 `selfplay.test.ts` |
| **三条可能白写的用例**：置换表节点数（换位不发生则两数相等）、结果一致性（同分着法换序会脆断）、深度严格递增（只是复述常量表） | 分别改为：加一条「命中数为正」把前提钉死；一致性用例改用有唯一正确着法的局面；深度那条删掉，换成「中级能找出初级找不到的杀」这类真实行为差异 |
