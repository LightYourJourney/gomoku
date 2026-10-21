# 评测报告归档

这里存放长期保留的实验报告：`<UTC 时间>-<A>_vs_<B>.json` + `.md`，与
`bench/strength/results/` 下产出的文件同名同内容。结果显示目录已 gitignore，
需要留档的实验把文件抄到这里即可。

## 两类文件

- **`.json`**：机器可读。当前 schema 含 `games`（逐局、逐手，含节点数 / 深度 /
  `ttHits` / `reason` / 耗时）、`meta.statistics`（Bootstrap 方法与种子）、
  `meta.openingsVersion`（开局集指纹）、`a/b.resolved`（实际生效参数）。
- **`.md`**：人读摘要。表头里的「完整数据」指向 `meta.resultFile`。

## Phase 10B 的剖析产物

`2026-10-21_0429-phase10b-*.json` 是 `yarn profile` 的四份输出，**不是棋力实验**：

| 文件 | 内容 |
| --- | --- |
| `cpu-profile` | 固定深度剖析：任务表、函数自身耗时、调用计数、派生比例 |
| `real-budget` | 真实预算（hard 1600 ms）剖析 |
| `micro` | 热点函数单价、`inBounds` 对照、置换表内存 |
| `incremental` | 增量评估生命周期、落子/撤销单价、递归树、内存 |

它们由 `bench/profile/*.profile.ts` 生成，**每次 `yarn profile` 都会覆盖**
`bench/profile/last-*.json`；这里存的是被文档引用的一次运行（8 核；结束时记录 1 分钟负载均值 3.1–3.3）。
绝对微秒数随负载变化，读法与噪声说明见 [CPU_PROFILE.md](../CPU_PROFILE.md) §1。

## Phase 10C 的优化与对照产物

`2026-10-21_07*-phase10c-*` 是 Phase 10C 的测量：

| 文件 | 内容 |
| --- | --- |
| `0722-phase10c-{cpu-profile,real-budget,micro,incremental}` | 接入增量评估后的剖析（负载约 7.0，读法与 10B 相同）。**`real-budget` 是负载约 7 时的一次运行**：旧引擎在 double-three 上没走完第 6 层，这是负载产物；同会话对照以 `0753` 的 `realBudget` 段为准 |
| `0753-phase10c-upgrade-ab` | 旧包 vs 新包的固定深度计时（16 局面，节点 / `ttHits` / 深度 / 着法逐项相同）＋**同一会话的真实预算段**（hard 1600 ms，3 局面） |

`2026-10-21_07-23-*`、`07-23-39-*`、`07-24-43-*` 三组 `*_vs_*` 是引擎对局：

| 文件 | 内容 |
| --- | --- |
| `07-23-11-804-medium-d4-*` | 固定深度 4 的等价性对局（4 局，2 局手数上限） |
| `07-23-39-764-hard-*` | hard 真实预算 smoke（4 局） |
| `07-24-43-157-hard-*` | hard 真实预算 standard（8 局） |

读法见 [ENGINE_AB_RESULTS.md](../ENGINE_AB_RESULTS.md)。**胜场不是结论**：
三组对局都逐手相同，得分率必然按换色对称分布。

## Phase 10D 的对局、标定与战术产物

| 文件 | 内容 |
| --- | --- |
| `2026-10-21_09-23-19…09-24-05-*phase10d-base*` | **开发集**相邻档对局（4 个开局：center-adjacent / diagonal / knight / offset-first） |
| `2026-10-21_09-33-32-838-expert-2600_vs_expert-1800` | 专家预算实验（2600 vs 1800，standard） |
| `2026-10-21_09-39-57-219-expert-1800_vs_hard-base` | 降预算专家 vs 高级（standard） |
| `2026-10-21_09-43-19-606-hard-w12_vs_hard-w14` | 固定预算下的宽度实验（smoke） |
| `2026-10-21_09-43-56-413-expert-vcf13_vs_expert-vcf9` | 专家算杀深度实验（smoke） |
| `2026-10-21_09-46-*phase10d-base*` | **作废的验证集**：`three-each` 开局本身是黑棋强制胜，每对白送黑棋一分。保留供复核 |
| `2026-10-21_09-52-*phase10d-base*` | **修正后的验证集**（留出开局，openingsVersion `808a8a8fe08e5711`）：参数冻结后只跑一次 |
| `2026-10-21_0922-phase10d-tactics` | 五档 × 16 个标准战术局面（`yarn tactics`） |

读法与结论见 [TOURNAMENT_RESULTS.md](../TOURNAMENT_RESULTS.md)、
[DIFFICULTY_CALIBRATION.md](../DIFFICULTY_CALIBRATION.md) 与
[TACTICAL_STRENGTH.md](../TACTICAL_STRENGTH.md)。

## 两点注意

1. **`2026-10-20_04-05-*` 那三份用的是旧 schema**：它们把逐局信息放在
   `gamesSummary` 里（开局、双方、结局、手数、耗时、错误），**没有逐手度量**，
   也没有 `resolved` / `openingsVersion` / `statistics`。这是当时代码的真实输出，
   不是归档时漏抄。要逐手数据只能重跑。
2. **`meta.resultFile` 指向产出的原始路径**（`bench/strength/results/…`，已 gitignore）。
   归档副本与该路径内容一致；原路径在本机之外不存在，这不影响报告本身的可读性。

## Phase 10E 的独立审计产物

| 文件 | 内容 |
| --- | --- |
| `2026-10-21_phase10e-audit.json` | 独立审计汇总：门禁、固定深度/真实预算 A/B、新旧对局、五档 smoke、战术、浏览器验收、超时回退、长跑内存、产物哈希与大小 |

本文件是**审计汇总**，不是棋力实验；各子项的原始数据仍在
`bench/strength/results/`（gitignore）与 `bench/profile/last-upgrade-ab.json`。
读法与结论见 [PHASE_10E_AUDIT.md](../PHASE_10E_AUDIT.md)。
