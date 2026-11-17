# 阶段 A+ · 复盘分差：沿必防手续搜 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**状态：已获授权执行**（`REFACTORING_ASSESSMENT.md` §14.1 裁定 9：现在就做，先于阶段 B）。

**Goal:** 复盘分差遇到必防捷径（`block`）时不再直接放弃：沿着那一手必防再搜一层，把「未算分差」里能算的算出来——首先是「有现成的五连没走」。

**Architecture:** 只动复盘分析这一条线：`analysis/analyze.ts`（纯函数：两级评估怎么比）与 `store/analysisStore.ts`（多一种「续搜」请求）。不碰搜索引擎、协议、界面文案。

**Tech Stack:** TypeScript 6、Zustand 5、Vitest 5；yarn。

**Spec:** `docs/research/REFACTORING_ASSESSMENT.md` §4.1、§14.1；`docs/AI_ENGINE.md`「复盘分差的口径」里记的两条缺口；`docs/research/PHASE_A_PLAN.md`（本计划是它的补丁，沿用其 Global Constraints）。

## Global Constraints

- 沿用 `PHASE_A_PLAN.md` 的全部约束：不改搜索决策、`ENGINE_VERSION` 不变、`bench/baseline.json` 不动、先写失败测试、反向验证、不删有效断言、单测只许涨（基线 1519）、入口包 ≤ 135,000 B（现 130,662 B）不许调松、五条命令 + `yarn gates` + `yarn e2e:prod`、文档同步。
- **协议不变**：不给 `SearchRequest` 加字段（不加「指定深度」之类）。续搜就是一个普通的 `purpose: 'analyze'` 请求。
- 三重闸门语义不变；续搜请求与对照请求走同一条路。

## 口径（先把要算什么说清楚）

一手棋有两条「走法」要比：实际着法、引擎首选。每条走法最多有两级评估：

| 级 | 局面 | 谁走 | 记法 |
| --- | --- | --- | --- |
| 一级 | 走完这一手之后 | 对手 | `after`（已有：实际着法一边是局面 *i*+1，引擎首选一边是对照请求） |
| 二级 | 再走完对手那一手应着之后 | 自己 | `follow`（**新增**：续搜请求） |

把每条走法折成「**走这一手的一方**视角」的一个值，并标明它是不是已证明的：

| 来源 | 值 | 已证明 |
| --- | --- | --- |
| 一级：这一手当场成五（`'ended'`） | `+WIN_SCORE` | 是 |
| 一级：对手 `win`（对手成五 / 算杀） | `−score` | 是 |
| 一级：对手 `search` | `−score` | 否（视界一） |
| 二级：自己 `win` | `+score` | 是 |
| 二级：自己 `search` | `+score` | 否（视界二） |
| 其余（`block` / `timeout` / `opening` / `no_move` / 缺失） | 无 | — |

**分差 = max(0, 引擎首选的值 − 实际着法的值)**，当且仅当两个值「可比」：

1. 两边都有一级值 → 用一级值（与阶段 A 已上线的结论逐字相同）。
2. 否则，每一边取「一级的已证明值，没有就取二级值」；两边都取到 → 用它们。
3. 否则不算（`null`）。

要点：**已证明的值跨级可比**（成五就是成五，不随搜索视界变）；**搜索值只在同一级内可比**（阶段 A 修掉的奇偶层偏差就是跨级相减造成的）。所以一边需要二级时，另一边若是常规搜索也要跟着续搜一层。

## 设计决定

