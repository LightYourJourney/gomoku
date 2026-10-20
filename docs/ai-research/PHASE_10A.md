# Phase 10A · AI 棋力评测基础设施

**结论**：评测系统已建立并跑通三次真实评测；**本阶段没有优化搜索算法，也没有改动五档参数**。
新增能力：确定性评测、真实预算评测、公平配对赛、独立证明器、覆盖率完整的结果报告、可对照历史版本的引擎打包。

- 协议：[BENCHMARK_PROTOCOL.md](BENCHMARK_PROTOCOL.md)
- 基线测量：[BASELINE_STRENGTH.md](BASELINE_STRENGTH.md)
- 原始报告：[runs/](runs/)

## 1. 审计：代码事实与任务书的核对

逐项读过 `AGENTS.md` / `docs/RULES.md` / `docs/AI_ENGINE.md` / `docs/ARCHITECTURE.md` /
`docs/TEST_REPORT.md` / `docs/ROADMAP.md`，以及任务书点名的全部源码与基准文件。

| 任务书陈述 | 代码事实 | 结论 |
| --- | --- | --- |
| 15×15、自由规则、长连有效 | `BOARD_SIZE = 15`、`WIN_LENGTH = 5`、`findWinLine` 允许 ≥5 | ✅ 一致 |
| 棋盘 `Uint8Array` | `type Board = Uint8Array` | ✅ 一致 |
| 黑先手 | `BLACK = 1`，`replay` 从 `firstPlayer = BLACK` 开始 | ✅ 一致 |
| 五档 `beginner…expert` | `DIFFICULTY_PARAMS` 五档 | ✅ 一致 |
| `searchBoard()` 支持注入时钟 | 第四个参数 `now: () => number` | ✅ 一致 |
| `searchOptionsFor()` 是参数入口 | 难度参数 → `SearchOptions` 的唯一入口 | ✅ 一致 |
| `selfplay.test.ts` 把深度压到 3 | `MAX_DEPTH = 3`，注释里已明说「证明不了档位差异」 | ✅ 一致 |
| `chooseMove()` 用真实时间预算 | 内部 `Date.now` + `searchOptionsFor(params, { budgetMs })` | ✅ 一致 |
| 性能门禁有冻结基线 | `bench/baseline.json` + `bench/gate.mjs`（`gated` 字段决定断言集） | ✅ 一致 |

**一处需要记录的差异**：`SearchOutcome` 有 `ttHits`，但 `SearchResponse` 没有。
评测器因此走 `searchBoard`（而非 `chooseMove`）来采集 `ttHits`；`elapsedMs` 则由
评测器自己用注入的时钟测量，字段名与 `SearchResponse.elapsedMs` 对齐。
任务书提醒「字段不同、不要虚构」，这里按实际接口取。

**没有改动的东西**：`src/ai/search.ts`、`difficulty.ts`、`threat.ts`、`transposition.ts`、
`src/core/*`、Worker 协议、五档参数、既有测试与质量门禁。`selfplay.test.ts` 原样保留。

## 2. 新增目录与文件

```
bench/strength/
  types.ts            评测系统的类型（引擎、对局、结局、报告）
  positions.ts        16 个标准局面（12 类）
  proof.ts            独立强制胜证明器（只依赖 core/rules）
  openings.ts         8 条固定开局手顺
  local.ts            当前源码的引擎适配器（唯一参数拼装点）
  engines.ts          引擎装配：源码 / 独立打包模块
  match.ts            单局执行器 + 配对赛 + 实验编排
  stats.ts            计分、Bootstrap、先后手、逐开局、搜索指标
  report.ts           JSON + Markdown 报告
  run.ts              评测入口（`yarn strength`）
  bundle-engine.mjs   把任意源码树打包成独立引擎
  positions.test.ts   局面库 / 证明器 / 开局自检
  match.test.ts       对局执行器（黑胜、白胜、和棋、非法、截断、超时、变异）
  stats.test.ts       统计已知答案
  report.test.ts      报告完整性
  engines.test.ts     打包等价性、两版隔离、配置校验
  results/            每次实验的 JSON + MD（gitignore，不覆盖）
vitest.strength.config.ts
docs/ai-research/{PHASE_10A,BENCHMARK_PROTOCOL,BASELINE_STRENGTH}.md
docs/ai-research/runs/  三次实验的摘要与报告归档
```

