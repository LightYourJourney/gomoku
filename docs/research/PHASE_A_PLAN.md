# 阶段 A · 让界面说对话 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**状态：待批准。批准之前不动任何生产代码。**

**Goal:** 修掉两处「代码整洁但语义不成立」的地方：复盘分差改成同视界比较；「精确 / 启发式」二值改成按事实分的四类可靠度。

**Architecture:** 不动分层、不动搜索。分差的修法落在 `analysis/`（纯函数）与 `store/analysisStore.ts`（多发一个「走完引擎首选之后」的对照请求）；可靠度的修法是把 `ai/types.ts` 里两套近乎重复的分类（`Confidence` 二值 + `SearchPath` 四类）并成一套由 `reason × depth` 推导的四类，界面四处共用一份文案。

**Tech Stack:** TypeScript 6（`erasableSyntaxOnly`，无 enum）、Zustand 5、React 19、Vitest 5、Playwright；包管理器 yarn。

**Spec:** `docs/research/REFACTORING_ASSESSMENT.md` §4.1、§4.2、§5.7、§10「阶段 A」、§14（裁定 3：直接做四类可靠度）。

## Global Constraints

- **不改变任何搜索决策。** `runSearch` / `searchRoot` / 评估 / 难度参数一行不动；`ENGINE_VERSION` 不递增；`bench/baseline.json` 不动。`ai/search.ts` 只改 `chooseMove` 里给 `confidence` 赋值的那一行。
- `core` 与 `ai` 的算法部分不引入 React、DOM、Zustand、浏览器 API；状态不可变；store 里的时间与请求号仍走既有注入点。
- **`requestId` + `gameVersion` 两道闸门、分析管线的三重闸门（`runId` / 在飞标识 / `moveIndex`）语义不变**，只是「在飞标识」从局面号变成任务对象。
- 行为改动**先写失败测试**；每条声称能抓住缺陷的新用例，写完后把修复临时撤掉确认它会红（`AGENTS.md`）。
- 不删有效断言、不加 `.skip`、不引入 `vi.mock`。随函数一起消失的用例（`searchPathOf` / `pathLabel` / `pathSummary` 的）必须由覆盖同一事实的新用例替换，**单测总数只许涨**（基线 1475，`quality/tests.baseline.json` 只上调）。
- 入口包 gzip ≤ **135,000 B**（现 130,417 B，余量 4,583 B）。**不许调松**；超了就先减再加。
- 提交前 `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e` 五条全绿；阶段收尾加 `yarn gates` 与 `yarn e2e:prod`。
- 文档同步按 `AGENTS.md` 的对照表（本阶段涉及 `AI_ENGINE.md`、`ARCHITECTURE.md`、`USAGE.md`、`README.md`、`TEST_REPORT.md`、`ROADMAP.md`）。
- 提交信息沿用仓库风格（`fix(review): …`），不加署名行；只提交、不推送。

## 设计决定（批准时请一并确认）

这几条是计划替你做的选择，每条都能在批准时改掉。

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | **四类的名字是 `shortcut` / `complete` / `partial` / `fallback`**，文案「规则/快速路径判定」「搜满档位深度」「限时内未搜满，取已搜完的层」「一步贪心兜底」。第一类**不叫「已证明」**。 | 这一类里有 `opening`（空盘下天元）——那是约定，不是证明。「规则/快速路径判定」是 Phase 09A 已上线的说法，复盘卡片现在就这么写，沿用它不新增词汇。 |
| D2 | `SearchPath` / `searchPathOf` / `pathLabel` / `pathSummary` **删除**，并入新的 `Confidence`。 | 新的四类正好是旧 `SearchPath` 把 `aborted` 拆成两半；留着就是同一事实的两套穷举映射，这次的倒挂正是这么来的。 |
| D3 | `no_move`（棋盘已满）归入 `shortcut`，分类函数是**全函数**，不返回 `null`。 | 「无棋可走」确实是规则判定。它在四个界面上都到不了（`aiInfo` 写入前被挡掉、提示没有候选时不显示、复盘跳过该手），为它留一个 `null` 只会让四处都多一个到不了的分支。 |
| D4 | **只有两边都「可比」才算分差**；否则 `loss` 为 `null`，界面说「未算分差」，不进亏损榜。可比 = 该局面的搜索结论是 `search`（搜满）或 `win`（成五 / 算杀），或者引擎首选当场成五。 | `block` 的分数是贪心量级、符号不可信（`AI_ENGINE.md` 的量纲表）；`timeout` 的两边可能停在不同层，奇偶层偏差会原样回来。把不可比的数相减，正是这次要修的毛病。 |
| D5 | `MoveVerdict.confidence` **删除**。 | 它原来的含义是「两次搜索里较差的那个」。D4 之后，凡是算得出数的分差都来自两次搜满或已证明的结论，没有「算出来但不可靠」这一档可标。卡片上「引擎首选是怎么来的」由 `reason` 与 `engineDepth` 现推。 |
| D6 | 分析缓存键**不递增**（报告 §4.1 说要递增，这里更正）。 | 缓存是 `createAnalysisStore` 闭包里的 `Map`，只活在内存里；新代码上线必然是空缓存，不存在读到旧口径结论的路径。 |
| D7 | 引擎回的首选落在已有棋子上（真实引擎不可达）时，不发对照请求，该手 `loss` 为 `null`，分析照常跑完。 | 分析是只读的；「没法比」是如实的说法。专门为它开一条错误路径是给到不了的情况写处理。 |
| D8 | **四类的文案不带层数**（你选的说法是「限时内搜到第 N 层」，这里改了）。 | 提示面板的结论行在默认层，而默认层不出现搜索指标（`AiPanel` 有现成断言，`HintPanel` 注明「同一条规矩」）。其余三处（AI 面板技术详情、局面编辑器、复盘卡片）紧挨着就有「深度 N 层」，标签里再写一遍是重复。一套不带数字的文案四处通用，`gameStore` 也不必为提示多存一个深度。 |
| D9 | 分析跑完但榜单为空时，加一句「这一局没有算出亏损的手。」（**可选，建议做**）。 | 新口径下空榜会比现在常见：e2e 用的那局九手棋，旧口径给出两张卡片（第 7、8 手，「分差极大」），预演发现两张都是量纲不同造成的假象——第 7 手黑棋做成活四、与引擎首选同样必胜，第 8 手白棋怎么走都输。新口径下这局一张卡片都没有。空着不说话，看起来像分析坏了。 |

**已知代价（实测，2026-11-17，临时脚本，初级档、预算给足）：** D4 会让一部分手显示「未算分差」。

| 样本 | 着法与引擎不同的手 | 有亏损 | 零亏损 | 未算分差 |
| --- | --- | --- | --- | --- |
| 随机着法（6 个开局各 40 步） | 205 | 152（≥ 半子 109） | 16 | **37（18%）** |
| 入门档自对弈，由初级档复盘 | 26（全局 98 手里） | 6（≥ 半子 3） | 12 | **8（31%）** |

