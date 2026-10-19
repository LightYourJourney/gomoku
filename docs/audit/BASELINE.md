# 基线（Phase A）

> **归档文件（审计快照）**：记录审计开始时刻的仓库状态，**不是当前状态**。
> 现行测试条数与门禁结果见 [`docs/TEST_REPORT.md`](../TEST_REPORT.md) 与
> `quality/tests.baseline.json`。

本文件记录审计开始时刻仓库的真实状态，作为后续所有结论的对照点。
**审计期间未改动任何业务代码**（唯一的仓库外产物是 `/tmp/gomoku-audit/` 下的独立验证套件，见文末）。

## 1. Git

| 项 | 值 |
| --- | --- |
| 分支 | `main` |
| HEAD | `4987c330dc6719428501a20680b9c93f8608612a` |
| 提交标题 | `fix(review): 第七轮两轴的 5 处修复` |
| 工作区 | 干净（`git status --porcelain` 无输出） |
| 已跟踪文件 | 未跟踪的 `dist/`、`test-results/`、`.playwright-mcp/` 均已被 `.gitignore` 覆盖 |
| 标签 | 无 |

工作区干净，因此不存在「覆盖用户改动」的风险；审计全程未执行任何写仓库的 git 操作。

## 2. 环境

| 项 | 值 |
| --- | --- |
| OS | macOS 26.6.2（Build 25G83），arm64 |
| CPU | 8 核 |
| 内存 | 16 GiB |
| Node | v26.11.1 |
| 包管理器 | yarn 1.22.22（`AGENTS.md` 固定 yarn） |

## 3. 工具链（`node_modules` 里实际解析到的版本）

| 包 | `package.json` 声明 | 实际安装 |
| --- | --- | --- |
| react / react-dom | `^19.2.8` | 19.3.0 |
| zustand | `^5.0.15` | 5.0.15 |
| typescript | `~6.0.2` | 6.0.3 |
| vite | `^8.3.0` | 8.3.4 |
| vitest | `^5.0.3` | 5.0.3 |
| oxlint | `^1.81.0` | 1.87.0 |
| @playwright/test | `^1.64.0` | 1.64.0 |
| jsdom | `^30.1.2` | 30.1.2 |
| tailwindcss / @tailwindcss/vite | `^4.3.3` | 4.3.3 |

**Lint 工具是 oxlint 而不是 ESLint。** `.oxlintrc.json` 全文只有 8 行：启用 `react` / `typescript` / `oxc` 三个插件，并显式开启两条规则（`react/rules-of-hooks: error`、`react/only-export-components: warn`）。其余靠 oxlint 的默认 correctness 集合。
仓库**没有**安装 knip、dependency-cruiser、jscpd、SonarQube、ESLint、prettier、覆盖率插件（`@vitest/coverage-*` 在 `node_modules` 下不存在）。

**关于「要不要装这些工具」——审计的取舍与置信度声明**：审计要求「根据已安装工具选择，不得为了通过审计擅自调整规则或安装大量工具」。因此本轮**没有安装任何东西**，改用等价的手工方法，并把置信度差异如实写在下面：

| 常规工具 | 本轮替代做法 | 置信度差异 |
| --- | --- | --- |
| `dependency-cruiser` | 自己解析 117 个文件的全部 `import` / `export ... from` 建图，用 **Tarjan SCC + DFS 着色两种独立实现**复算环，再与 `grep "^\s*import\b"` 逐条交叉验证（508 行命中，507 行是导入语句，1 行是对象字面量属性） | **等价**。手工法的风险是「漏解析某种 import 形式」，用 grep 交叉验证覆盖了这一点 |
| `knip` | 按「导出符号 → 全仓引用点」逐条反查，并把 `import type` 与运行时导入分开统计 | **略低**。knip 会跟进 re-export 与动态导入；本仓无 `export * from`、无动态 `import()`，所以差异可忽略 |
| `jscpd` | **未做**。重复逻辑由人工审读判定（`ARCHITECTURE.md` §4） | **明显更低**。结论「只有 3 处真重复」是判读结果，不是工具输出的相似度矩阵 |
| `SonarQube` | **未做**。圈复杂度、嵌套深度只有定性判断（`ARCHITECTURE.md` §3.2） | **明显更低**。见 `FINDINGS.md` §9.2 的局限声明 |
| 覆盖率工具 | **未装**。全部覆盖缺口结论由读代码得出 | **方向可靠、边界不精确**：能确定「这条分支没有任何用例引用它」，不能给出百分比 |

