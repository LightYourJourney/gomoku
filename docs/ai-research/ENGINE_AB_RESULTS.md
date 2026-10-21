# 引擎 A/B 对局结果（Phase 10C）

> 目的不是证明「新版更强」，而是回答一个更窄的问题：
> **在行为等价的前提下，更快的引擎有没有在同样的预算里下出不同的棋、并且不更差。**
> 全部对局报告原样归档在 [`runs/`](runs/)，包括未完成与和棋，不做挑选。

## 1. 协议

| 项 | 做法 |
| --- | --- |
| 引擎形态 | **两边都用打包产物**：A = 当前源码现打的 `ab-new.mjs`，B = `6e16ed0` 打出的 `base-6e16ed0.mjs` |
| 为什么打包 | 源码引擎经 vitest 转换后比同内容的包慢约 5 倍（见 [SEARCH_OPTIMIZATION.md](SEARCH_OPTIMIZATION.md) §1.1）。不打包会把「打包方式」量成棋力 |
| 开局 | `smoke`：center-adjacent / center-diagonal；`standard`：再加 center-knight / offset-first |
| 换色 | 每个开局两局，黑白互换（报告里的 `asBlack` / `asWhite`） |
| 预算 | 同难度、同预算；`hard` = 1600 ms、深度上限 6 |
| 环境 | 同一进程、同一台机器；对局期间没有并行跑构建、测试或基准 |
| 记录 | 逐手着法、节点、深度、`ttHits`、耗时、原因；异常计数单独列 |

**「更强」的判据不是胜场**：如果两版棋谱逐手相同，胜场只会随换色对称分布（50%）。
真正要读的是**同一手在两局里由不同引擎执行时的耗时**，以及**节点 / 深度是否变化**。

## 2. 运行 1 · 固定深度等价性（medium，d4）

命令等价：

```bash
STRENGTH_MODE=smoke STRENGTH_A=medium STRENGTH_A_FIXED=4 \
STRENGTH_A_MODULE=bench/strength/.engines/ab-new.mjs \
STRENGTH_B=medium STRENGTH_B_FIXED=4 \
STRENGTH_B_MODULE=bench/strength/.engines/base-6e16ed0.mjs yarn strength
```

| 项 | 值 |
| --- | --- |
| 对局 | 4（计分 2，手数上限 2） |
| A 得分率 | 50.0%（95% CI 50.0–50.0%） |
| 异常 | 中止 0 / 非法 0 / 无着法 0 / 引擎异常 0 / 环境错误 0 |
| 逐手一致 | **2/2 对开局的全部手都一致**（点、执子方、节点、深度、ttHits、原因） |

两局的差异只有颜色。78 手与 26 手的棋谱分别逐手相同——这比单点 golden 更强，
因为它把「评估器与棋盘在整条落子/撤销链上是否同步」也一起验证了。

报告：[`2026-10-21_07-23-11-804-medium-d4-ab-new_vs_medium-d4-base-6e16ed0.json`](runs/2026-10-21_07-23-11-804-medium-d4-ab-new_vs_medium-d4-base-6e16ed0.json)

## 3. 运行 2 · hard 真实预算（smoke）

| 项 | 值 |
| --- | --- |
| 对局 | 4（计分 4） |
| A 胜 / B 胜 / 和 | 2 / 2 / 0 |
| A 得分率 | 50.0%（95% CI 50.0–50.0%） |
| 异常 | 全部 0 |
| 逐手一致 | **2/2 对开局全同**（含节点数与深度） |

报告：[`2026-10-21_07-23-39-764-hard-ab-new_vs_hard-base-6e16ed0.json`](runs/2026-10-21_07-23-39-764-hard-ab-new_vs_hard-base-6e16ed0.json)

## 4. 运行 3 · hard 真实预算（standard）

| 项 | 值 |
| --- | --- |
| 对局 | 8（计分 8） |
| A 胜 / B 胜 / 和 | 4 / 4 / 0 |
| A 得分率 | 50.0%（95% CI 50.0–50.0%） |
| 异常 | 全部 0 |
| 逐手一致 | **4/4 对开局全同**（含每手节点数） |

按开局：

| 开局 | 手数 | 结局（两局相同） | 逐手一致 |
| --- | --- | --- | --- |
| center-adjacent | 29 | black-win | 是 |
| center-diagonal | 86 | white-win | 是 |
| center-knight | 63 | black-win | 是 |
| offset-first | 29 | black-win | 是 |

报告：[`2026-10-21_07-24-43-157-hard-ab-new_vs_hard-base-6e16ed0.json`](runs/2026-10-21_07-24-43-157-hard-ab-new_vs_hard-base-6e16ed0.json)

### 4.1 同一手、不同引擎的耗时

整局耗时会把两方混在一起，不能直接比。正确口径是**逐手配对**：
两局棋谱相同、执子方相同，只是执行者互换，于是每一手都有 A、B 各一次测量。

| 开局 | A（新）总耗时 | B（旧）总耗时 |
| --- | --- | --- |
| center-adjacent | 2,422 ms | 4,047 ms |
| center-diagonal | 8,745 ms | 14,373 ms |
| center-knight | 6,815 ms | 10,952 ms |
| offset-first | 2,163 ms | 3,757 ms |
| **合计** | **20,145 ms** | **33,129 ms** |

**1.64×**。低于固定深度的 2.27×，原因不在评估：hard 档会先跑 VCF（最多占 35% 预算），
VCF 与候选生成都**没有**在本次优化里改动，它们在真实预算里占的份额被放大，
把整体比值往下拉。这也是为什么「固定深度单节点速度」与「真实对局耗时」必须分开报。

## 5. 怎么读这些结果

1. **没有证据表明变弱**：12 局真实预算对局，逐手完全相同，胜场按换色对称分布。
2. **也没有证据表明变强**：hard 档在这些开局里本来就能在预算内走满深度 6，
   更快的引擎只是**用更少的时间得到同一答案**。
3. **真实预算下没有观察到深度变化**：同会话交替跑的三个代表局面（[SEARCH_OPTIMIZATION.md](SEARCH_OPTIMIZATION.md) §6）
   两边都走满深度 6、节点数完全相同，新版只是快 2.07–2.27×。
   早先一次负载约 7 的剖析里，旧引擎在 double-three 上 1.6 秒只走完第 5 层——
   那是负载差，不是引擎能力差；跨会话的毫秒数不能当结论。
4. **未完成对局没有被丢掉**：运行 1 的 2 局 `move-limit` 原样计入，得分率仍按计分局计算，
   报告里单列未完成数。

## 6. 复现

```bash
# 旧包（只需一次；产物 gitignore）
node bench/strength/bundle-engine.mjs --root . --out bench/strength/.engines/base-6e16ed0.mjs

# 新包：profile 每次会自动重打，也可手工
node bench/strength/bundle-engine.mjs --root . --out bench/strength/.engines/ab-new.mjs

STRENGTH_MODE=standard STRENGTH_A=hard \
STRENGTH_A_MODULE=bench/strength/.engines/ab-new.mjs \
STRENGTH_B=hard STRENGTH_B_MODULE=bench/strength/.engines/base-6e16ed0.mjs \
yarn strength
```

时间预算对局依赖真实时钟，**同一台机器、同一负载下才可复现**；
换机器后请重跑，不要沿用本文的毫秒数。