未算的几乎全是「某一边走完之后对手只有一手必防」（`block`）。要把这部分也算出来，得沿着必防手再往下搜一层，那是后续的事，不在本阶段。Task 4 会把这组数字做成可复跑的基线。

## Review Focus

规格没有逐条写、但用的人最可能撞上的五种情况。每条都在对应任务里有一条用例钉住。

1. **分析到一半换了棋谱**：上一局的对照请求迟到，不得写进新一局（Task 2，用例 8）。
2. **引擎首选当场成五**：对照局面已经终局，不得拿终局盘面去搜（Task 2，用例 4）。
3. **对照请求失败**：以错误收尾，面板不得停在「分析中 N−1 / N」（Task 2，用例 7）。
4. **缓存里有 `null` 分差的结论**：第二次打开同一局，榜单排序与当前手文案不崩（Task 2，用例 9）。
5. **专家档超时但搜到了第 6 层**：默认层不得出现「不保证最优」的警示条；一层都没搜完时警示条必须在（Task 3，AiPanel 两条用例）。
6. **最后一手没分出胜负、且与引擎首选相同**（认输局、中途结束的双人局）：最后一个局面的响应回来后必须收尾，不得停在「分析中 N / N」（Task 2，用例 11——终审发现，见文末）。

## 文件一览

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/analysis/analyze.ts` | 改 | 新增 `AfterMove` / `horizonLoss`；`buildVerdict` 改口径；`loss` 可为 `null`；删 `pathLabel` / `pathSummary` |
| `src/store/analysisStore.ts` | 改 | 任务队列（局面 / 对照两种），拼结论的条件 |
| `src/ai/types.ts` | 改 | `Confidence` 改四类；新增 `confidenceOf`；删 `SearchPath` / `searchPathOf` |
| `src/ai/search.ts` | 改 1 行 + 1 处注释 | `chooseMove` 用 `confidenceOf` |
| `src/lib/confidence-labels.ts` | **新建** | 四类的文案与兜底警示语（仿 `lib/shape-labels.ts`：一套词汇、多个消费方） |
| `src/components/panels/AiPanel.tsx` | 改 | 玩家视图文案、「结论」一栏、警示条条件 |
| `src/components/panels/HintPanel.tsx` | 改 | 结论一行 |
| `src/features/positions/PositionEditor.tsx` | 改 | 结论一栏与警示语 |
| `src/features/review/ReviewScreen.tsx` | 改 | 当前手文案、卡片第三行、说明文字、空榜说明（D9） |
| `e2e/review.spec.ts` | 改 | 两条依赖榜单卡片的用例换一局真有亏损的棋 |
| `bench/review-loss.measure.ts` | 改 | 第二项测量改走生产函数，输出「未算分差」占比 |
| 各 `*.test.ts(x)`、`e2e/sharing.spec.ts` | 改 | 见各任务 |
| `docs/*`、`quality/tests.baseline.json` | 改 | Task 5 |

---

### Task 1: 同视界分差的纯函数

**Files:**
- Modify: `src/analysis/analyze.ts`
- Test: `src/analysis/analyze.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** 「走完某一手之后」的局面，由对手一方搜索得到的结论（分数是对手视角）。 */
  export interface AfterMove {
    readonly score: number
    readonly reason: SearchReason
  }
  /**
   * 同视界分差：实际着法之后的对手评分 − 引擎首选之后的对手评分，负数钳到 0。
   * 任一边不可比（见下）或缺失 → null。`'ended'` = 引擎首选当场成五。
   */
  export function horizonLoss(
    afterPlayed: AfterMove | null,
    afterEngine: AfterMove | 'ended' | null,
  ): number | null
  ```
- 可比性（D4）：`'ended'` 取 `-WIN_SCORE`；`reason` 为 `'search'` 或 `'win'` 取 `score`；其余（`block` / `timeout` / `opening` / `no_move`）与 `null` 都不可比。

- [ ] **Step 1: 写失败用例**（`analyze.test.ts` 新增 `describe('horizonLoss —— 同视界分差')`）

  ```ts
  const searched = (score: number): AfterMove => ({ score, reason: 'search' })

  it('两边都搜满：对手在实际着法之后更好受多少，就亏多少', () => {
    expect(horizonLoss(searched(800), searched(300))).toBe(500)
  })
  it('实际着法反而更好时钳到 0，不出现负亏损', () => {
    expect(horizonLoss(searched(300), searched(800))).toBe(0)
  })
  it('同一个局面比自己恒为 0——这条口径不靠「着法相同」特判也自洽', () => {
    expect(horizonLoss(searched(-14_200), searched(-14_200))).toBe(0)
  })
  it('引擎首选当场成五：对手已经输了，按 −WIN_SCORE 计', () => {
    expect(horizonLoss(searched(100), 'ended')).toBe(WIN_SCORE + 100)
  })
  it('实际着法之后对手有必胜（win）：与常规搜索同一量纲，可以相减', () => {
    expect(horizonLoss({ score: WIN_SCORE, reason: 'win' }, searched(0))).toBe(WIN_SCORE)
  })
  it.each(['block', 'timeout', 'opening', 'no_move'] as const)(
    '任一边是 %s：分数不在同一把尺子上，不算',
    (reason) => {
      expect(horizonLoss({ score: 5, reason }, searched(0))).toBeNull()
      expect(horizonLoss(searched(0), { score: 5, reason })).toBeNull()
    },
  )
  it('任一边缺失：不算', () => {
    expect(horizonLoss(null, searched(0))).toBeNull()
    expect(horizonLoss(searched(0), null)).toBeNull()
  })
  ```

- [ ] **Step 2: 跑一次确认红** — `yarn vitest run src/analysis/analyze.test.ts`，期望：`horizonLoss is not a function`（或导入失败）。
- [ ] **Step 3: 在 `analyze.ts` 实现 `AfterMove` 与 `horizonLoss`**，签名与可比性规则如上。函数注释写明「为什么不直接用 `engineScore − playedScore`」，并指向 `yarn bench:review-loss`。
- [ ] **Step 4: 确认绿** — 同上命令，新增 10 条全过；`yarn typecheck` 通过。
- [ ] **Step 5: 提交** — `feat(analysis): 同视界分差的纯函数 horizonLoss`

---

### Task 2: 分析管线改用同视界口径

**Files:**
- Modify: `src/analysis/analyze.ts`（`VerdictInput` / `MoveVerdict` / `buildVerdict` / `buildSummary` / `verdictLabel`；删 `pathSummary`）
- Modify: `src/store/analysisStore.ts`
- Modify: `src/features/review/ReviewScreen.tsx`（约 :346、:408–411、:455）
- Test: `src/analysis/analyze.test.ts`、`src/store/analysisStore.test.ts`、`src/features/review/review.test.tsx`、`e2e/review.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `AfterMove`、`horizonLoss`。
- Produces:
  ```ts
  export interface MoveVerdict {
    readonly moveIndex: number
    readonly move: Point
    readonly engineMove: Point
    /** 同视界分差，≥ 0；`null` = 两边的评分不可比，没有算。 */
    readonly loss: number | null
    readonly reason: SearchReason      // 引擎首选走的路径（不变）
    readonly engineDepth: number
    readonly engineNodes: number
    // confidence 字段删除（D5）
  }
  export interface VerdictInput {
    readonly moveIndex: number
    readonly played: Point
    readonly engineMove: Point
    readonly isWinningMove: boolean
    /** 着法相同或终局手时不需要，传 null。 */
    readonly afterPlayed: AfterMove | null
    readonly afterEngine: AfterMove | 'ended' | null
    readonly reason: SearchReason
    readonly engineDepth: number
    readonly engineNodes: number
  }
  ```
  `buildVerdict`：终局手或着法相同 → `loss: 0`；否则 `loss: horizonLoss(afterPlayed, afterEngine)`。
  `verdictLabel`：在现有分支之前加 `loss === null → '未算分差'`（「与引擎一致」的判断仍排最前）。
  `buildSummary`：只收 `loss !== null && loss > 0` 的手。