| # | 决定 | 理由 |
| --- | --- | --- |
| P1 | **只续搜一层。** 二级结论仍是 `block`（对手那一手应着又逼出一个必防）就不算。 | 每多一层都要两边同步多一层，请求数翻倍；原型实测一层已把未算从 18% / 31% 降到 5% / 12%（见下）。 |
| P2 | 一边要二级时，另一边的常规搜索也续搜一层（跟着对手的最佳应着走）。 | 同视界才可比。 |
| P3 | 续搜是**专用请求**，不复用相邻手的请求。 | 实际着法一边的二级局面有时恰好等于下一手的对照局面，可以共享；但共享要处理「下一手着法相同时没有对照」等三四种分支。初级档一次搜索几毫秒，不值得。 |
| P4 | 一级可比时**仍用一级**，不为了统一而全部重算。 | 不动阶段 A 已上线、已复核的结论；请求数也最少。 |
| P5 | 应着落不下去、或应着之后棋局结束：那一边记为无值（真实引擎不可达）。 | 与阶段 A 的 D7 同一原则：没法比就如实说没法比，不另开错误路径。 |

**已知代价（原型实测，2026-11-17，初级档、预算给足、确定性）：**

| 样本 | 着法不同的手 | 阶段 A（未算） | 续搜后：有亏损 / 零亏损 / 未算 | 多发的请求 |
| --- | --- | --- | --- | --- |
| 随机着法 | 205 | 37 | 172（≥ 5,000 的 126）/ 22 / **11** | 70 |
| 入门档自对弈 | 26 | 8 | 9（≥ 5,000 的 5）/ 14 / **3** | 16 |

- 随机样本里 4 手「有现成的五连没走」全部算出：分差 988,000–1,013,400（「分差极大」）。
- 仍未算的 14 手全部是「二级结论还是 `block`」（P1）。
- **一级与二级的分差会在同一张榜单里混排。** 二级多看了两层，对坏手的惩罚看得更清：在两级都算得出的 84 手上，二级分差比一级分差高的 46 手、低的 23 手、相同的 15 手，中位数高 1,000（P90 高 13,400）。这不是奇偶层那种方向固定的偏差（两条走法始终同级），但量级不完全一致——要写进文档。

Task 3 把这组数字做成 `yarn bench:review-loss` 的输出；对不上就停下来查。

## Review Focus

1. **续搜请求还在飞时换了棋谱**：迟到的响应不得写进新一局（Task 2 用例 6）。
2. **只有一边需要续搜**（引擎首选当场成五）：另一边不发请求，也不因此卡住（Task 2 用例 2）。
3. **应着落不下去**：不发续搜、这一手不算、分析照常收尾（Task 2 用例 5）。
4. **续搜失败**：以错误收尾，不停在「分析中」（Task 2 用例 7）。
5. **一级本来就可比的手**：请求数与结论和阶段 A 逐字相同（Task 2 用例 8——既有的「17 个请求」用例不改断言仍绿）。

