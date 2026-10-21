# 已知限制（Phase 10E）

**日期**：2026-10-21
**用途**：把「已经知道但这次不解决」的边界集中写清楚，避免下游把结论用过头。
**原则**：限制不是道歉；它是结论的适用范围。

## 1. 棋力结论

| 限制 | 影响 | 证据 |
| --- | --- | --- |
| 每对 16 局、4 个开局簇 | 95% CI 宽达 0–85.7%；只能谈方向，不能谈精确胜率 | [TOURNAMENT_RESULTS.md](TOURNAMENT_RESULTS.md) §2–4 |
| 只有内部对手 | 没有对真人、其他引擎或 Elo 标定；不能宣称绝对棋力 | 同上 |
| 开局固定且靠近中心 | 8 个 6 手开局不足以外推到边角/非常规开局 | [openings.ts](../../bench/strength/openings.ts) |
| 验证集开局修正过一次 | 「验证集只跑一次」在 `three-each` 上不成立；作废报告已归档 | [TOURNAMENT_RESULTS.md](TOURNAMENT_RESULTS.md) §3.1 |
| 战术题集饱和 | 五档均 15/15，测不出档位战术梯度 | [TACTICAL_STRENGTH.md](TACTICAL_STRENGTH.md) |
| 专家强度未量化 | 方向一致（68.8%/66.7%），但 CI 宽；实际深度 7–8，43% 超时 | [PHASE_10D.md](PHASE_10D.md) §3–4 |

## 2. 性能结论

| 限制 | 影响 | 证据 |
| --- | --- | --- |
| 单机、共享环境 | 毫秒绝对值随负载变化；审计期间负载 5.9–24.5 | [FINAL_PERFORMANCE_REPORT.md](FINAL_PERFORMANCE_REPORT.md) §1 |
| 固定深度 vs 真实预算 | 2.28× 是固定深度；真实对局 1.52–1.64×，不能混用 | 同上 §2–3 |
| 残局收益小 | 265 节点局面只有 1.25×，初始化成本占比高 | 同上 §2 |
| 专家延迟由预算决定 | 优化不会缩短专家等待；P90/P95 = 2,600 ms | 同上 §4.1–4.2 |
| Worker 堆未测 | 只测到主线程堆稳定；不能宣称 Worker 无泄漏 | 同上 §4.4 |
| 无低端真机 | 没有 CPU 限速或低端设备数据；移动端只测 Chromium 模拟 | 同上 §1 |
| 无多小时 soak | 25 轮长跑不足以覆盖极端长局/反复切换 | 同上 §4.4 |

## 3. 评测与门禁

| 限制 | 影响 | 证据 |
| --- | --- | --- |
| `bench:check` 只断言 19 行 | hard/expert 的 6 行因预算余量不足被冻结为 `gated=false`，只打印不判定 | [bench/baseline.json](../../bench/baseline.json) |
| 门禁跳过提示措辞有误 | 「余量不足 20%」实际是「耗时占比超过 20%」；判定本身由冻结基线决定 | [PHASE_10E_AUDIT.md](PHASE_10E_AUDIT.md) P3-2 |
| 剖析计数器口径过期 | 增量评估接入后 `evaluateCalls/evaluateShare` 恒为 0；CPU 采样仍有效 | 同上 P3-3 |
| 旧 SHA 不可解析 | 历史文档引用重写前 SHA；`HISTORY_REWRITE.md` 有总说明，无逐条映射 | 同上 P3-5 |
| Windows/Linux 未跑真实浏览器 | 本次只在 macOS + Chrome 验收；CI 的 e2e 在 Linux Chromium 上跑过 | CI run 39588812185 |

## 4. 规则与引擎语义

| 限制 | 影响 |
| --- | --- |
| 自由规则、无禁手 | 不是连珠规则；黑棋没有三三/四四/长连禁手 |
| 长连判胜 | 六子及以上同样算五连 |
| VCT 默认关闭 | 只算 VCF；VCT 代码与测试保留，但代价 38–520× |
| 评估是启发式 | `score` 的量纲随 `reason` 变；界面不得用它宣称局面优劣 |
| 增量评估只覆盖搜索 | `evaluateBoard()` 仍保留给测试/剖析作参照，不是并行生产路径 |
| `dispose()` 不终止 Worker | 当前应用只创建一个 Worker 且不释放；未来复用需修正 | 

## 5. 浏览器与部署

| 限制 | 影响 |
| --- | --- |
| 仅 Chrome 实测 | Playwright 的 mobile/tablet 也是 Chromium 内核；Safari/Firefox 未验 |
| 未部署预览 | 本次审计没有创建 Cloudflare 预览部署；只跑了本地 `vite preview` |
| 生产仍是旧构建 | 生产为 Phase 09B；候选未上线，线上 e2e 162/162 验的是旧构建 |
| 手动部署 | 未启用 Git 自动部署；回滚依赖 Cloudflare Dashboard 的上一部署 |
| 数据不跨源 | `localhost` 与 `gomoku-lab.pages.dev` 不同源，进度不迁移 |
| 关闭前落盘不保证 | 见既有 RELEASE_READINESS §3.3；与本次改动无关 |
| 无 Service Worker | 断网刷新需要能访问宿主 |

## 6. 不建议据此下结论的说法

- 「新引擎棋力提升了 2.28 倍」——2.28× 是速度，不是棋力。
- 「专家档已经达到某段位」——没有外部标定。
- 「五档在战术上一样强」——是题集饱和，不是能力相同。
- 「Worker 没有内存泄漏」——只测了主线程堆与 25 轮短跑。
- 「所有浏览器都验证过」——只有 Chromium/Chrome。
- 「线上已经是新版本」——生产仍是 Phase 09B，本次未部署。