**`analysisStore` 的行为规格**（实现方式自定，下面每条都有用例）：

1. 队列元素从局面号变成任务：`{ kind: 'position' | 'alternative'; index: number }`；「在飞」也记任务对象。三重闸门照旧，第二道比的是任务对象。
2. 局面 *i* 的响应到达（`move` 非空）且第 *i* 手不是终局手、着法与引擎首选不同时，用 `applyMove(replay(moves.slice(0, i), firstPlayer), response.move)` 得到对照局面：
   - `ok === false` → 该手的对照记为 `null`（不可比），不发请求（D7）；
   - `state.status === 'won'` → 对照记为 `'ended'`，不发请求；
   - 否则把 `{ kind: 'alternative', index: i }` **插到队首**——结论按手序依次出来，进度不会最后才跳。
3. 对照请求：`board` 与 `player` 取对照局面的 `board` / `current`；`moveIndex: i`、`gameVersion: 0`、`purpose: 'analyze'`、档位与预算同局面请求。响应原样记成 `AfterMove`（`move === null` 时 `reason` 是 `no_move`，自然不可比，不特判）。
4. 出结论的条件：局面 *i* 已到，并且——终局手或着法相同（**不再等后续局面**）；或者后续局面（局面 *i+1*，作为 `afterPlayed`）与对照都已就位。
   **「对照」是四态，不许用同一个 `null` 表示两件事**：`undefined` = 还没判定或还没回来（继续等）；`null` = 已判定不可比；`'ended'`；`AfterMove`。
5. 既有行为不变：满盘末局面 `move === null` 时跳过上一手并把 `total` 减一；`stop()` / 再次 `start()` 使所有在飞响应作废；失败以错误收尾；缓存键与命中逻辑。
6. 删掉 `emit` 里「取两次搜索中较差的 confidence」那段及其注释；`ANALYSIS_BUDGET_MS` 的注释里「结论全落成 heuristic」改写成「后续局面没搜满的手不算分差」。
7. **每一条通过闸门的响应（局面与对照都算）处理完之后都要判一次收尾**（`finishIfDone`）。现有代码只在出结论和 `move === null` 时判，靠的是「最后一个响应必然出一条结论」这个隐含前提；规格 4 让着法相同的手提前出结论之后，这个前提不再成立。

