# 搜索热点剖析（Phase 10B）

> 本文只回答一个问题：**一次搜索的 CPU 时间到底花在哪**。
> 所有数字来自 `yarn profile`；归档在
> [`runs/2026-10-20_1731-phase10b-*.json`](runs/)。

```bash
yarn profile
# bench/profile/last-{cpu-profile,real-budget,micro,incremental}.json（gitignore）
```

## 1. 方法

| 项 | 做法 | 为什么 |
| --- | --- | --- |
| 采样 | V8 Profiler（`node:inspector`），间隔 **100 µs** | 在函数里插计时会改变内联与优化决策；「单次耗时 × 次数」也不等于真实占比 |
| 进程 | `pool: 'forks'` + `maxWorkers: 1` | Inspector 只能剖析当前进程；多进程也会互相抢 CPU |
| 模式 A | **固定时钟 + 固定深度**（深度 4；三个代表局面再测深度 5） | 节点数确定、可复现，回答「算法的哪一部分贵」 |
| 模式 B | **真实预算**（hard，1600 ms） | 回答「用户等的那 1.6 秒花在哪、超时前走了多深」 |
| 计数 | `src/ai/metrics.ts`，默认关闭 | 采样只给频率近似；调用次数必须精确，否则算不出「次数 × 单价」 |
| 计数开销 | 每个调用点一次判空 + 自增 | 剖析里 `countCall` 自身占 **0.4–0.5%**（表内可见），只在 `yarn profile` 时开启 |

### 读数之前：负载与绝对耗时

这台机器（Apple M3 / 8 核）在测量期间一直跑着无关进程。同一个 `evaluateBoard`
在多次运行里测到 **69–233 µs**（约 3 倍差距），而**节点数一个都不差**。

所以：

- **占比与比值**（本文主体）在多次运行间稳定，可以引用；
- **绝对微秒数**取自归档的那次运行（`1731`），并给出跨运行范围；
  不要拿它和 `AI_ENGINE.md` 里空闲机器的 76 µs 直接比；
- 1 分钟负载均值在这台机器上不是可靠指标（它把阻塞态也算进去）：
  归档那次记录了 26–28，但它的绝对耗时反而是全部运行里最低的。

## 2. 局面集

复用 Phase 10A 的 16 个标准局面 + `bench/engine.bench.ts` 的五个局面 + 接近满盘，
覆盖任务要求的九类：

| 类别 | 局面 | 候选点 | 来源 | 备注 |
| --- | --- | --- | --- | --- |
| 开局 | opening-adjacent / diagonal / knight | 28 / 32 / 32 | Phase 10A | |
| 开局 | bench-opening | 28 | engine.bench | |
| 安静中盘 | bench-midgame | 44 | engine.bench | |
| 高候选数中盘 | quiet-midgame | **81** | Phase 10A | 候选数最高 |
| 高候选数中盘 | bench-double-three | 62 | engine.bench | 分支多、剪枝差 |
| 复杂攻防 | double-threat | 40 | Phase 10A | 算杀直接命中 |
| 复杂攻防 | threat-not-win | 51 | Phase 10A | 必防捷径 |
| 复杂攻防 | real-game-ply6 | 46 | 归档对局的第 1 局前 6 手 | 真实对局，`replay()` 重建 |
| 直接成五 | direct-win-open / rush-four / multi-win / bench-four-threat | 36–64 | Phase 10A / engine.bench | 全部走 `win` 捷径 |
| 必须防守 | must-block-single / double | 40 / 36 | Phase 10A | 全部走 `block` 捷径 |
| VCF 有杀 | open-three / bench-vcf-win | 32 | Phase 10A / engine.bench | 4 个节点命中 |
| VCF 无杀 | bench-vcf-counters / bench-vcf-quiet | 68 / 33 | engine.bench | 1 个节点即收敛 |
| 接近满盘 | endgame-eight-holes / nearly-full | 8 | Phase 10A / fixtures | |

「复杂攻防」值得单说：Phase 10A 的战术局面几乎都被**算杀或捷径**提前判掉，
真正进 Negamax 的只有 `real-game-ply6`（它更深的同局前缀也会被算杀命中）。
这不是缺陷，但意味着这一类在剖析里样本很少。

## 3. 任务表（固定深度）

归档：`runs/2026-10-20_1731-phase10b-cpu-profile.json`。

| 局面 | 深度 | 候选 | 节点 | 实际深度 | 判断 | 耗时 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| opening-adjacent | 4 | 28 | 1,122 | 4 | search | 122 |
| opening-diagonal | 4 | 32 | 1,125 | 4 | search | 116 |
| opening-knight | 4 | 32 | 1,239 | 4 | search | 131 |
| bench-opening | 4 | 28 | 989 | 4 | search | 106 |
| bench-midgame | 4 | 44 | 786 | 4 | search | 94 |
| bench-midgame | 5 | 44 | 1,788 | 5 | search | 236 |
| quiet-midgame | 4 | 81 | 890 | 4 | search | 151 |
| quiet-midgame | 5 | 81 | 3,962 | 5 | search | 587 |
| bench-double-three | 4 | 62 | 1,117 | 4 | search | 161 |
| bench-double-three | 5 | 62 | 5,282 | 5 | search | 712 |
| double-threat | 4 | 40 | 2 | — | win | 1 |
| threat-not-win | 4 | 51 | 0 | — | block | 0 |
| real-game-ply6 | 4 | 46 | 1,153 | 4 | search | 147 |
| endgame-eight-holes | 4 | 8 | 265 | 4 | search | 27 |
| nearly-full | 4 | 8 | 265 | 4 | search | 27 |
| open-three / bench-vcf-win | — | 32 | 4 | — | win(3) | 1 |
| bench-vcf-counters / quiet | — | 33–68 | 1 | — | no-win | 0 |