## 文件一览

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/analysis/analyze.ts` | 改 | `horizonLoss` 加第三个可选参数（二级评估）；新增 `linesToFollow`；`VerdictInput` 加两个字段 |
| `src/store/analysisStore.ts` | 改 | 新增 `follow` 任务；记下应着；出结论前先判要不要续搜 |
| `bench/review-loss.measure.ts` | 改 | `tally` 走完整的两级流程；多输出「续搜算出」与「漏走五连」两行 |
| `*.test.ts`、文档 | 改 | 见各任务 |

---

### Task 1: 两级评估的纯函数

**Files:** Modify `src/analysis/analyze.ts`；Test `src/analysis/analyze.test.ts`

**Interfaces（Produces）:**
```ts
/** 二级评估：对手应了一手之后，由走这一手的一方搜出来的结论（自己视角）。 */
export interface FollowUps {
  readonly played: AfterMove | null
  readonly engine: AfterMove | null
}
export function horizonLoss(
  afterPlayed: AfterMove | null,
  afterEngine: AfterMove | 'ended' | null,
  follow?: FollowUps,            // 省略 = 两边都没有二级评估
): number | null
/** 两条走法里哪几条需要续搜。一级已经可比、或有一边根本续不了时，两边都是 false。 */
export function linesToFollow(
  afterPlayed: AfterMove | null,
  afterEngine: AfterMove | 'ended' | null,
): { readonly played: boolean; readonly engine: boolean }
```
`VerdictInput` 新增 `readonly followPlayed: AfterMove | null` 与 `readonly followEngine: AfterMove | null`；`buildVerdict` 把它们传给 `horizonLoss`。
「能续搜」= 一级结论是 `block` 或 `search`（有一手明确的应着可跟）。

- [ ] **Step 1: 写失败用例**（`describe('horizonLoss —— 必防续搜')` 与 `describe('linesToFollow')`；`blocked = { score: 1_000_000, reason: 'block' }`）

  | 用例 | 断言 |
  | --- | --- |
  | 两边一级都可比时，二级评估不参与 | `horizonLoss(searched(800), searched(300), { played: searched(-99999), engine: searched(99999) })` → `500` |
  | 实际着法之后是必防：两边都用二级值 | `horizonLoss(blocked, searched(300), { played: searched(-200), engine: searched(500) })` → `700` |
  | 二级里实际着法更好：钳到 0 | `…{ played: searched(500), engine: searched(-200) }` → `0` |
  | 漏走五连：引擎首选当场成五，实际着法续搜后只是常规局面 | `horizonLoss(blocked, 'ended', { played: searched(12_000), engine: null })` → `WIN_SCORE - 12_000` |
  | 漏走五连但下一手仍然必胜 | `…{ played: { score: WIN_SCORE, reason: 'win' }, engine: null }` → `0` |
  | 已证明的一级值与对方的二级值可比 | `horizonLoss({ score: WIN_SCORE, reason: 'win' }, blocked, { played: null, engine: searched(300) })` → `WIN_SCORE + 300` |
  | **搜索值不许跨级比**：一边只有一级搜索值、另一边只有二级值 | `horizonLoss(searched(300), blocked, { played: null, engine: searched(500) })` → `null` |
  | 二级结论还是必防 / 超时：不算 | `{ played: blocked, … }`、`{ played: { score: 1, reason: 'timeout' }, … }` → `null` |
  | 省略第三个参数与阶段 A 行为一致 | `horizonLoss(blocked, searched(0))` → `null` |

  `linesToFollow`：
  | 一级（实际 / 引擎） | 期望 |
  | --- | --- |
  | search / search | 都不续 |
  | block / search | 都续 |
  | search / block | 都续 |
  | block / block | 都续 |
  | block / `'ended'` | 只续实际着法 |
  | win / block | 只续引擎首选 |
  | block / timeout、timeout / block、block / `null`、block / no_move | 都不续（有一边续不了，续了也没法比） |
  | win / search、search / `'ended'` | 都不续（一级已可比） |

- [ ] **Step 2: 确认红** — `yarn vitest run src/analysis/analyze.test.ts`
- [ ] **Step 3: 实现**（`comparableScore` 改写成返回「走这一手的一方视角的值 + 是否已证明」的两个小函数：一级、二级）。阶段 A 的 10 条 `horizonLoss` 用例**一条不改**必须仍绿。
- [ ] **Step 4: 确认绿**；`yarn typecheck` 此时会因 `VerdictInput` 多了必填字段而在 `analysisStore.ts` 与 `bench/review-loss.measure.ts` 报错——两处先传 `null`（Task 2、Task 3 再接上），测试里的 `verdict()` 工厂补默认值。
- [ ] **Step 5: 提交** — `feat(analysis): 分差的两级评估——已证明的值跨级可比，搜索值同级才比`

---

### Task 2: 分析管线发续搜请求

**Files:** Modify `src/store/analysisStore.ts`；Test `src/store/analysisStore.test.ts`

**行为规格：**

1. 记下应着：`reply` 与对照的响应除 `score` / `reason` 外多记 `move`；对照任务的局面（`state`）留在挂起结论里备用。
2. 任务多一种：`{ kind: 'follow'; index; side: 'played' | 'engine'; state }`。请求的 `board` / `player` 取 `state`；`moveIndex: index`；其余同对照请求。
3. 一手需要比较（`position.compare`）且一级的两边都就位之后，**判一次**要不要续搜（`linesToFollow`），并把结果记在挂起结论里（四态同阶段 A 的对照：`undefined` = 还没判 / 还没回来；`null` = 不需要或做不了）：
   - 某一边不需要 → 记 `null`；
   - 需要：续搜局面 = 该边一级局面再走一手应着（实际着法一边：`replay(前 i+1 手)` + `reply.move`；引擎首选一边：对照局面 + 对照响应的 `move`）。`move` 为空、落不下去、或走完后不再是 `playing` → 记 `null`（P5）；否则把续搜任务**插到队首**。
4. 出结论的条件在阶段 A 的基础上加一条：需要比较的手，两边的续搜也都已判定且回来了。
5. 续搜响应：记下 `{ score, reason }`，重试出结论。其余（三重闸门、每条响应后判收尾、失败以错误收尾、缓存）不变。

- [ ] **Step 1: 写失败用例**（新增 `describe('分析管线 —— 必防续搜')`）

  | # | 用例 | 关键断言 |
  | --- | --- | --- |
  | 1 | 实际着法之后是必防：两边各发一个续搜，盘面是各自再走一手应着之后、轮到走这一手的一方 | 局面 0 回 `(7,7)`；对照回 `{ move: (0,0), score: 300 }`；局面 1 回 `{ move: (5,5), reason: 'block' }` → 接下来两个请求 `moveIndex === 0`、`player === BLACK`，盘面分别是 `{(3,7), (5,5)}` 与 `{(7,7), (0,0)}`（各 2 子）；两个都回来之前 `verdicts.has(0) === false`；续搜分别回 `-200`（实际）与 `500`（引擎）→ `loss === 700` |
  | 2 | 漏走五连：引擎首选当场成五，只续搜实际着法一边 | `missedWinRecord()`：局面 8 回 `(7,7)`，局面 9 回 `{ move: (2,7), reason: 'block' }` → 恰好多 1 个请求（9 子 + `(2,7)` = 10 子、`player === BLACK`）；回 `12_000` → `loss === WIN_SCORE - 12_000`；`running === false` |
  | 3 | 漏走五连但下一手仍然必胜：分差为 0 | 同上，续搜回 `{ score: WIN_SCORE, reason: 'win' }` → `loss === 0` |
  | 4 | 续搜之后还是必防：不算 | 用例 1 的设置，实际着法一边的续搜回 `reason: 'block'` → `loss` 为 `null`，分析照常推进 |
  | 5 | 应着落不下去：不发续搜，这一手不算，分析照常收尾 | 局面 1 回 `{ move: (3,7), reason: 'block' }`（`(3,7)` 已有子）→ 没有多出的请求、`verdicts.get(0)?.loss` 为 `null`；把全局跑完 `running === false` |
  | 6 | 换局后，上一局续搜请求的迟到响应不写进新一局 | A 局发出续搜后 `start(B)`，再 settle A 的续搜 → B 的 `verdicts.size === 0`、没有被推着发新请求 |
  | 7 | 续搜请求失败：以错误收尾 | reject 续搜 → `error` 置位、`running === false` |
  | 8 | 一级可比的手不多发请求 | 既有用例「9 手局、前 8 手都与引擎不同：17 个请求」**不改断言**仍绿；另加一条：后续局面超时 → 不发续搜（请求数与阶段 A 相同） |

  **随行为改变而重写**的既有用例：「后续局面走的是必防捷径：分数不在同一把尺子上，不算分差」——必防现在会触发续搜，它由用例 1（算出来）与用例 4（续搜后仍必防才不算）取代，标题改为后者。其余既有用例不应变红：逐条核对过——「引擎首选落在已有棋子上」对照为 `null`，有一边续不了，不发续搜；「后续局面预算内没搜满」同理。

- [ ] **Step 2: 确认红** — `yarn vitest run src/store/analysisStore.test.ts`
- [ ] **Step 3: 实现**（规格 1–5）
- [ ] **Step 4: 确认绿**；`yarn typecheck && yarn lint`；`yarn vitest run src/features/review`；`yarn e2e e2e/review.spec.ts`
- [ ] **Step 5: 反向验证** — (a) `linesToFollow` 临时恒返回都不续 → 用例 1、2、3 红；(b) 出结论不等续搜回来（去掉规格 4 的条件）→ 用例 1 红。各自恢复。
- [ ] **Step 6: 提交** — `fix(review): 复盘分差遇到必防就沿那一手续搜一层`

---

### Task 3: 测量、文档、全量验证、浏览器复核

**Files:** `bench/review-loss.measure.ts`、`docs/AI_ENGINE.md`、`docs/USAGE.md`、`docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、`docs/TEST_REPORT.md`、`quality/tests.baseline.json`