- [ ] **Step 1: 写失败用例**（`analysisStore.test.ts`，新增 `describe('分析管线 —— 同视界分差')`；沿用文件里的 `fakeEngine` / `settle`，`settle` 的默认响应去掉 `confidence` 之外不变）

  | # | 用例名 | 关键断言 |
  | --- | --- | --- |
  | 1 | 着法与引擎首选不同：紧接着发对照请求，盘面是走完引擎首选之后、轮到对手 | 局面 0 回 `(7,7)`（实际是 `(3,7)`）后 `requests[1]`：`moveIndex === 0`、`player === WHITE`、盘面只有 `(7,7)` 一颗黑子；`requests` 长度 2；**对照还没回来时 `verdicts.has(0) === false`** |
  | 2 | 分差 = 实际着法之后的对手评分 − 引擎首选之后的对手评分 | 对照回 300、局面 1 回 800（着法同实际）→ `verdicts.get(0).loss === 500`；对调成 800 / 300 → `0` |
  | 3 | 着法相同：不发对照请求，局面响应一到就出结论 | 局面 0 回 `(3,7)` 后 `verdicts.get(0)?.loss === 0`，且 `requests[1].moveIndex === 1` |
  | 4 | 引擎首选当场成五：不发对照请求，按对手已输计 | 棋谱 = `NINE_WIN_MOVES` 前 8 手 + `(10,10)`；局面 8 回 `(7,7)` 后**下一个请求是局面 9**；局面 9 回 100 → `loss === WIN_SCORE + 100` |
  | 5 | 后续局面走的是必防捷径：不算分差 | 局面 1 回 `{ reason: 'block' }` → `verdicts.get(0)?.loss` 为 `null` |
  | 6 | 引擎首选落在已有棋子上：不发对照请求，分析照常跑完 | 每个局面都回 `(3,7)`：9 手局共 9 个请求、`running === false`、`verdicts.size === 9`、`verdicts.get(1)?.loss` 为 `null` |
  | 7 | 对照请求失败：以错误收尾 | `reject(1, '引擎挂了')` → `error === '引擎挂了'`、`running === false` |
  | 8 | 换局后，上一局对照请求的迟到响应不写进新一局 | A 局发出对照请求后 `start(B)`，再 settle A 的对照 → B 的 `verdicts.size === 0`，B 的第一个请求仍在飞 |
  | 9 | 缓存命中的结论里有 null 分差：照常填充 | 跑完用例 6 的局再 `start` 同一局 → 零新请求、`verdicts.get(1)?.loss` 为 `null` |
  | 10 | 9 手局、前 8 手都与引擎不同：请求数 = 9 个局面 + 8 个对照 | 每个局面回一个合法且不同的空点 → `requests` 长度 17 |
  | 11 | 最后一手没分出胜负、且与引擎首选相同：最后一个局面回来后照常收尾 | 棋谱 = `NINE_WIN_MOVES` 前 3 手（`winner: null`），4 个局面都回实际着法（局面 3 回任意合法点）→ `running === false`、`verdicts.size === 3` |

  同文件里**随行为改变而重写**的既有用例（不是删除，逐条说明去向）：
  - 「响应到达后发下一个请求——串行推进」：局面 1 回的 `(4,7)` 与实际不同，第三个请求现在是手 1 的对照（`moveIndex === 1`），断言随之改写。
  - 「终局手 loss 恒 0；中间手的 loss = engineScore − (−后续局面评分)」：公式换了，由用例 2 取代；「终局手恒 0」的断言保留在原处。
  - 「一手横跨两次搜索：任一半没搜完，这一手就标启发式」：`confidence` 字段已删，改成「后续局面超时 → `loss` 为 `null`」（`reason: 'timeout'`）。
  - 「engine.search reject → error 置位、running false、已完成 verdicts 保留」：局面 0 回的是实际着法，新规格下手 0 当场出结论，断言由 `verdicts.size === 0` 改成 `=== 1`——这才对得上标题里的「已完成 verdicts 保留」；「没有任何一手拼出完整结论」那句注释删掉。

  `analyze.test.ts`：`buildVerdict` 一组按新入参重写（终局手 0、着法相同 0、两边可比取 `horizonLoss`、不可比 `null`、原样带出 `reason` / 深度 / 节点）；`verdictLabel` 加「`loss: null` → `'未算分差'`，且着法相同时仍说『与引擎一致』」；`buildSummary` 加「`null` 不进榜」；删 `pathSummary` 那一条。

  `review.test.tsx`：
  - 说明文字用例（约 :262）：保留 `'不是精确子数'`，另一条改成 `toHaveTextContent('不算分差')`。
  - 「当前手是启发式的就标出来」（约 :394）改成「后续局面没搜满的手，当前手一行说『未算分差』，榜单里没有这一手」；脚本引擎的 `heuristicAt` 改成 `timeoutAt`，对**局面 2**（手 1 的后续局面）回 `reason: 'timeout'`。
  - 文件里三个脚本引擎按 `request.moveIndex` 应答，分不清局面请求与对照请求。加一个文件内小工具 `isAlternative(request)`（盘上棋子数 === `moveIndex + 1`）。`scriptedEngine` 的对照分数**必须按这张表给**，否则「榜单只有 `verdict-1`」与「不足 1 子」两条既有断言保不住：`moveIndex 1` 的对照回 `−500`（手 1 的分差 = 0 − (−500) = 500），其余对照回 `0`。
  - 新增「分析跑完、榜单为空：说一句没有算出亏损的手」（D9）：每个局面都回实际着法 → 出现 `data-testid="analysis-empty"`，文字「这一局没有算出亏损的手。」；分析进行中与有卡片时都不出现。

  `e2e/review.spec.ts`：「分析：逐手跑完并给出结论」与「点分析结论里的关键手」两条都要求分析完至少有一张卡片，而它们下的那局九手棋在新口径下**一张都没有**（预演结果见 D9）。新增一个只给这两条用的对局 `playMissedBlockGame`（`playNineMoveWin` 不动，别的用例还在用）：
  `[3,7] [2,7] [4,7] [3,9] [5,7] [4,9] [6,7] [5,9] [7,7]`——同为 9 手、黑胜；黑棋第 7 手冲四（左端已被白棋堵住），白棋第 8 手没有防。预演：只有第 8 手进榜，分差 1,012,000（「分差极大」），引擎推荐 H8。两条用例原有断言不变，第一条另加 `toContainText('第 8 手')`。

- [ ] **Step 2: 确认红** — `yarn vitest run src/store/analysisStore.test.ts src/analysis/analyze.test.ts src/features/review/review.test.tsx`；`yarn typecheck` 此时也红（`VerdictInput` 变了）。
- [ ] **Step 3: 改 `analyze.ts`**（接口如上；删 `pathSummary` 与它对 `Confidence` 的 import）。
- [ ] **Step 4: 改 `analysisStore.ts`**（行为规格 1–6）。
- [ ] **Step 5: 改 `ReviewScreen.tsx`**
  - 当前手一行：去掉「（启发式）」后缀，只留 `verdictLabel(currentVerdict)`。
  - 分析已跑完、`topLosses` 为空时显示空榜说明（D9）。
  - 卡片第三行：`pathSummary(...)` 暂改成 `pathLabel(searchPathOf(verdict.reason))`（Task 3 再换）。
  - 说明文字改成：`分差按棋型评分粗算，不是精确子数；两种走法之后的评分没法用同一把尺子比时，不算分差。`
- [ ] **Step 6: 确认绿** — Step 2 的命令全过；`yarn typecheck && yarn lint` 通过；**`yarn e2e e2e/review.spec.ts` 现在就跑**（真实引擎下榜单有没有卡片，单测替不了）。
- [ ] **Step 7: 反向验证**（两处，各自恢复）
  - 旧口径：在 store 里临时把 `afterEngine` 换成 `{ score: -pos.score, reason: pos.reason }`（等价于旧公式 `score(i) − (−score(i+1))`；新的 `VerdictInput` 里已经没有局面 *i* 的分数，在 `buildVerdict` 里写不出旧公式），确认用例 2 变红。
  - 收尾：去掉规格 7 加的那次判定，确认用例 11 停在 `running === true`。
- [ ] **Step 8: 提交** — `fix(review): 复盘分差改为同视界比较，不可比时不算`

---

### Task 3: 可靠度四类

**Files:**
- Modify: `src/ai/types.ts`、`src/ai/search.ts`（`chooseMove` 一行；`leadWithChosenMove` 上方注释里的「精确 / 启发式」）
- Create: `src/lib/confidence-labels.ts`、`src/lib/confidence-labels.test.ts`
- Modify: `src/components/panels/AiPanel.tsx`、`HintPanel.tsx`、`src/features/positions/PositionEditor.tsx`、`src/features/review/ReviewScreen.tsx`、`src/analysis/analyze.ts`（删 `pathLabel`）；`src/store/gameStore.ts` 只改 `hintConfidence` 字段上方的注释
- Test: `src/ai/types.test.ts`、`src/ai/search.test.ts`、`AiPanel.test.tsx`、`HintPanel.test.tsx`、`src/store/gameStore.test.ts`、`PositionEditor.test.tsx`、`review.test.tsx`、`analyze.test.ts`
- 按 `reason` 机械替换其余 `confidence` 取值（`search` → `'complete'`；`win` / `block` / `opening` → `'shortcut'`；`timeout` 看深度）：`engine.test.ts`、`editorStore.test.ts`、`analysisStore.test.ts`、`e2e/sharing.spec.ts` 的夹具都是 `reason: 'search'`；`difficulty.test.ts` 那条断言的是中级档算杀（`reason: 'win'`），换成 `'shortcut'`