**深度每加一层，节点涨 2.3–4.7 倍**：bench-midgame 2.3×、quiet-midgame 4.5×、double-three 4.7×。
这个倍数决定了「多少加速才够多搜一层」——见 §7。

## 4. CPU 占比

两列来自同一会话的两次独立剖析：固定深度（21 个任务）与真实预算（hard 1600 ms，3 个局面）。
**自身耗时**（self time）不含被调函数，所以 `buildLine` 的 `inBounds` / `idx` 单列。

| 函数 | 文件 | 固定深度 | 真实预算 | 归属 |
| --- | --- | --- | --- | --- |
| `scoreSegment` | evaluate.ts | **24.1%** | **24.3%** | 叶子评估 |
| `scoreLine` | evaluate.ts | 3.3% | 3.4% | 叶子评估 |
| `evaluateBoard` | evaluate.ts | 2.9% | 2.5% | 叶子评估 |
| **小计：局面评估** | | **30.3%** | **30.2%** | |
| `buildLine` | patterns.ts | **11.1%** | **12.3%** | 着法排序 |
| `inBounds` | board.ts | **10.0%** | **10.7%** | 排序 + 候选生成 |
| `scanLine` | patterns.ts | 7.5% | 6.9% | 着法排序 |
| `orderMoves` | search.ts | 5.5% | 5.1% | 着法排序 |
| `idx` | board.ts | 5.4% | 5.8% | 排序 + 候选生成 |
| `threatScoreWith` | patterns.ts | 2.2% | 1.9% | 着法排序 |
| `isOwn` / `isEmptyAt` / `analyzeRuns` | patterns.ts | 4.3% | 4.3% | 着法排序（三/二） |
| `analyzeFast` | patterns.ts | 0.9% | 1.1% | 着法排序 |
| **小计：着法排序** | | **46.9%** | **48.1%** | |
| `candidateMoves` | candidates.ts | 2.0% | 1.6% | 候选生成 |
| `negamax` | search.ts | 2.9% | 2.8% | 递归本身 |
| `findForcedWin` 家族 | threat.ts | <0.2% | <0.2% | 算杀 |
| 置换表 `probe`/`store` | transposition.ts | <0.2% | <0.2% | 未进前 20 |
| **匿名内联帧** | types.ts / board.ts 等 | **11.9%** | **11.6%** | 无法归因 |
| **GC** | | **0.44%** | **0.46%** | |
| 剖析器自身 `post` | node:inspector | 0.9% | 0.4% | 噪声 |

三点读法：

1. **着法排序比局面评估更贵**（47% vs 30%）。这与 `AI_ENGINE.md` 原先写的
   「评估是唯一瓶颈」不符，原结论已按本节改掉。
2. **置换表与算杀在测过的局面上可以忽略**（各 <0.2%）。算杀在安静局面上 1 个节点就收敛，
   有杀的局面 4 个节点命中。
3. **GC 不到 0.5%**。`buildLine` 每次调用都新建一个 9 字节 `Int8Array`
   （一次会话约 240 万次分配），但分代回收处理这些短命对象非常便宜——
   **「减少分配」不是这里的杠杆，「少做计算」才是**。

匿名帧占 11–12%，主要是 `types.ts` / `board.ts` 里被内联后失去名字的小函数。
它无法精确归属，所以百分比只当**量级**看，不要精确到小数点后。

## 5. 调用频率（回答「evaluateBoard 调了多少次」）

一次剖析会话（19,983 个搜索节点）：

| 函数 | 调用次数 | 换算 |
| --- | --- | --- |
| `evaluateBoard` | **13,741** | **每个节点 0.69 次**（≈ 叶子占比） |
| `candidateMoves` | 5,474 | 每个内部节点 ≈ 1 次（含根节点） |
| `orderMoves` | 5,355 | 每个内部节点 1 次；平均每次打分 **56.1 个候选** |
| `orderCandidates`（排序时逐个打分的候选） | 300,158 | = 5,355 × 56.1 |
| `analyzeFast` | 603,887 | **每个候选 2.01 次**（我方 + 对方） |
| `threatScoreWith` | 600,100 | 每个候选 2 次 |
| 置换表 `probe` | 19,355 | ≈ 每个节点 0.97 次 |
| 置换表 `store` | 4,635 | ≈ 内部节点的 0.87 倍 |
| `findForcedWin` | 18 | 每次搜索至多 1 次（14 次进搜索的任务 + 4 个 VCF 任务） |