- [ ] **Step 1: `tally` 走完整的两级流程**（用生产的 `linesToFollow` 与 `buildVerdict`）；输出在原有三个数之外加「其中靠续搜算出的」「多发的续搜请求」「漏走五连的手数与它们的分差范围」，以及「两级都算得出的手上，二级分差 − 一级分差」的符号分布与中位数。
- [ ] **Step 2: 跑** — `yarn bench:review-loss`。期望与「已知代价」表一致：随机 172（126）/ 22 / 11、续搜请求 70、漏走五连 4 手全部算出；入门档自对弈 9（5）/ 14 / 3、续搜请求 16。**不一致就停下来查。**
- [ ] **Step 3: 文档** — `AI_ENGINE.md`「复盘分差的口径」：公式改成两级的说法、可比性规则表、更新实测表与「代价与局限」（删掉已补上的两条，写上 P1 的剩余缺口与一二级混排的量级差）；`USAGE.md`：「未算分差」的解释去掉「漏走五连」那段、改写成现在什么时候还会出现；`ARCHITECTURE.md` 数据流加「必防时两边各续搜一层」；`ROADMAP.md`：长期待办第一条改成已完成并指向本计划，阶段 A 一节补一行。
- [ ] **Step 4: 全量验证** — `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e`、`yarn gates`、`yarn e2e:prod`；记下入口包实数。
- [ ] **Step 5: 基线只上调**（`quality/tests.baseline.json`）。
- [ ] **Step 6: 真实浏览器复核**（生产构建，Chrome）
  1. 一局「黑棋有四连不成五、走了别处，之后才赢」的棋：漏走的那一手不再是「未算分差」。
  2. 阶段 A 复核用过的两局（白棋不理活三；e2e 原来那局九手棋）：前者第 6 手仍在榜首，记下第 7 手现在的说法；后者记下现在的结论。
  3. 一局 80 手随机棋谱（阶段 A 量过的同一局，种子 777）：未算手数应从 53 明显下降；记下分析总耗时。