**Interfaces:**
- Produces（`src/ai/types.ts`）：
  ```ts
  /**
   * 这一手是怎么得出来的，也就是它有多可靠。由 reason 与 depth 唯一决定。
   * - shortcut：没有展开常规搜索，由规则或快速路径直接确定（成五 / 算杀 / 必防 / 开局天元 / 无棋可走）
   * - complete：搜满了这一档的深度
   * - partial ：时间到了，用的是已经完整搜完的第 depth 层（depth ≥ 1）
   * - fallback：一层都没搜完，只有一步贪心的估计
   */
  export type Confidence = 'shortcut' | 'complete' | 'partial' | 'fallback'
  export function confidenceOf(reason: SearchReason, depth: number): Confidence
  ```
  映射：`win` / `block` / `opening` / `no_move` → `shortcut`；`search` / `timeout` 且 `depth === 0` → `fallback`；`search` → `complete`；`timeout` → `partial`。用穷举 `switch`，新增 `reason` 时编译失败。
- Produces（`src/lib/confidence-labels.ts`）：
  ```ts
  export const CONFIDENCE_LABELS: Record<Confidence, string>
  export const FALLBACK_WARNING = '一层都没搜完，这一手只是一步贪心的估计，不保证最优。'
  ```
  | 取值 | `CONFIDENCE_LABELS` |
  | --- | --- |
  | `shortcut` | `规则/快速路径判定` |
  | `complete` | `搜满档位深度` |
  | `partial` | `限时内未搜满，取已搜完的层` |
  | `fallback` | `一步贪心兜底` |

  文案不带层数（D8）。
- `SearchResponse.confidence` **保留在协议里**，类型随 `Confidence` 变，由 `chooseMove` 用 `confidenceOf(outcome.reason, outcome.depth)` 填。store 照旧原样抄它（`gameStore` 的两处赋值一行不改）；只有复盘卡片（手里是 `reason` + `engineDepth`）现推。

**界面文案（逐字）：**

| 位置 | 现在 | 改成 |
| --- | --- | --- |
| `AiPanel` 玩家视图，`search` | AI 完整搜索后选了这一手。 | AI 按这一档的深度搜完，选了这一手。 |
| `AiPanel` 玩家视图，`timeout` 且 `partial` | 时间到了还没搜完，这一手是启发式兜底。 | 时间到了，AI 用的是已经搜完的那一层的结果。 |
| `AiPanel` 玩家视图，`timeout` 且 `fallback` | （同上） | 时间到了，AI 一层都没搜完，这一手只是粗略估计。 |
| `AiPanel` 警示条 | `heuristic` 时出现 | **只在 `fallback` 时出现**，文案用 `FALLBACK_WARNING` |
| `AiPanel` 技术详情「结论」 | 精确 / 启发式 | `CONFIDENCE_LABELS[info.confidence]` |
| `HintPanel` 结论行（默认层） | 结论：精确 ／ 结论：启发式，不保证最优 | `结论：${CONFIDENCE_LABELS[confidence]}`；`fallback` 时后缀 `，不保证最优` 并用警示色，其余用中性色 |
| `PositionEditor` 结论 | 结论 精确 / 启发式 | `结论 ${CONFIDENCE_LABELS[...]}`；警示语只在 `fallback` 时出现，用 `FALLBACK_WARNING` |
| `ReviewScreen` 卡片第三行 | `pathLabel(searchPathOf(reason))` | `CONFIDENCE_LABELS[confidenceOf(v.reason, v.engineDepth)]` |

默认层不出现层数（`AiPanel` 的既有断言「指标全都进了展开层」，`HintPanel` 同一条规矩）：玩家视图的句子与提示面板的结论行都不写「第 N 层」；层数由展开层的「搜索深度」一栏说。`REASON_TEXT` 的 `label`（「超时回退」等）不动。`AiPanel` 里引 `search.ts:564` / `:463` / `:481` 的行号注释改成按符号名引用（`chooseMove`、`runSearch` 的直接成五分支、`findForcedWin`）。

- [ ] **Step 1: 写失败用例**

  `types.test.ts`（取代 `searchPathOf` 那一组，条数不减）：
  ```ts
  it.each([
    ['win', 0, 'shortcut'], ['block', 0, 'shortcut'], ['opening', 0, 'shortcut'], ['no_move', 0, 'shortcut'],
    ['search', 1, 'complete'], ['search', 8, 'complete'],
    ['timeout', 6, 'partial'], ['timeout', 1, 'partial'],
    ['timeout', 0, 'fallback'], ['search', 0, 'fallback'],
  ] as const)('%s 深度 %i → %s', (reason, depth, expected) => {
    expect(confidenceOf(reason, depth)).toBe(expected)
  })
  it('算杀找到的必胜（节点数不为 0）仍是 shortcut——分类不看 nodes', () => {
    expect(confidenceOf('win', 0)).toBe('shortcut')
  })
  ```

  `search.test.ts`：
  - 极小预算那条：`expect(result.confidence).toBe(result.depth === 0 ? 'fallback' : 'partial')`，并保留 `reason === 'timeout'`。
  - 「预算充足时给出精确结论」改名「预算充足时搜满这一档的深度」：`confidence === 'complete'` 且 `depth === DIFFICULTY_PARAMS[档位].depth`。
  - 新增「捷径不冒充搜索」：直接成五、必防、空盘三个局面各断言 `confidence === 'shortcut'`。
  - 「analyze 请求原样带回 moveIndex」那条（初级档、预算 5 s）：`'exact'` 换成 `'complete'`；上方注释里的 `'heuristic'` / `'exact'` 字样同步改掉。

  `confidence-labels.test.ts`：四个取值各一条，逐字断言上表；外加「四条文案里都没有数字」（钉住 D8）。

  `AiPanel.test.tsx`：
  - 文案表里 `timeout` 一行拆成两行（`depth: 6` → partial 那句；`depth: 0` → fallback 那句），`search` 一行换新句子。
  - **「专家档超时但搜到第 6 层：默认层没有警示条」**：`{ reason: 'timeout', depth: 6, confidence: 'partial' }` → 查不到 `FALLBACK_WARNING`，展开后「结论」是「限时内未搜满，取已搜完的层」、「搜索深度」是「6 层」。
  - **「一层都没搜完：警示条恒在默认层」**：`{ reason: 'timeout', depth: 0, confidence: 'fallback' }` → 有 `FALLBACK_WARNING`，不展开也在。
  - 「入门档搜满 1 层」→「结论」是「搜满档位深度」，全页没有「精确」二字。

  `HintPanel.test.tsx`：18 处夹具换值；三条文案用例改成 complete（中性色、`搜满档位深度`）、partial（中性色、`限时内未搜满`）、fallback（警示色、含「不保证最优」）；另加「结论行里没有数字」。

  `gameStore.test.ts`：「记下提示的可靠度」改成 `replyHint({ confidence: 'partial', reason: 'timeout', depth: 6 })` → `hintConfidence === 'partial'`；用例名里的「标成启发式」改成「原样记下引擎给的那一类」。

  `PositionEditor.test.tsx`：`'精确'` 改成 `'搜满档位深度'`（夹具 `confidence: 'complete'`）；新增一条 fallback 时出现 `FALLBACK_WARNING`。

  `review.test.tsx`：「规则 / 快速路径判定不说成『搜索完成』」保留，断言文字不变（`规则/快速路径判定`、不含「搜索完成」）；补一条常规搜索的卡片写「搜满档位深度」。

  `analyze.test.ts`：删 `pathLabel` 的两条（由 `confidence-labels.test.ts` 的四条取代）。