同时修改：
- `vite.config.ts`：`test.include` 纳入 `bench/strength/**/*.test.ts`——评测器自测必须每次提交都跑；
- `package.json`：`strength` / `strength:bundle`；
- `tsconfig.bench.json`、`.gitignore`、`quality/tests.baseline.json`（1085 → 1154）。

## 3. 评测器设计

### 3.1 引擎适配器

```ts
interface Engine {
  id: string
  choose(board, player, { moveIndex }): {
    move, depth, nodes, ttHits, reason, elapsedMs
  }
}
```

评测器只认这个接口。两种实现：

- `createLocalEngine(spec)`：当前源码；
- `loadEngine(spec.module)`：独立打包的引擎（历史版本）。

**评测器不重新实现任何五子棋规则**：合法性、成五、和棋全部走 `core/game.ts` 的
`replay()` / `applyMove()`。

### 3.2 单局执行

- 从开局手顺 `replay()` 出局面（非法或已结束的开局直接抛错）；
- 每手把**棋盘副本**交给引擎，调用后与真实棋盘比对——引擎偷改输入会被判为异常；
- 引擎返回 `null` / 非法点 / 抛错，分别归类，不静默跳过；
- 达到手数上限记 `move-limit`，不是和棋。

### 3.3 配对赛

每个开局两局（A 黑 / B 黑），8 条开局可选。统计时以**开局为簇**做 Bootstrap。

### 3.4 报告

JSON 含完整手顺与逐手度量；Markdown 只放摘要。文件名带 UTC 时间戳，绝不覆盖。

## 4. 标准局面集

16 个局面覆盖 12 类（空盘、开局、安静中盘、直接成五、冲四、必堵、多胜点、活三、双威胁、
VCF、威胁非必胜、置换、残局）。

- 每条声明**可独立证明的性质**（规则判定或 `proof.ts` 的强制胜证明），不拿引擎输出当答案；
- 不可由合法手顺到达的战术局面显式标 `synthetic`，并禁止作为对局起点；
- `positions.test.ts` 逐条验证合法性、无五连、性质成立、类别覆盖。

独立证明器只证明「3 手强制胜」（我走一步 → 对手任意应手 → 我仍能成五），
枚举半径 4（成五窗口内最远的同色子可能在 4 格外），**不调用搜索引擎**。

## 5. 公平对弈方法

1. **成对**：同开局 A 执黑一局、B 执黑一局；只跑一局测的是「谁执黑」。
2. **开局多样**：8 条手顺覆盖 4 种白棋应手 + 非天元首手 + 四手/六手起点。
3. **固定条件**：同机、同进程、串行、相同手数上限与终止规则；报告记录负载均值。
4. **结局分类**：未完成与异常单列，不进胜率。
5. **版本隔离**：旧版本打包成独立模块，与当前源码零共享；包指纹进报告；id 不一致直接报错。

## 6. 实际测试报告

### 6.1 评测器自测（每次提交都跑）

`bench/strength/*.test.ts`：**69 条**，覆盖任务书 §十二 的 15 项：

| # | 要求 | 用例 |
| --- | --- | --- |
| 1 | 黑胜 / 白胜 | `对局执行器 > 黑胜判定`、`白胜判定` |
| 2 | 正常和棋 | `正常和棋：满盘无五连`（构造 113/112 满盘并正面验证无五连） |
| 3 | 非法落子 | `非法落子被单独归类` |
| 4 | 对局截断 | `达到手数上限记为 move-limit，不是和棋` |
| 5 | 黑白交换 | `配对赛 > 同一开局下双方各执黑一次` |
| 6 | 固定开局可复现 | `同一开局、同一配置可复现` |
| 7 | 相同配置结果一致 | `确定性配置下两次实验完全一致` |
| 8 | 对局数统计 | `对局数与重复次数相符`（3 开局 × 2 重复 = 12 局） |
| 9 | 胜负计分 | `stats.test.ts > 得分`、`汇总计数`（手算期望） |
| 10 | 超时分类 | `实验超时记为 aborted`、`引擎抛错时记录 id 与手数` |
| 11 | 异常可追踪 | `引擎修改传入棋盘会被抓住`、错误串含引擎 id 与手数 |
| 12 | JSON 完整 | `报告完整性`（commit / 指纹 / 游戏数 / 字段齐全） |
| 13 | 两版对照不混淆 | `两个引擎包不会互相污染`（各自返回自己的着法，指纹不同） |
| 14 | 引擎不修改输入 | 同上（运行时比对副本） |
| 15 | 无明显资源泄漏 | `大批量对局后堆内存没有明显增长`（300 局，阈值宽松） |