真实预算那组同量级：19,583 次评估 / 28,536 个节点 = 每节点 **0.69** 次。

**这张表解释了为什么排序贵**：每个内部节点把 56 个候选**全部**打分
（每个候选两个方向、每次 `analyzeFast` 扫 4 个方向 × 9 格窗口），
然后只留宽度 12–14 个。**约 78% 的排序计算被丢弃。**

## 6. 单次调用单价

归档：`runs/2026-10-20_1731-phase10b-micro.json`（取各批最小值的 min）。

| 函数 | 局面 | 单价 |
| --- | --- | --- |
| `evaluateBoard`（单方） | bench-midgame / quiet-midgame / double-three | **68.6–73.4 µs** |
| `evaluateBoard`（单方） | nearly-full | 8.6 µs |
| `candidateMoves` | bench-midgame / quiet-midgame / double-three | 11.1–14.6 µs |
| `candidateMoves` | nearly-full（217 颗子） | **178 µs** |
| `analyzeFast`（单点） | quiet-midgame | 1.69 µs |
| `threatScoreWith`（单点，含 `analyzeFast`） | quiet-midgame | 2.26 µs |
| 一个节点的**排序原料**（候选 + 双方分析） | quiet-midgame | **380 µs** |
| 置换表 `probe`（命中 / 未命中） | bench-midgame | 0.048 / 0.049 µs |
| 置换表 `store` | bench-midgame | 0.040 µs |
| `inBounds`（整数输入） | — | **0.026 µs** |
| `inBounds` 的等价纯比较（参考） | — | **0.008 µs** |
| `idx` | — | 0.022 µs |
| `findForcedWin`（有杀 / 有小杀机但无杀） | VCF 局面 | 618 / 415 µs |

跨运行范围（负载不同）：`evaluateBoard` 69–233 µs、`candidateMoves` 11–34 µs
（满盘 178–823 µs）、排序原料 380–609 µs、`analyzeFast` 1.7–2.7 µs。
**比值在这三倍波动里保持稳定。**

**每个节点排序一遍约 0.38 ms，而一次叶子评估约 0.07 ms** —— 一个内部节点比一个叶子
贵 5 倍左右。这和 §4 的占比对得上。

`inBounds` 的 3 倍差值得单独记一笔：它内部用 `Number.isInteger`（对 NaN / Infinity 有语义），
而热路径上调用方传的全是整数。**这不构成「应该直接改掉 `inBounds`」的结论**——
它的语义是公开的、有测试钉着。它只是候选清单里的第三条（见
[OPTIMIZATION_CANDIDATES.md](OPTIMIZATION_CANDIDATES.md)）。

## 7. 不同局面 / 深度的差异

- **候选数决定成本**：候选 28 → 节点 ~1,000；候选 81 → 节点 ~890，但每节点明显更贵
  （quiet-midgame 深度 4 用 151 ms，bench-midgame 用 94 ms）。
- **深度**：每加一层节点涨 2.3–4.7 倍，耗时同步上涨。想把「完成深度」从 6 抬到 7，
  需要 **2–5 倍** 的加速——这是判断「增量评估够不够」的标尺。
- **接近满盘**：只有一个空位 8 个，评估只要 8.6 µs，但 `candidateMoves` 要 178 µs
  （要扫 217 颗子的 5×5 邻域）。这条路径在满盘时**比评估贵 20 倍**，
  只是满盘局面节点少（265），总开销仍低。

## 8. 真实预算下的样子

hard 档 1600 ms，三个局面（归档 `runs/2026-10-20_1731-phase10b-real-budget.json`）：

| 局面 | 候选 | 节点 | 完成深度 | 判断 | 耗时 (ms) |
| --- | --- | --- | --- | --- | --- |
| opening-adjacent | 28 | 10,177 | 6 | search | 1,250 |
| bench-midgame | 44 | 7,202 | 6 | search | 965 |
| bench-double-three | 62 | 11,157 | 5 | timeout | 1,601 |

这组数字**不能**和固定深度表比较：同样的 1600 ms，另一次运行只走到 4,047–4,960 个节点
（机器更忙）。唯一稳定的结论是**份额**：真实预算下评估 30.2%、排序 48.1%，与固定深度一致。

## 9. 结论（回答十个问题里的 1、2）

1. **真实 CPU 主要花在着法排序**：`buildLine` + `inBounds` + `scanLine` + `orderMoves` +
   `idx` + 三/二分析 ≈ **47%**；局面评估 ≈ **30%**；递归、候选生成、置换表、算杀
   加起来 ≈ **5–6%**；GC < 0.5%。
2. **`evaluateBoard` 在典型搜索里每个节点调用 0.69 次**（≈ 叶子占比）。
   一次 hard 档 7,000 节点的搜索约 4,800 次评估；专家档 2 万节点约 1.4 万次。

这两条直接改写了此前的工程判断：**「把评估减半」不足以解决深度问题**——
即使评估完全免费，也只剩 30% 的空间；而排序占了近一半，且其中约 78% 的候选打分会立刻被
宽度截断丢掉。