- [ ] **Step 2: 确认红** — `yarn vitest run src/ai src/lib/confidence-labels.test.ts src/components/panels src/store/gameStore.test.ts src/features/positions src/features/review`。
- [ ] **Step 3: 改 `ai/types.ts` 与 `ai/search.ts`**（接口如上；`types.ts` 里 `SearchReason` 的 `timeout` 注释改成「时间预算内没搜满；`depth ≥ 1` 时返回的是已完整搜完的那一层，`depth === 0` 时才是贪心兜底」）。
- [ ] **Step 4: 新建 `lib/confidence-labels.ts`。**
- [ ] **Step 5: 改四个界面消费方**（按文案表；`analyze.ts` 删 `pathLabel` 与对 `SearchPath` 的 import）。
- [ ] **Step 6: 把其余测试与 `e2e/sharing.spec.ts` 里的夹具取值换掉**，`yarn typecheck` 通过即说明没有漏网的 `'exact'` / `'heuristic'`。再跑 `grep -rn "'exact'\|'heuristic'\|searchPathOf\|pathLabel\|pathSummary\|SearchPath" src e2e bench --include='*.ts' --include='*.tsx'`，期望只剩 `bench/strength/.engines/` 下的历史打包产物（不入库）。
- [ ] **Step 7: 确认绿** — Step 2 的命令全过；`yarn lint && yarn typecheck && yarn test` 全过。
- [ ] **Step 8: 反向验证** — 把 `confidenceOf` 里 `timeout` 一支临时改成恒返回 `fallback`，确认 `types.test.ts` 的 partial 两行变红；再把 `AiPanel` 警示条的条件临时改成「`fallback` 或 `partial`」，确认「搜到第 6 层没有警示条」变红。各自恢复。
- [ ] **Step 9: 提交** — `fix(ai): 可靠度按事实分四类，超时但搜完若干层不再说成兜底`

---

### Task 4: 测量脚本跟上新口径，取基线

**Files:**
- Modify: `bench/review-loss.measure.ts`

第一项（引擎走自己首选时 `score(i) − (−score(i+1))` 的偏差）**原样保留**：它量的是引擎的性质，是「为什么生产代码不用那个公式」的证据，不随修复变化。

- [ ] **Step 1: 改第二项**：样本不再限于「各次搜索都是 `search`」，改成所有「着法与引擎首选不同、且不是终局手」的手；每手用生产的 `buildVerdict` 得到 `loss`（引擎首选当场成五时传 `'ended'`）。输出：样本数、有亏损、其中 ≥ 5,000、零亏损、未算分差、以及未算分差按「哪一边是什么 `reason`」的分布；旧口径（`max(0, score(i) − (−score(i+1)))`）的零亏损数保留一行作对照。
- [ ] **Step 2: 加第三项**：入门档自对弈、由初级档复盘（与本计划「已知代价」表的第二行同一设置），输出同一组计数。
- [ ] **Step 3: 跑** — `yarn bench:review-loss`。期望与「已知代价」表一致：随机着法 205 手里有亏损 152（≥ 5,000 的 109）、零 16、未算 37；入门档自对弈 26 手里 6 / 12 / 8。**不一致就停下来查**，不改数字去凑。
- [ ] **Step 4: `yarn typecheck && yarn lint`**，提交 — `chore(bench): review-loss 改走生产口径，记录未算分差的占比`

---

### Task 5: 文档、棘轮基线、全量验证、真实浏览器复核

**Files:**
- Modify: `docs/AI_ENGINE.md`、`docs/ARCHITECTURE.md`、`docs/USAGE.md`、`README.md`、`docs/ui-redesign/DESIGN_SYSTEM.md`、`docs/TEST_REPORT.md`、`docs/ROADMAP.md`、`quality/tests.baseline.json`

- [ ] **Step 1: `AI_ENGINE.md`**
  - 接口一节（约 :33–35）：`confidence` 的说明改成四类及其推导表；「『精确 / 启发式』说的是第一个候选」改成「可靠度说的是第一个候选」。
  - 量纲表 `timeout` 一行：「上一层迭代的兜底值」改成「`depth ≥ 1` 时是已完整搜完的那一层的 negamax 值，`depth === 0` 时是一步贪心的分；复盘不拿它算分差（两边可能停在不同层）」。
  - 新增一小节「复盘分差的口径」：公式、可比性规则、为什么不用 `score(i) − (−score(i+1))`（引 `yarn bench:review-loss` 第一项：135 手里 134 手为负、中位 14,200），以及 Task 4 取得的「未算分差」占比。
  - 约 :276 与 :389 的「8 层从未达到」：改成只对中盘宽局面成立，并写明反例（同文档「实测」第 5 点、`PHASE_10D.md` 的「8 层 71 次」、`yarn bench:queue --raw` 在盘上 3–5 子时量到的 `search` 深度 8）。
- [ ] **Step 2: `ARCHITECTURE.md`**：约 :58（`MoveVerdict` 的描述去掉「可靠度」与 `SearchPath`）、约 :143–147 的数据流（「每手 1 个请求，相邻手共享后续局面；着法与引擎首选不同的手另发 1 个对照请求」「`buildVerdict`（同视界分差，不可比时为空）」）、约 :187（第二道闸门的名字）。
- [ ] **Step 3: `USAGE.md`**：约 :95–96、:103、:113–115（四类的玩家说法）、:99（8 层那句，同上）、:235–236（结论的说法加「未算分差」并解释什么时候会出现）、:283、:314、:319–320（「提示说『启发式』是不是不靠谱」整条改写成四类各是什么意思）。`README.md` 约 :84 同步，:183 的「8 层从未达到」一并改。`DESIGN_SYSTEM.md` 约 :70 的 `warn` 用途「启发式结论」改成「贪心兜底的结论」。
- [ ] **Step 4: 全量验证**
  ```bash
  yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e
  yarn gates
  yarn e2e:prod
  ```
  期望全绿；`check:bundle` 的实数记下来（基线 130,417 B，上限 135,000 B）。**超限时不动上限**：先看 `confidence-labels` 与管线新增的体积能否由删掉的 `pathLabel` / `pathSummary` / `SearchPath` 抵掉，抵不掉就停下来报告。