## 4. 五条命令的实际执行结果

全部在 HEAD `4987c33`、干净工作区上执行。

| 命令 | 退出码 | 实测结果 |
| --- | --- | --- |
| `yarn lint` | 0 | `oxlint`，0.19 s，无任何输出（零告警） |
| `yarn typecheck` | 0 | `tsc -b` + `tsc -p tsconfig.e2e.json` + `tsc -p tsconfig.bench.json`，5.04 s |
| `yarn test` | 0 | **43 个测试文件 / 767 个用例全部通过**，69.45 s |
| `yarn build` | 0 | 85 modules，341 ms；产物 `index.css` 29.16 kB / `index-*.js` 320.40 kB（gzip 101.39 kB）/ `worker-*.js` 11.77 kB |
| `yarn e2e` | 0 | **44 条通过**（chrome / mobile / tablet 三个 project），1.5 min |

`yarn e2e:prod` 未在本轮执行（它自带一次完整 `yarn build`，且仓库惯例只在阶段收尾与构建配置变更时跑）。`yarn bench` 与 `yarn bench:render` 也未执行——本轮审计没有需要新性能数字的结论，已有的数字沿用 `bench/last-run.json` 与 `docs/AI_ENGINE.md`。

### 4.1 `yarn test` 输出里的两条既有事实

1. `vitest` 提示 jsdom 环境被创建了 43 次（`Environment jsdom was created 43 times · 135.63s total, 35% of tracked time`），并建议改用 `pool: 'vmThreads'` 或 `isolate: false`。**这是一条未处理的提示，不是失败。**
2. 测试总时长里有相当一部分来自 `src/ai/selfplay.test.ts` 的固定长超时用例（120 s / 300 s 上限）。

## 5. 已知失败与已知不足

**没有失败项。** 五条命令全绿，无 flaky 重跑，无 skip/only/todo（全仓 `grep -rnE "\.(skip|only|todo|fails)\b"` 零命中）。

仓库自己记录的已知不足分布在 `docs/ROADMAP.md` 的「已知不足」小节与 `docs/AI_ENGINE.md` 的「已知局限」，本次审计**逐条复核**，结论记在 `FINDINGS.md` 的「与文档一致的已记录项」一节。

## 6. 审计使用的外部验证套件

审计期间在 **仓库之外** 建了一套独立验证套件，用于「不依赖项目自身测试」地复核算法：

```
/tmp/gomoku-audit/
  vitest.audit.config.ts   # root 指向仓库，include 指向 /tmp，不落进仓库
  ref.ts                   # 独立参考实现（全盘暴力扫描 + 完全枚举 minimax），零 import 项目代码
  a-core.test.ts           # 规则 / 状态机 vs 参考实现          —— 17 条，全部通过
  b-ai.test.ts             # 棋型 / 候选点 / 置换表 / 算杀声性  —— 17 条，全部通过
  c-perf.test.ts           # 教学解题耗时、内容自洽性            —— 4 条，全部通过
  plumbing.test.ts         # 通道自检（1 条）
  debug.test.ts / debug2~4.test.ts   # 定位并证明「参考实现自身有一个哨兵 bug」的临时脚本
  audit-report.txt / perf.txt / dump*.txt   # 上面各脚本的产物
```

**清单的完整性声明**：上表是**全部**文件。`debug*.test.ts` 与 `dump*.txt` 是审计中途用来定位「我自己的参考实现错了」的临时脚本与输出，**不被任何结论引用**（被撤回的判断记录在 `FINDINGS.md` §5.2 与 F-13）。`audit-report.txt` 与 `perf.txt` 是 `FINDINGS.md` §5.5 / §5.6 那些数字的原始产物，可复查。

运行方式：`yarn vitest run --config /tmp/gomoku-audit/vitest.audit.config.ts`。
**它不进入 `src/**/*.test.*`，因此 `yarn test` 完全不受影响**；审计结束后可整体删除。

## 7. 复现锚点

```bash
git -C /Users/leo/leocode/vibe/games/gomoku rev-parse HEAD   # 4987c330dc6719428501a20680b9c93f8608612a
yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e
```