- [ ] **Step 7: `TEST_REPORT.md`** 记本补丁的用例、反向验证、基线数字、门禁读数与复核结果。
- [ ] **Step 8: 提交** — `docs: 阶段 A+ 收尾——必防续搜的口径、基线与复核记录`

收尾照例跑一轮两轴审查，查出与处置记进 `TEST_REPORT.md`。

## 验收标准

1. 「有现成的五连没走」在真实引擎下算得出分差（`bench:review-loss` 的漏走五连一行：4 手全部算出；浏览器复核 1）。
2. 未算分差的占比有新的可复跑基线：随机 11 / 205、入门档自对弈 3 / 26。
3. 一级可比的手，结论与请求数和阶段 A 逐字相同（阶段 A 的 `horizonLoss` 10 条与「17 个请求」用例不改断言仍绿）。
4. 五条命令、`yarn gates`、`yarn e2e:prod` 全绿；入口包不超 135,000 B；`ENGINE_VERSION` 与 `bench/baseline.json` 未动。

## 风险

| 风险 | 对策 |
| --- | --- |
| 一二级分差混排，榜单顺序受「哪一手碰巧走了二级」影响 | 已量化（中位 +1,000，P90 +13,400），写进 `AI_ENGINE.md`；不做修正——减一个常数只会把它变成随机误差 |
| 续搜让挂起结论的状态更多，漏掉某条路径会卡在「分析中」 | 续搜与对照共用「四态 + 判一次」的做法；用例 2、5、7 分别钉住只续一边、续不了、失败三条路径；阶段 A 的「每条响应后判收尾」保留 |
| 入口包撞线（余量 4,338 B） | 预计净增数百字节；Step 4 量实数，超了不调上限 |