- [ ] **Step 5: 棘轮基线只上调**：`quality/tests.baseline.json` 的 `unitTotal` 改成 `yarn test` 的实际条数（预期净增约 25），`note` 追加一句本阶段增删了什么（被删的 `searchPathOf` 5 条、`pathLabel` 2 条、`pathSummary` 1 条分别由哪些新用例取代）。
- [ ] **Step 6: 真实浏览器复核**（`yarn build && yarn preview --port 5192 --strictPort`，Chrome）
  1. 专家档连下三手：默认层不再出现「启发式兜底」与警示条；展开技术详情，「结论」是「限时内未搜满，取已搜完的层」或「搜满档位深度」，后者出现时「搜索深度」必须是 8 层。
  2. 入门档下一手：「结论」是「搜满档位深度」，「搜索深度」1 层。
  3. 求提示：结论行不再有「精确」。
  4. 局面编辑器分析一次：结论一栏同上。
  5. 下一局带明显坏手的棋（至少一手漏防活三），到复盘页分析：坏手进了亏损榜且不再是「与引擎首选相当」；某一手做出冲四时显示「未算分差」；点榜单能跳到对应手。
  6. 同一局再点一次分析：零等待（缓存命中），结论不变。
  7. 分析进行中切到另一局：新一局从 0 开始，没有上一局的结论混进来。
- [ ] **Step 7: `TEST_REPORT.md` 与 `ROADMAP.md`**：记下本阶段新增 / 重写的用例、Step 4 的实跑结果、Step 6 的逐项结论、Task 4 的基线数字与测量条件；`ROADMAP.md` 加一条阶段记录并指向本计划与评估报告。
- [ ] **Step 8: 提交** — `docs: 阶段 A 收尾——可靠度四类与同视界分差的文档、基线与复核记录`

---

## 验收标准（对应报告 §10 阶段 A，按 §14 的裁定调整）

1. `horizonLoss(x, x) === 0` 对任意可比的 `x` 成立，且不经过「着法相同」特判（Task 1 用例 3）。
2. 随机着法的亏损检出有可复跑的基线：`yarn bench:review-loss` 输出有亏损 / 零亏损 / 未算分差三个数，写进 `AI_ENGINE.md`（Task 4、Task 5）。
3. 专家档连下三手不再出现「启发式兜底」；只有 `depth === 0` 的超时才有警示条（Task 3 用例 + Task 5 复核 1）。
4. 全仓不再有 `'exact'` / `'heuristic'` / `SearchPath`（Task 3 Step 6 的 grep）。
5. 五条命令、`yarn gates`、`yarn e2e:prod` 全绿；入口包不超 135,000 B；单测条数高于 1475。
6. `ENGINE_VERSION` 未变，`bench/baseline.json` 未动。

## 风险

| 风险 | 对策 |
| --- | --- |
| 「未算分差」的占比在真实对局里比样本更高，用户觉得复盘「说得更少了」 | 这是如实的代价，已量化并写进文档；后续可沿必防手再搜一层把它补上。复核 5 专门看一局真实对局里它出现的频率——若多数坏手都落进「未算」，停下来报告而不是硬上线 |
| 对照请求让分析变慢 | 请求数最多增加「着法不同的手数」；初级档单次搜索实测不到 10 ms（`bench:review-loss` 约 900 次搜索共 3–6 s）。复核 5 记下 40 手以上棋谱的分析总时长 |
| 夹具替换面广（12 个测试文件约 50 处），容易把 `reason` 与 `confidence` 配错 | `tsc` 会拦住所有旧取值；新取值按 `reason` 机械替换（见 Task 3 的 Files），另有 `search.test.ts` 与 `difficulty.test.ts` 用真实引擎钉住两者的对应 |
| e2e 依赖榜单里有卡片 | 已预演：原来那局九手棋在新口径下没有卡片，两条用例改用 `playMissedBlockGame`；Task 2 Step 6 就跑 `e2e/review.spec.ts`，不等到收尾 |
| 文案改动碰到覆盖棘轮 | 没有增删控件（D9 加的是一段文字）；e2e 里没有断言这些文案（已 grep）。仍以 Task 5 Step 4 的实跑为准 |
| 入口包撞线（余量 4,583 B） | 净增预计很小（新增一个小文件与一段队列逻辑，同时删掉三个函数）；Step 4 量实数，超了不调上限 |

---

## 自审记录

### 第 1 轮 · 规格覆盖（对照报告 §4.1、§4.2、§10、§14）

| # | 发现 | 处理 |
| --- | --- | --- |
| 1 | 报告 §4.1 要求「缓存键 `v2` 递增」。核对代码：缓存是 store 闭包里的 `Map`，不落盘 | 不递增，记为 D6，并在此更正报告 |
| 2 | 报告 §4.2 的四类写的是「已证明（成五 / 必防 / 算杀）」，没说 `opening` 与 `no_move` 归哪。分类函数必须对六种 `reason` 全覆盖 | `opening` 不是证明 → 第一类沿用已上线的「规则/快速路径判定」（D1）；`no_move` 归同一类，函数不返回 `null`（D3） |
| 3 | 报告说新分类「放在 `searchPathOf` 旁边」。核对后发现新四类就是 `SearchPath` 把 `aborted` 拆开——并存会是两套穷举映射 | 删旧并新（D2） |
| 4 | 报告 §4.1 说「两边之一是捷径分时不相减」，没说 `timeout`。两边超时可能停在不同层，奇偶层偏差会回来 | `timeout` 一并算不可比（D4） |
| 5 | 报告 §10 的验收 ②「检出率有基线」没有对应任务 | 加 Task 4 |
| 6 | §14 说阶段 A 含「5.7 里直接相关的漂移」，初稿没列 | `AiPanel` 的三处行号引用进 Task 3；「8 层从未达到」进 Task 5 Step 1 / 3。`gameStore`、`GameLibrary` 里另两处指错的行号与本阶段无关，留给阶段 E |

### 第 2 轮 · 对照代码逐条核实