另加：打包后引擎与进程内引擎**逐局面给出相同着法**（16 个局面 × 着法/reason/深度/节点）。

### 6.2 三次真实评测

| 实验 | 局数 | 结果 | 得分率 | 工时 |
| --- | --- | --- | --- | --- |
| 入门 vs 初级（真实预算） | 4 | 2 / 2 / 0 | 50.0% | 0.2 s |
| medium 固定深度 2 vs 4 | 8 | 1 / 6 / 0 + 1 截断 | **14.3%**（CI 0–37.5%） | 5.0 s |
| 中级 vs 高级（真实预算） | 4 | 1 / 3 / 0 | 25.0%（CI 0–50%） | 83.3 s |

读数与解读见 [BASELINE_STRENGTH.md](BASELINE_STRENGTH.md)。**这三组是小样本，不构成五档排名。**

### 6.3 仓库门禁

`yarn lint` / `typecheck` / `test`（**1154** / 70 文件）/ `build` / `gates` 全绿；
`e2e` 162 条、`e2e:prod` 5 条不受影响。

## 7. 运行命令

```bash
yarn strength                                    # 冒烟（默认 beginner vs easy）
STRENGTH_MODE=standard STRENGTH_A=medium STRENGTH_B=hard yarn strength
STRENGTH_A=medium STRENGTH_A_FIXED=2 STRENGTH_B=medium STRENGTH_B_FIXED=4 yarn strength
STRENGTH_A=hard STRENGTH_B=hard STRENGTH_B_MODULE=.engines/base.mjs yarn strength
yarn strength:bundle -- --root <源码树> --out <输出.mjs>
```

环境变量：`STRENGTH_MODE` / `STRENGTH_A|B`（难度）/ `_FIXED`（固定深度）/
`_BUDGET` / `_WIDTH` / `_MODULE` / `_ID`、`STRENGTH_REPEATS`、`STRENGTH_MAX_MOVES`、
`STRENGTH_OPENINGS`、`STRENGTH_ABORT_MS`。

## 8. 实验成本（实测）

| 配置 | 工时 |
| --- | --- |
| 评测器自测 | 0.6 秒 |
| smoke（入门 vs 初级） | 0.2 秒 |
| smoke（中级 vs 高级） | 82 秒 |
| standard（固定深度 2 vs 4） | 5 秒 |
| extended（8 开局 × 2，未跑） | 按 standard 外推约 1–3 分钟（确定性）/ 20–40 分钟（真实预算高档） |

CI 只跑自测，不跑真实对局。

## 9. 统计局限

- 每组 4–8 局，只能区分「明显更强」与「没有明显差别」；
- 开局簇只有 2–4 个，Bootstrap 区间本身不稳定；
- 真实预算结果依赖机器与负载，换机器不可直接比；
- 没有人类基准，不能映射到「人类几级」；
- 描述性 Elo 只在小样本下作为附注，不构成等级；
- 证明器只证 3 手强制胜，「证不出来」不等于「不存在」。

## 10. 后续可优化的候选热点

按「能被新评测系统衡量」排序：

1. **高级/专家档的预算与深度不匹配**：实测高级档 24/87 手吃满 1600 ms 预算（`reason = timeout`），
   平均深度 3.72，未达到上限 6。先用确定性评测分离「搜索速度」与「剪枝质量」，再决定加预算还是优化。
2. **`evaluateBoard` 仍是 O(整盘)**（AI_ENGINE 实测 76 µs/次）：增量评估是提升每毫秒深度的最直接路径。
3. **宽度与深度的取舍**：确定性评测已能固定深度做对照，下一步可扫 `width ∈ {10,12,14}`。
4. **开局集扩充**：8 条手顺、簇数少导致区间宽；扩到 12–16 条能显著收窄置信区间。
5. **VCT 的代价/收益**：本轮未启用；评测系统已能对照「开启 / 关闭」两套配置。

**本阶段到此停止，不进入 Phase 10B。**