---

## 自审记录

### 第 1 轮 · 口径本身站不站得住

| # | 发现 | 处理 |
| --- | --- | --- |
| 1 | 初稿只给必防那一边续搜、另一边仍用一级值。推演视界：一级是「对手、自己」两层，续搜后是「对手必防（不算）、自己、对手」——最后一手换了人下，正是阶段 A 修掉的奇偶层偏差 | 改成两边同级（P2）；并把规则写成「搜索值同级才比」，加一条专门的用例钉住「跨级不比」 |
| 2 | 两边同级的规则会让「引擎首选当场成五」也去续搜——可它已经没有下一手了 | 引入「已证明的值跨级可比」：成五 / 必胜不随视界变。`linesToFollow` 对已证明的一边返回 `false` |
| 3 | 续搜跟的是对手**在同一深度下选的**应着，不是多搜一层后的最佳应着；会不会引入新的固定偏差 | 写原型量：两级都算得出的 84 手上，二级 − 一级 负 23 / 零 15 / 正 46，中位 +1,000。方向偏正但不固定，解释为「多看两层对坏手罚得更重」；不能排除别的成因，如实写成量级差，不声称无偏 |
| 4 | 要不要干脆所有手都走二级，榜单量级就一致了 | 不要（P4）：会改掉阶段 A 已复核的全部结论，请求数翻倍，而换来的只是口径整齐 |

### 第 2 轮 · 对照代码

| # | 发现 | 处理 |
| --- | --- | --- |
| 5 | 续搜需要「对手应的是哪一手」，而现在 `reply` / `alternative` 只记了 `score` 与 `reason` | 规格 1：多记 `move`；对照的局面也要留着（现在只在任务对象里，响应回来就丢了） |
| 6 | 实际着法一边的二级局面，有时恰好是下一手的对照局面或再下一个局面，请求可以共享 | 不共享（P3）；记下理由 |
| 7 | 既有用例「后续局面走的是必防捷径……不算分差」会变红：它回的应着 `(3,9)` 落得下去，于是触发续搜 | 列入重写清单；另核对了其余用例：对照为 `null` / 超时的都因「有一边续不了」而不发续搜，不受影响 |
| 8 | `horizonLoss` 改签名会波及阶段 A 的 10 条用例 | 第三个参数做成可选，那 10 条一字不改，顺带成为「一级行为没变」的回归 |
| 9 | `VerdictInput` 加必填字段后，Task 1 结束时 `analysisStore.ts` 与 bench 脚本过不了类型检查 | Task 1 Step 4 写明两处先传 `null`，保证每个任务结束时都绿 |

### 第 3 轮 · 可执行性与比例

| # | 发现 | 处理 |
| --- | --- | --- |
| 10 | 用例 2 需要「引擎首选当场成五、实际着法之后是必防」的棋谱 | 阶段 A 的 `missedWinRecord()` 正好是（黑棋有四连，第 9 手走了 `(10,10)`） |
| 11 | 「已知代价」的数字出自临时原型，原型已删 | Task 3 Step 1–2 把同一流程做进 `bench:review-loss` 并要求对上 |
| 12 | 浏览器复核要一局「有四连不成五、后来才赢」的棋，本地双人怎么下出来 | 黑棋四连后走别处，白棋堵一头，黑棋从另一头成五——活四的两头，写进 Step 6 |
| 13 | 这是补丁，计划不该比阶段 A 的还长 | 只有三个任务；用例用表格给断言，不贴函数体 |

### 独立终审

（待填。）