| # | 发现 | 处理 |
| --- | --- | --- |
| 7 | 初稿把 `confidence` 从 `SearchResponse` 里删掉、让界面各自现推。核对消费方：`gameStore` 两处、`editorStore`、`PositionEditor` 都是原样抄 `response.confidence`；删字段要多改 4 个生产文件，换来的只是夹具里少一个可能配错的值 | 字段保留，`chooseMove` 用 `confidenceOf` 填；只有复盘卡片现推 |
| 8 | 文案要写「第 N 层」，但 `HintPanel` 手里没有深度 | ~~`gameStore` 加 `hintDepth`，`HintPanel` 加 `depth` 属性~~ **被终审推翻**：与第 9 条矛盾，见终审 3 |
| 9 | `AiPanel` 默认层按 `DESIGN_SYSTEM.md` §7 不许出现搜索指标 | `timeout` 的玩家句子不写层数，层数只进展开层的「结论」 |
| 10 | 初稿让引擎首选非法时以错误收尾。核对既有测试：`analysisStore.test.ts` 多数用例对每个局面都回 `(3,7)`（局面 1 起就是已有棋子），那样会全部走进错误路径 | 改成「不发对照请求、`loss` 为 `null`」（D7）；既有的排队 / 取消 / 缓存用例因此不用动，另加用例 6 钉住 |
| 11 | `review.test.tsx` 的三个脚本引擎按 `request.moveIndex` 应答，对照请求与局面请求的 `moveIndex` 相同，分不开 | 测试里按盘上棋子数区分（`isAlternative`），不为测试给协议加字段 |
| 12 | 初稿让「着法相同」的手仍等后续局面。新口径下它不需要任何后续评分 | 局面响应一到就出结论（规格 4、用例 3）；满盘末局面「跳过上一手」的既有逻辑对已出结论的手是空操作，行为不变 |
| 13 | `tsconfig.app.json` 的 `include` 是整个 `src`，测试也在类型检查里 | `Confidence` 一改，所有旧取值的夹具都会在 `tsc` 报错——Task 3 必须在同一个任务里把它们换完，不能拆到后面 |
| 14 | `verdictLabel` 里「与引擎一致」的判断在最前。`loss === null` 的分支若放在它之前，着法相同却会说「未算分差」 | 明确顺序，并加一条用例 |

### 第 3 轮 · 步骤可执行性、类型一致性、比例

| # | 发现 | 处理 |
| --- | --- | --- |
| 15 | Task 2 删了 `pathSummary`，但 `ReviewScreen` 卡片第三行还在用它；Task 3 才有 `CONFIDENCE_LABELS` | Task 2 Step 5 先换成 `pathLabel(searchPathOf(...))`，Task 3 再换，两个任务各自能绿 |
| 16 | Task 1 导出的 `horizonLoss` 在 Task 2 之前只有测试在用，会不会被 `check:deadcode` 判成多余导出 | knip 把测试文件当入口，测试用到即算使用；且 Task 2 的 `buildVerdict` 在同文件内调用它。`yarn gates` 放在 Task 5 整体跑 |
| 17 | 用例 4 需要「引擎能当场成五而玩家没走」的局面，初稿没给造法 | 写明：`NINE_WIN_MOVES` 前 8 手（黑已有四连）+ `(10,10)` |
| 18 | 用例 1 的断言「盘面只有 `(7,7)` 一颗黑子、轮到白」依赖先手是黑。`threeWinRecord` 的 `firstPlayer` 是 `BLACK`，成立 | 断言里直接写 `WHITE`，不另造白先棋谱（先后手换算由 `replay` 负责，已有测试） |
| 19 | 「已知代价」表的数字出自临时脚本，脚本已删。按项目约定，写进文档的数字要能复跑 | Task 4 把同一设置做进 `bench:review-loss`，Step 3 要求数字对得上，对不上就停 |
| 20 | 棘轮：删掉 8 条旧用例（`searchPathOf` 5、`pathLabel` 2、`pathSummary` 1）。新增是否够 | Task 1 +10、Task 2 +12 以上、Task 3 的 `confidenceOf` 表 +11、`confidence-labels` +5、各面板约 +6——净增 25 条以上；Task 5 Step 5 以实跑为准并写明替换关系 |
| 21 | 比例：计划约为所涉生产改动的 2–3 倍长，但代码块只有接口与用例断言，没有函数体 | 保持；文案表与用例表是执行者无法自行决定的部分 |

### 独立终审（另一个代理，只读，对照源码逐条推演）

九条意见，逐条回到源码或用临时脚本核实后**全部采纳**；其中第 7 条核实下来比终审估计的更严重。

| # | 类别 | 终审发现 | 核实 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | 会破坏 | 「着法相同不再等后续局面」之后，最后一手没分出胜负且与引擎相同时，最后一个局面的响应不触发收尾，面板永远停在「分析中」 | 属实：`finishIfDone` 只在 `emit` 与 `move === null` 两处被调用 | 加行为规格 7、用例 11、Review Focus 6 |
| 2 | 会破坏 | 既有用例「engine.search reject → …已完成 verdicts 保留」会变红，重写清单里漏了 | 属实：它对局面 0 回的是实际着法 | 列入重写清单，断言改成 `size === 1` |
| 3 | 约定 | 提示面板的结论行在默认层，写「搜满 4 层」与计划自己说的「默认层不出现层数」矛盾 | 属实：`hint-confidence` 只受 `showConfidence` 控制 | 文案改成不带层数的一套（D8），撤掉 `hintDepth` 与 `depth` 属性——改动面反而更小 |
| 4 | 边界 | 「对照已判定为不可比」与「对照还没回来」容易被同一个 `null` 表示 | 属实：规格没写死 | 规格 4 写明四态；用例 1 加「对照未回时没有结论」 |
| 5 | 边界 | Task 2 的反向验证做不了：新接口里没有局面 *i* 的分数 | 属实 | 改在 store 层做，并加一处对规格 7 的反向验证 |
| 6 | 边界 | `scriptedEngine` 的对照分数给错符号，榜单会变成 0 条或 2 条 | 属实：手 1 的分差 = 0 − X | 写明分数表（手 1 的对照 −500，其余 0） |
| 7 | 边界（存疑） | e2e 两条用例要求分析完至少有一张卡片；终审按局面推断「第 6 手很可能为正」，但没实跑 | **推断不成立**：用临时脚本按新口径预演那局九手棋，9 手里 8 手分差为 0、1 手未算，**一张卡片都没有**；旧口径给出的两张卡片都是量纲假象 | 换一局「漏防冲四」的棋（预演：只有第 8 手进榜，分差 1,012,000）；Task 2 Step 6 就跑 e2e；由此加 D9 |
| 8 | 约定 | `README.md:183` 也有「8 层从未达到」 | 属实 | 进 Task 5 Step 3 |
| 9 | 小 | Task 1 是 10 条用例不是 11 条 | 属实 | 改正 |

终审另外核实并确认没有问题的：`horizonLoss` 的方向与视角；`reason: 'search'` 确实保证两边同深度（只有跑满 `maxDepth` 才给）；`confidenceOf` 覆盖 `runSearch` 的全部返回分支；`confidence` 的消费方清单完整；Task 2 → Task 3 的过渡每一步都能过类型检查；用例 1–4、6、8–10 的请求顺序与数字；「着法相同不等后续局面」与「满盘末局面跳过上一手」不冲突；D6、D7 成立。

终审没有核实、留给执行时实跑的：Task 4 的基线数字、入口包体积、`jscpd` 对新文案代码的判定。
