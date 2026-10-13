# 质量门禁实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「质量退化」这件事有人替我们盯着——本地 pre-push 跑快档、GitHub Actions 跑全档，加上循环依赖 / 死代码 / 重复代码 / 基准数值四道防退化闸门。

**Architecture:** 每道闸门都是一个**会让命令非零退出**的检查，用仓库既有的 `yarn <script>` 入口暴露，本地钩子与 CI 跑的是同一批脚本——**不出现"CI 里跑的那套和本地不一样"**。基准门禁只断言余量充足的行，且断言集由入库的基线文件决定。

**Tech Stack:** GitHub Actions、git hooks（`core.hooksPath`，不用 husky）、madge / knip / jscpd（钉成 devDependencies）、Node 脚本。

**Spec:** [docs/superpowers/specs/2026-10-13-quality-gates-design.md](../specs/2026-10-13-quality-gates-design.md)

## Global Constraints

- 包管理器固定 **yarn 1.x**。CI 用 `yarn install --frozen-lockfile`。
- Node：本地 **v26.11.1**；仓库没有版本固定文件，CI 里显式钉同一个大版本。
- **闸门必须能归因到代码**：三个工具钉精确版本（`npx` 的版本漂移已经实测到过 9 vs 10 的差异）。
- **快档预算 1 分钟**（实测热跑 ~36 秒）。超预算的检查一律挪进全档。
- 每道闸门都要做**反向验证**：注入一个违规，确认它真的会红。这是仓库既有纪律，写在 `AGENTS.md`。
- 提交信息用中文，与仓库现有风格一致。
- `main` 仍是「本地 ff-merge + 手动 push」，**不改 PR 流程**。

## Review Focus

以下五类是这个 spec 隐含、但没有哪条任务的测试天然覆盖、且最容易咬到人的。每条都钉在拥有对应代码的任务上：

1. **钩子没装上就静默失效**——`core.hooksPath` 是**每个克隆的本地配置**，不会随仓库走。钉在 Task 5：`yarn install` 后必须能 `git config --get core.hooksPath` 读到 `.githooks`，且钩子首行检测自己是否真的被调用。
2. **钩子里没有 `yarn`（没装依赖、或 PATH 干净）时静默放行**——门禁**必须失败关闭**。钉在 Task 5：钩子用 `command -v yarn` 显式检测，缺了就以非零退出并说明原因。
3. **闸门的报错不可读**（只给一个退出码）——人看不懂就会去 `--no-verify`。钉在 Task 2、3、4：每个失败路径都要打印「哪个文件 / 哪一行 / 为什么」。
4. **基准门禁在慢机器上假红**——这正是 spec 的反目标 #2。钉在 Task 4：构造一个「被断言行跑成 timeout」与一个「非断言行跑成 timeout」的输入，前者必须红、后者必须跳过并打印。
5. **`ui:probe` 在 CI 上起不来时只说一句失败**——它只依赖真实 Chrome（dev server 它自己起，
   见 Task 7 Step 1）。钉在 Task 7：失败时必须能从日志看出是「浏览器没起来」还是「判据没过」。
6. **覆盖悄悄缩水**（删状态、删用例、加 `.skip`、控件从 DOM 消失）——**终审挖出来的、
   而且是这份设计最初漏掉的一半**。钉在 Task 8（探针覆盖棘轮）与 Task 9（测试条数棘轮）：
   本次覆盖必须是入库基线的超集，少一条就红并点名到具体控件。

---

### Task 1: 循环依赖闸门（madge）

**Files:**
- Modify: `package.json`（devDependencies + scripts）
- Modify: `README.md`（命令表加一行）

**Interfaces:**
- Produces: `yarn check:cycles` —— 有环时非零退出并打印环路路径；无环时打印文件数与「零循环」

- [ ] **Step 1: 装依赖并加脚本**

`yarn add -D --exact madge`（**必须 `--exact`**：spec 要求精确版本，默认的 `^` 会让结果漂移），
加脚本 `"check:cycles": "madge --circular --extensions ts,tsx src"`。

- [ ] **Step 2: 跑一次，确认今天是通过的**

Run: `yarn check:cycles`
Expected: 退出码 0，输出含 `No circular dependency found!` 与 136 个文件（今天的状态）

- [ ] **Step 3: 反向验证——注入一个环，必须红**

新建 `src/lib/__cycle-a.ts` 与 `src/lib/__cycle-b.ts`，互相 `import`，跑 `yarn check:cycles`。
Expected: **非零退出**，且输出里能看到 `__cycle-a.ts` 与 `__cycle-b.ts` 构成的环。
（不能只看退出码——必须看到它**指出了是哪两个文件**，否则报错不可读。）

- [ ] **Step 4: 删掉探针文件，确认恢复绿**

Run: `rm src/lib/__cycle-*.ts && yarn check:cycles`
Expected: 退出码 0

- [ ] **Step 5: README 命令表加一行，提交**

README 那一行要写明**范围是 `src/`**（`bench/`、`e2e/` 不在内——它们是脚本，循环依赖风险低，
但别让人以为全仓都查过）。

```bash
git add package.json yarn.lock README.md
git commit -m "chore(gates): 加循环依赖闸门（madge）"
```

---

### Task 2: 死代码闸门（knip）＋ 修掉真·多余导出

**Files:**
- Modify: `package.json`（devDependencies + scripts）
- Create: `knip.json`
- Modify: `src/learn/verify.ts`（`OK` 去掉 `export`）
- Modify: `docs/audit/TECH_DEBT.md`（指明基线理由所在，供 knip 配置引用）

**Interfaces:**
- Consumes: 无
- Produces: `yarn check:deadcode` —— 有未处理项时非零退出并逐条列出

- [ ] **Step 1: 先修那一个真问题**

`src/learn/verify.ts` 的 `export const OK` 只在本文件内使用（全仓 grep 确认过：非测试代码之外无人 import）。
去掉 `export` 关键字，跑 `yarn test src/learn/verify.test.ts`。
Expected: 绿。**这一步不改变任何行为**，只是收窄模块接口。

- [ ] **Step 2: 装依赖**

`yarn add -D --exact knip`，加脚本 `"check:deadcode": "knip --reporter compact"`。

- [ ] **Step 3: 跑一次，看清剩下什么**

Run: `yarn check:deadcode`
Expected: 只剩「只被签名引用」的类型导出（实测 9–10 个，随工具版本浮动）与 `src/ai/difficulty.ts` 的
`DIFFICULTIES` / `AVAILABLE_DIFFICULTIES` 一对。**`OK` 必须已经不在列表里**。

- [ ] **Step 4: 写 `knip.json`**

用 knip **按符号种类**的忽略，而不是逐条列符号名：

```json
{
  "ignoreExportsUsedInFile": { "type": true, "interface": true }
}
```

`OK` 是 `export const`（种类 `variable`），**不在这两类里，照样会被抓** ✓。
这样「只被签名引用的类型导出」整类放掉——`TECH_DEBT.md` §1.3 已裁定这类**不偿还**，
逐个列名只会让新冒出来的同类条目变成没人处理的红灯（那就成了"训练人忽略红灯"）。
代价写明：**类型/接口这一类从此不再报**。

> 写计划时这里错过一次：原本写的是用 `ignoreIssues` 逐条列符号名。
> 查了 knip 官方文档才发现 **`ignoreIssues` 的形状是「文件 glob → 问题种类数组」**，
> 根本没有"按符号名忽略"这回事。所以那份 9–10 条的手工基线连同
> 「升级 knip 后要重跑更新基线」的长期规则，**整批删掉**。

`src/ai/difficulty.ts` 那对同义常量单独处理：给 `AVAILABLE_DIFFICULTIES` 加 JSDoc `@public`
并写明理由（它是「定义了哪些档」与「开放哪些档」的分界点，今天两者恰好相等）。

- [ ] **Step 5: 跑一次，确认绿**

Run: `yarn check:deadcode`
Expected: 退出码 0，**且没有配置警告**。再连跑三次，输出逐字节相同
（同一个仓库同一份代码、`npx` 两次跑出过 9 与 10 两个结果——若那是工具的**运行间**不确定性
而不只是版本漂移，钉版本治不了它，会变成随机红；连跑三次就是为了当场分清）

- [ ] **Step 6: 反向验证——加一个没人用的导出，必须红**

在 `src/lib/cx.ts` 末尾加 `export const __unusedProbe = 1`，跑 `yarn check:deadcode`。
Expected: **非零退出**，且输出里出现 `__unusedProbe` 与它所在的**文件路径**。删掉它，确认恢复绿。

- [ ] **Step 7: README 命令表加一行，提交**

```bash
git add package.json yarn.lock knip.json src/learn/verify.ts docs/audit/TECH_DEBT.md README.md
git commit -m "chore(gates): 加死代码闸门（knip），修掉 verify.ts 多余的导出"
```

---

### Task 3: 重复代码闸门（jscpd）

**Files:**
- Modify: `package.json`（devDependencies + scripts）
- Create: `.jscpd.json`
- Modify: `docs/audit/TECH_DEBT.md`（写明接受哪几处同形、为什么）

**Interfaces:**
- Produces: `yarn check:dupes` —— 出现未被显式接受的克隆时非零退出并打印克隆对

- [ ] **Step 1: 装依赖并跑一次基线**

`yarn add -D --exact jscpd`。先不带配置手动跑一遍拿到今天的实情：

Run: `npx jscpd src --min-tokens 50 --ignore "**/*.test.*" --reporters console`
Expected: **4 处克隆 / 重复行 0.84%**（含 `gameRecords`↔`progress`、`lessons`↔`puzzles`、
`LearnScreen`↔`PuzzleScreen`）。把它们逐个记下来。

- [ ] **Step 2: 写 `.jscpd.json`**

- `path: ["src"]`、`minTokens: 50`、**`minLines: 5`（显式写出来，不依赖默认值）**、
  `ignore: ["**/*.test.*", "**/*.test.tsx"]`
  （**排除测试是政策决定**：测试里重复夹具是合理的，为过闸门去写更差的测试是本末倒置）
- `threshold: 0` —— **不容忍**，任何没被显式接受的新克隆都红
- 把 Step 1 里那 4 处涉及的 6 个文件放进 `ignore`，并在 `docs/audit/TECH_DEBT.md` 写明理由：
  **理由要照着克隆片段写，别照着印象写**——计划最初这里写过一版错的：
  说 `gameRecords`↔`progress` 是「两个存储层各自的 `withStore`（事务边界不同）」，
  实施时打开片段一看，那 33 行其实是**两个存储层共用的 IndexedDB 工厂解析与内存回退样板**。
  真实理由见 `TECH_DEBT.md` §1.3（那里同时写明**这个数字只减不增**）。
  **代价写在文档里**：这 6 个文件不受这道闸门保护。

加脚本 `"check:dupes": "jscpd --config .jscpd.json"`。

**这道闸门的能力边界必须写进 `README.md` 那一行**（实测过，不是推测）：
jscpd **只认逐字相同的克隆**。把一份东西抄成两份、**改掉标识符**之后：
逐字复制 `Found 1 clones`，改名版 **`Found 0 clones`**。
所以它是**复制粘贴检测器，不是"重复实现"检测器**——
「把 store 抄一份、字段名换一批」这种能从四道闸门底下走过去。写明这句，
是为了别让人以为挂上这道闸门就不会再有重复实现了。

- [ ] **Step 3: 跑一次，确认绿**

Run: `yarn check:dupes`
Expected: 退出码 0

- [ ] **Step 4: 反向验证——造一处没被接受的克隆，必须红**

把 `src/lib/theme.ts`（29 行）整个内容复制成 `src/lib/__dup-probe.ts`（补上它需要的 import），
跑 `yarn check:dupes`。Expected: **非零退出**，且输出里出现 `theme.ts` ↔ `__dup-probe.ts` 这一对与行号。
删掉探针文件，确认恢复绿。

> **别用 `src/lib/cx.ts` 当探针**（计划最初就是那么写的）：它只有 **4 行**，
> 而 jscpd 除 `minTokens` 外还有一个默认的 `minLines`——复制 4 行的文件**一个克隆都找不到**，
> 那一步会「保持绿色」，实施者要么卡住、要么把绿记成已验证，**恰好是它自己要防的东西**。

- [ ] **Step 5: README 命令表加一行，提交**

```bash
git add package.json yarn.lock .jscpd.json docs/audit/TECH_DEBT.md README.md
git commit -m "chore(gates): 加重复代码闸门（jscpd），基线逐条写明理由"
```

---

### Task 4: 基准数值门禁（bench:check）

**Files:**
- Create: `bench/baseline.json`
- Create: `bench/gate.mjs`
- Modify: `package.json`（scripts）
- Modify: `README.md`（命令表加一行；**并改掉第 148 行那句已经变成假话的「基准不做断言…靠人工比对」**）

**Interfaces:**
- Consumes: `bench/last-run.json`（`yarn bench` 的产物）
- Produces:
  - `node bench/gate.mjs [--current <path>]` —— `--current` 默认 `bench/last-run.json`；
    退出码 0 = 全部判据一致，1 = 有判据对不上
  - `yarn bench:check` = `yarn bench && node bench/gate.mjs`

- [ ] **Step 1: 生成 `bench/baseline.json`（冻结，不从别处现算）**

从 `bench/runs/7a08f32.json` 生成一份**快照**，之后就以它为准：

```json
{
  "artifact": "runs/7a08f32.json",
  "note": "断言行由 gated 字段决定，预算是冻结值。改这里 = 显式改基线，改动进 diff。",
  "rows": [ { "difficulty": "easy", "position": "开局", "budgetMs": 250, "depth": 4, "nodes": 1234, "gated": true }, ... ],
  "invariants": {
    "threat": [ { "name": "活三（3 手胜）", "mismatch": false, "found": true, "plies": 3 }, ... ],
    "vct":    [ { "name": "孤立活三", "vcfFound": true, "vctFound": true, "gains": false, "vcfPlies": 3, "vctPlies": 3 }, ... ],
    "evaluateCalls": 200000,
    "analysisPoints": 44
  }
}
```

**`budgetMs` 与 `gated` 必须是冻结值，不要在 gate.mjs 里现从 `src/ai/difficulty.ts` 算**：
现算的话，将来有人把某档预算调小（很自然的产品改动），那一行会**无声地掉出断言集变成"跳过"**——
断言集缩小而门禁文件一个字节都没改，正是这套东西要防的那类退化。

`gated` 的判定规则（生成时用一次）：`elapsedMs <= budgetMs * 0.2`。
按此，19 行 gated（14 search + 5 win）、6 行不 gated（4 行 timeout + hard/开局 69% + hard/中盘 58%）。

- [ ] **Step 2: 写 `bench/gate.mjs`**

1. 读 `bench/baseline.json` 与 `--current` 指定的产物（默认 `bench/last-run.json`）。
2. **`search` 部分**：按 `(difficulty, position)` 配对。
   - `gated: true` 的行：`depth` / `nodes` 与基线不等 → 失败，报错带**档位、局面、两个值**；
     若当前行 `reason === 'timeout'` → 报错文案要**区分**「这一行在基线上是搜完的，现在没搜完——
     要么算法变重了，要么机器慢了」。
   - `gated: false` 的行：**跳过并逐行打印为什么跳过**（带上 `elapsedMs / budgetMs` 占比）。
   - 基线里有、当前没有的行 → **失败**（局面集变了，基线要显式更新）。
   - **反方向也要查**：当前有、基线没有的行（例如新增了一个局面）→ **也失败**。
     只查一个方向的话，新局面上线时会**静默地不进断言集**，门禁照样绿。
3. **`invariants` 部分（与机器速度无关，成本为零，必须一起判）**：
   - 每一行 `threat`：`mismatch` 必须为 `false`，`found` / `plies` 与基线相等
   - 每一行 `vct`：`vcfFound` / `vctFound` / `gains` / `vcfPlies` / `vctPlies` 与基线相等
     （**`gains` 是布尔，不是数字**——按布尔比）
   - `evaluate.calls` 与 `analysis.points` 与基线相等
   - **不要判任何耗时字段**（`perCallUs` / `suggestionsMs` / 各 `*Ms`）：那些才是机器相关的，只打印
4. 结尾打印汇总：`断言行 N 通过 / 跳过 M / 不变量 K 条`。有失败则 `process.exitCode = 1`。

- [ ] **Step 3: 对真实产物跑一次**

Run: `yarn bench && node bench/gate.mjs`
Expected: 退出码 0；输出含 **19 行被断言**、**6 行被跳过**（各自带原因）、以及 threat 4 行 + vct 3 行 + 2 个计数的不变量

- [ ] **Step 4: 反向验证（喂合成输入，别动真产物）**

用 `--current` 喂手工改过的 JSON，四件事都要验：

1. 改一个 **gated 行**的 `nodes` → 非零退出，报错点出档位、局面与两个值
2. 把 **hard/开局**（非 gated）改成 `reason:"timeout"`、`nodes:99999` → **退出码 0**，输出写明它被跳过
3. 把一个 **gated 行**改成 `reason:"timeout"` → **非零退出**，文案说明「这行本该搜完」
4. 把某条 `threat` 的 `mismatch` 改成 `true`、或 `vct` 的某个 `vctPlies` 改掉 → **非零退出**
   （证明不变量那一半真的在判，不是摆设）

- [ ] **Step 5: 加脚本、README，提交**

README 命令表加一行；**同时改掉 README 第 148 行**——那里现在写着
「**基准不做断言**：`yarn bench` 只产数字、不设阈值；防性能回退目前靠人工比对」，
这一步做完它就变成假话了。

```bash
git add bench/baseline.json bench/gate.mjs package.json README.md
git commit -m "chore(gates): 加基准数值门禁，只断言余量充足的行"
```

### Task 5: 本地 pre-push 快档钩子

**Files:**
- Create: `.githooks/pre-push`（可执行位必须入库）
- Modify: `package.json`（`prepare` 脚本）
- Modify: `README.md`（命令表加 `yarn gates` —— 它不是任何单个闸门的产物，最容易漏）

**Interfaces:**
- Consumes: 五个既有脚本 + Task 1–4 的 `check:cycles` / `check:deadcode` / `check:dupes`
- Produces: `yarn gates` = 三个闸门串跑；`.githooks/pre-push` 跑 **4 条既有命令 + `gates`**（内部再串 3 个闸门），任一条非零则整体非零

- [ ] **Step 1: 加 `gates` 脚本**

`"gates": "yarn check:cycles && yarn check:deadcode && yarn check:dupes"`

- [ ] **Step 2: 写 `.githooks/pre-push`**

```sh
#!/bin/sh
# 见 docs/superpowers/specs/2026-10-13-quality-gates-design.md
# 快档：红了的代码不该推出去。绕过它用 `git push --no-verify`（代价自负）。
set -e
command -v yarn >/dev/null 2>&1 || {
  echo "✗ pre-push: 找不到 yarn——门禁无法运行，拒绝推送。" >&2
  echo "  （这是有意失败关闭：门禁跑不起来时不许静默放行。）" >&2
  exit 1
}
[ -d node_modules ] || {
  echo "✗ pre-push: 没有 node_modules——先 yarn install。" >&2
  exit 1
}
yarn lint && yarn typecheck && yarn test && yarn build && yarn gates
```

`chmod +x .githooks/pre-push`。要让**可执行位进库**，`git update-index --chmod=+x` 必须在
**文件进入索引之后**跑（在 `git add` 之前跑会以 128 报错 `cannot add to the index - missing --add`）。
本机 `core.fileMode=true`，`chmod +x` + `git add` 本来就够；要在 `fileMode=false` 的机器上也成立，
就用 `git update-index --add --chmod=+x .githooks/pre-push`。

- [ ] **Step 3: 挂上钩子（`yarn install` 自动生效）**

`package.json` 加 `"prepare": "git config core.hooksPath .githooks"`。跑一次 `yarn install` 触发它。

- [ ] **Step 4: 验证钩子真的会拦（Review Focus #1、#2）**

1. `git config --get core.hooksPath` → Expected: 输出 `.githooks`
2. 临时在某个源文件里制造一个未使用变量 → `git push --dry-run` →
   Expected: **推送被拒**。实测拦住它的是 **typecheck**（TS6133）而不是 lint——
   oxlint 的 `no-unused-vars` 只是 **warning**，`yarn lint` 照样退 0。
   要验 lint 那条得挑一个 oxlint 判成 **error** 的写法。还原那个错误。
3. `env PATH=/usr/bin:/bin sh .githooks/pre-push`（PATH 里没有 yarn）→
   Expected: **非零退出**且打印「找不到 yarn」，**不是静默通过**

- [ ] **Step 5: 绿的情况下确认放行，并量一次快档耗时**

Run: `time (yarn lint && yarn typecheck && yarn test && yarn build && yarn gates)`
Expected: 全绿；**热跑在 1 分钟内**（spec 的反目标之一是"慢到让人习惯 `--no-verify`"，
超了就把某条检查挪进全档，别硬扛）。

Run: `git push --dry-run`
Expected: 放行（`--dry-run` 不会真的推）

```bash
git add .githooks/pre-push package.json README.md
git commit -m "chore(gates): 本地 pre-push 快档钩子"
```

（`AGENTS.md` 的改动在 Task 7 Step 4——那里才写「两条通道各覆盖什么」。）

---

### Task 6: GitHub Actions —— 第一步，只跑快档

**Files:**
- Create: `.github/workflows/quality.yml`
- Modify: `docs/TEST_REPORT.md`（记 CI 首跑结果）

**Interfaces:**
- Consumes: Task 1–5 的全部脚本
- Produces: workflow `quality`，本任务结束后**只有 `fast` 一个 job**

- [ ] **Step 1: 写 workflow（只含 fast job）**

`on: [push, pull_request]`；`runs-on: ubuntu-latest`；步骤依次是
`actions/checkout@v4` → `actions/setup-node@v4`（`node-version: 26`，`cache: yarn`）→
`yarn install --frozen-lockfile` → 快档那 5 条命令（`lint` / `typecheck` / `test` / `build` / `gates`）。
`timeout-minutes: 15`。本机 Node 是 26.11.1，钉同一个大版本；`node-version: 26` 在 runner 上
能否取到本地验不了，这是首跑要确认的第一件事（Step 3 有处置）。

- [ ] **Step 2: 本地能验的先验**

Run: `yarn lint && yarn typecheck && yarn test && yarn build && yarn gates`
Expected: 全绿（这就是 CI 会跑的那六条；本地绿 = CI 的主要失败源已排除）

- [ ] **Step 3: 推到远端，看它真的跑起来**

**这一步会动远端。** 推当前分支（不是直接推 main），然后在 Actions 页面看 `fast` job。
Expected: job 绿。
- 若 `yarn install --frozen-lockfile` 失败 → lockfile 与 `package.json` 不同步，本地补一次 `yarn install` 再提交
- 若 setup-node 拿不到 node 26 → 降到 runner 上可用的最近大版本，并在 TEST_REPORT 记下实际值

- [ ] **Step 4: 把首跑结果记进 TEST_REPORT，提交**

```bash
git add .github/workflows/quality.yml docs/TEST_REPORT.md
git commit -m "ci: 快档门禁（GitHub Actions，第一步只跑快档）"
```

---

### Task 7: 打开全档

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `docs/TEST_REPORT.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 6 的 workflow
- Produces: 三个新 job —— `e2e`（`yarn e2e` + `yarn e2e:prod`）、`probe`（`yarn ui:probe --out ci`）、`bench`（`yarn bench:check`）

- [ ] **Step 1: 加三个 job（首跑全部先取数，不阻断）**

拆三个 job 而不是一个大 job，理由是**报错要能归因**：

- `bench` 是这套门禁里**唯一对机器速度敏感**的判据；和 e2e 挤一台机器，
  会把「机器忙」误报成「算法变慢」
- `probe` 自己起 dev server（**5184**）、一次约 5 分钟、产 172 张 PNG，失败原因必须单独可见
- `e2e` 是既有检查，最可能**因为环境而不是代码**变红（见 Step 3 的平台校准）

**不要手工先起 dev server。** `yarn e2e` 由 Playwright 的 `webServer` 管
（`playwright.config.ts` 里 `reuseExistingServer: !process.env.CI`——**CI 里是 false**），
而 `ui:probe` 自己在 **5184** 起一个（`bench/ui.probe.mjs:26`）。
在 5181 手工起一个会让 Playwright 再起一个同端口进程、`--strictPort` 直接失败 →
**e2e 在什么都没改的情况下红**。

`probe` 与 `bench` 两个 job 本任务里挂 `continue-on-error: true`，
**并在 workflow 里各写一行注释说明这是首跑取数、下一步会摘掉**。`e2e` 正常阻断。
`timeout-minutes`：`e2e` 20、`probe` 15、`bench` 10。

- [ ] **Step 2: 推上去跑一次，把三个 job 在 runner 上的数字都记下来（Review Focus #5）**

Expected: 三个 job 都出结果。日志里要能看到 `ui:probe` 五条判据与最紧的棋盘像素/占比，
以及 `bench` 的 25 行原始耗时。**若 `ui:probe` 失败，日志必须能区分是「dev server 没起来」
还是「判据没过」**——分不清就先把报错补清楚再继续。

把三件事记进 `docs/TEST_REPORT.md`：Linux 上最紧的棋盘像素与视口占比、判据有无违反、
runner 上 bench 的耗时（特别是那两行 gated 里余量最小的）。

- [ ] **Step 3: 再跑一次，让它们成为真闸门**

**必须第二次观测，不是「Step 2 全过就直接摘」**——最紧的那一行（1440×700 的棋盘占比）
只有 1.7 个百分点余量，一次观测不足以说明它稳。

摘掉两个 `continue-on-error`。**若有过线项：那是产品问题，不是 CI 问题**，
把数字交给用户决定是改布局还是重定阈值；**不要为了让 CI 变绿而放宽判据**。

**若确实需要平台校准**（Linux 的滚动条宽度与字体回退让阈值非调不可）：
那次阈值调整**必须单独一次提交、提交信息里写明「平台校准」**，
不许混在功能改动里——否则「数字改小让 CI 变绿」和「正经修复」在历史里长得一模一样。

- [ ] **Step 4: 更新 AGENTS.md，提交**

`AGENTS.md` 的「提交前」一节改成：本地 `git push` 会被快档拦住；CI 跑全档；
**还要加一条规矩**——它堵的是三条真实存在的静默路径
（`git config core.hooksPath ''` 一键摘掉钩子、往忽略列表再加一个文件、把 `maxBudgetRatio` 从 0.2 调到 0.5，
**三条都不改被检查的代码、都让闸门变弱，而且在 diff 里最不像问题**）：

> **闸门配置文件（`knip.json` / `.jscpd.json` / `bench/baseline.json` / `.githooks/`）
> 的改动是 review 必看项。**工具自己坏了、环境变了，正确动作是**更新钉住的版本并说明**，
> 不是 `--no-verify`，也不是放宽配置。

**并且必须写明这个分层意味着什么**（第 3 轮自审挖出来的最重要一条）：

> 快档**不含** e2e 与 `ui:probe`。所以「本地绿了、推得出去」**不等于**「安全网没缩水」——
> Phase 02 那次「三颗控件从扫描里消失」正是只有 `ui:probe` 能抓到的退化。
> **改了界面结构、布局或扫描范围的人，必须等 CI 全档绿，而不是本地绿了就放心。**

```bash
git add .github/workflows/quality.yml docs/TEST_REPORT.md AGENTS.md
git commit -m "ci: 全档门禁（e2e / e2e:prod / ui:probe / bench:check）"
```

---

### Task 8: 覆盖棘轮（探针扫到的状态与控件不得减少）

**为什么单开一个目录**：这两把棘轮判的是「安全网有没有变小」，既不属于 `bench/`（性能）
也不属于 `e2e/`（测试本身）。塞进任何一个都会让人误会它管的是什么。

**Files:**
- Create: `quality/coverage.baseline.json`、`quality/coverage.ratchet.mjs`
- Modify: `package.json`（scripts）、`README.md`、`vite.config.ts`
- Modify: `.github/workflows/quality.yml`（`probe` job 加一步）

**Interfaces:**
- Produces: `node quality/coverage.ratchet.mjs --baseline <f> --current <f>` ——
  当前覆盖不是基线的**超集**就非零退出并**点名**是哪个状态 / 哪颗按钮；
  `yarn check:coverage` 用两个默认路径

**探针一行都不用改**：它已经把要的东西写进 `measurements.json` 了，
所以棘轮是个**独立脚本读产物**——也因此反向验证只要喂两份小 JSON，不用跑 5 分钟的浏览器。

- [ ] **Step 1: 生成基线（从既有量测裁出来，不要手写）**

从 `docs/ui-redesign/screenshots/after-phase02/measurements.json`（21 状态 / 172 条）
每条只留 `state / size / theme / buttons / headings`。

Expected: 基线里 172 条、21 个状态；`battle-display-settings` 那几条的 `buttons` 各 24 项、
含「显示与声音 / 跟随系统 / 浅色 / 深色 / 显示坐标 / 落子音效」——
**Phase 02 那三颗控件正是会在这里消失的东西**。

- [ ] **Step 2: 写 `quality/coverage.ratchet.mjs`**

比较规则（**只查「不能少」，不查「不能多」**）：

1. 行键 = `state|size|theme`。基线有、当前没有 → 失败，点名那一条。
2. 行键还在的：`buttons` 做集合差、`headings` 按 `level:text` 做集合差。
   少了 → 失败，文案要点名到「**哪个状态、哪个尺寸、丢了哪颗按钮的什么文案**」。
3. 当前**多出来**的状态 / 按钮 / 行 → **不报错**（新增覆盖是好事，棘轮不是锁）。
4. `--current` 指的文件不存在 → **响亮地失败**，不许静默跳过
   （静默跳过就成了一条永远不红的判据，那正是这个仓库吃过亏的地方）。

- [ ] **Step 3: 对真实量测跑一次**

Run: `yarn check:coverage`
Expected: 退出码 0，打印 `172 条 / 21 个状态，覆盖未缩小`

- [ ] **Step 4: 反向验证（三种合成输入，复制真文件再改）**

1. 删掉 `battle-display-settings` 的所有行 → **非零退出**并点名该状态
2. 从某行 `buttons` 里删掉「显示坐标」→ **非零退出**，点名状态+尺寸+丢了什么
3. **新增**一个基线里没有的状态 → **退出码 0**（证明它只查「不能少」）

- [ ] **Step 5: 接进 CI，并处理 watcher**

CI：在 `probe` job 的 `yarn ui:probe --out ci` **之后**加一步
`node quality/coverage.ratchet.mjs --current ci/measurements.json`。

`vite.config.ts` 的 `server.watch.ignored` 加 `'**/quality/**'`——
否则改基线文件会让 dev server 整页刷新（F-30 那一类，`vite.config.ts` 里已有 `docs/`、`e2e/`、`bench/`）。

README 写清这道棘轮判什么、判据从哪来。

- [ ] **Step 6: 提交**

```bash
git add quality/ package.json README.md vite.config.ts .github/workflows/quality.yml
git commit -m "chore(gates): 覆盖棘轮——探针扫到的状态与控件不得减少"
```

---

### Task 9: 测试条数棘轮

**Files:**
- Create: `quality/tests.baseline.json`、`quality/tests.ratchet.mjs`
- Modify: `package.json`（`gates` 里加一条）、`README.md`

**Interfaces:**
- Produces: `yarn check:tests` —— 退出 0/1

- [ ] **Step 1: 生成基线（今天实测过的真值）**

```json
{
  "unitTotal": 912,
  "unitPending": 0,
  "unitTodo": 0,
  "e2eTotal": 102,
  "note": "只许涨。要改这里 = 显式把安全网调小，改动进 diff 并写明理由。"
}
```

- [ ] **Step 2: 写 `quality/tests.ratchet.mjs`**

1. 读 `vitest-report.json`（`yarn test` 落盘的，已在 `.gitignore`）。
   **文件不在 → 响亮失败**，提示「先跑 `yarn test`」——不许静默跳过。
2. 跑 `yarn playwright test --list`，从 `Total: N tests in M files` 取 N。
3. 四条比较，任一不满足即非零退出：`numTotalTests >= unitTotal`、
   `numPendingTests <= unitPending`、`numTodoTests <= unitTodo`、e2e 总数 `>= e2eTotal`。
4. 失败文案要打印**从多少掉到多少**，并说明：删用例与跳用例都是把安全网改小，
   要改就显式改这份基线并写理由。

- [ ] **Step 3: 跑一次，确认绿**

Run: `yarn test && yarn check:tests`
Expected: 退出码 0（前提是刚跑过 `yarn test`——第 2 条硬依赖它）

- [ ] **Step 4: 反向验证（三条）**

1. 临时把 `e2e/a11y.spec.ts` 移出目录 → **非零退出**，点名 e2e 从 102 掉到 N。移回来。
2. 临时给 `src/lib/coords.test.ts` 加一个 `.skip` → **非零退出**（`numPendingTests` 0 → 1）。撤销。
3. 临时删掉 `vitest-report.json` → **非零退出**且提示先跑 `yarn test`
   （证明它**不会**因为读不到报告就静默放行）

- [ ] **Step 5: 接进 `gates`，README 加一行，提交**

`gates` 变成 `check:cycles && check:deadcode && check:dupes && check:tests`
——**试条数棘轮进快档**（钩子里 `yarn test` 就在它前面，数据是现成的）；
`check:coverage` **不进**，它要探针先跑，只在 CI 的 `probe` job 里。
这样钩子与 CI 的形状都不用改。

```bash
git add quality/ package.json README.md
git commit -m "chore(gates): 测试条数棘轮——删用例与跳用例都要显式说明"
```

---

### Task 10: 文档同步与收尾

**Files:**
- Modify: `README.md`、`AGENTS.md`、`docs/TEST_REPORT.md`、`docs/audit/TECH_DEBT.md`

- [ ] **Step 1: 先确认工作区没留下探针文件**

Run: `git status --porcelain`
Expected: 只有本任务预期要改的那几个文档。前面各任务的反向验证会临时造
`src/lib/__cycle-*.ts` / `__dup-probe.ts` 这类文件；**下一步是 `git add -A`，
留一个探针进去就会变成"提交了一道探针"**。有任何意外的文件，查清它是什么再决定。

- [ ] **Step 2: 按 AGENTS.md 的「文档同步」表逐条核对**

README 命令表是否四条新脚本齐全；AGENTS.md 是否写清了「哪条通道跑哪些检查」；
TEST_REPORT 是否记了首跑结果与 `ui:probe` 的 Linux 数字；TECH_DEBT 是否记了
jscpd 那 6 个文件的代价与「这个数字只减不增」。

**顺手修掉两处已经烂掉的数字**（实测：单测 **912**、e2e **102**）：

- `README.md:130` 写「单元 / 组件用例 | **805**（45 个文件）」→ 实测 912
- `docs/TEST_REPORT.md:46` 写「e2e 74 → **100**」→ 实测 102（`playwright test --list`）

这两处正是这件事要消灭的腐败形态：**人肉同步的数字烂了，而没有任何一道门禁读它**。
（数字的权威来源是 `yarn test` 落盘的 `vitest-report.json` 与 `playwright test --list`。）

**还有两处会被这次改动变成假话，同样要改**：

- `docs/audit/TECH_DEBT.md` §1.1 表里「**基准不做断言、无 CI 门禁**」那一行 → Task 4 之后不成立
- `docs/audit/TECH_DEBT.md` §1.3「**无 CI 配置**（后者是产品决策，不是缺陷）」→ Task 6 之后不成立

**另外**：spec 的「待实施者」留了「Playwright 浏览器怎么处理」——**结论是不需要处理**：
两个 playwright 配置都用 `channel: 'chrome'`（系统 Chrome，配置里明说不下载 Chromium），
ubuntu runner 自带。把这句话写进 `docs/TEST_REPORT.md`，免得下一个人去加个没用的 `playwright install`。

- [ ] **Step 3: 全绿收尾**

Run: `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e && yarn e2e:prod && yarn gates`
Expected: 全绿（这套就是门禁自己的内容）

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "docs: 质量门禁的文档同步"
```

---

## 自审记录

三轮自审，每轮换一个视角。**发现的都改了**，没改的写了为什么。

### 第 1 轮 · 规格轴（计划 vs spec 逐条对照）

| # | 发现 | 处置 |
| --- | --- | --- |
| 1-1 | spec 要求三个工具「钉精确版本」，计划写的 `yarn add -D` 默认加 `^` | 改成 `--exact`（已实测 yarn 1 支持 `-E/--exact`） |
| 1-2 | spec 的反目标「快档慢到让人习惯 `--no-verify`」，计划里**没有任何步骤验它** | Task 5 Step 5 加 `time` 量一次，并写明超预算就把检查挪进全档 |
| 1-3 | 一处「若测试文件不存在则跑 `yarn test src/learn`」——含糊 | 换成确切文件名 `src/learn/verify.test.ts`（已确认该文件存在） |
| 1-4 | **计划与 spec 直接冲突**：spec 写「jscpd 阈值不设 0，每次打印克隆清单」，计划写成了「阈值 0 + 逐文件豁免」 | **判定计划更好，回头改了 spec**，并在 spec 里留了一段说明为什么改主意。理由：打印清单不会有人看，「0.84% 悄悄涨到 0.95%」正是那种看得见但没人看的东西；零容忍 + 显式豁免把「接受一处重复」变成**一个进 diff 的决定** |

### 第 2 轮 · 事实轴（计划里的命令、键名、路径在真实仓库成不成立）

这一轮抓的是**写错不会报错、只会让闸门静默失效**的那类错。

| # | 验证项 | 结果 |
| --- | --- | --- |
| 2-1 | jscpd 配置文件的键名 | **实测通过**：`path:["src"]`／`minTokens`／`threshold`／`ignore` 全部生效（故意设 `threshold:0.0001`，如期报 `ERROR: jscpd found too many duplicates (0.8%) over threshold`）。同时确认 `--config` 是 `-c, --config` |
| 2-2 | `git push --dry-run` 到底触不触发 pre-push | **实测触发**，且钩子 `exit 1` 确实拦得住（Task 5 的验证手段本身是可靠的） |
| 2-3 | knip 的 `ignoreIssues` 键名 | **没验成**（knip 的 help 只列了 `-c, --config` 与默认文件名）。→ 不硬猜：把 Task 2 Step 5 的 Expected 改成「退出码 0 **且没有配置警告**」，键名写错会被这一步抓住 |
| 2-4 | `yarn test` 是不是 watch 模式 | 是 `vitest run` —— **钩子不会挂死**（如果是裸 `vitest`，pre-push 会永久卡住） |
| 2-5 | pre-push 跑 `yarn build` 会不会污染工作区 | `dist` 与 `bench/last-run.json` 都已在 `.gitignore` ✓ |
| 2-6 | madge 只扫 `src/`，`bench/`、`e2e/` 不在内 | 写进 README 那一行，别让人以为全仓都查过 |

### 第 3 轮 · 对抗轴（这道闸门会不会变成噪声、能不能被绕过、留了什么洞）

| # | 发现 | 处置 |
| --- | --- | --- |
| **3-1** | **最重要的一条**：快档**不含** e2e 与 `ui:probe`。而用户担心的那件事（Phase 02 三颗控件从扫描里消失）**恰恰只有它们能抓到**。「本地绿了、推得出去」会被误读成「没问题」 | 写进 Task 7 Step 4 要落进 `AGENTS.md` 的话：**改了界面结构/布局/扫描范围的人，必须等 CI 全档绿** |
| **3-2** | `bench:check` 被排在 full job 里与 e2e 串跑。它是**唯一对机器速度敏感**的判据——机器忙会被误报成算法变慢 | 拆成**独立 job**，独占机器 |
| 3-3 | `threshold:0` 的未来后果：新写一个与现有页面同形的页面会被拦 | 这是**刻意的**，已写进 spec：逼人做一次「重复还是同形」的判断，并写明判断结果怎么落地 |
| 3-4 | 反向验证会留下临时探针（`__cycle-a.ts`、`__dup-probe.ts`），而 Task 8 用的是 `git add -A` | 各任务的提交步骤本来就逐个列路径；Task 8 加一步 `git status --porcelain` 先查干净 |
| 3-5 | 升级 knip 会让那几十条基线变化 | 在 `TECH_DEBT.md` 写明：升级 knip 的人必须重跑并更新基线，不能把新冒出来的条目当噪声 |

### 终审 · 独立子代理（规格轴 + 怀疑轴并行）

两个代理，各自独立，结论分开列。**每一条我都自己复核过**才写进下面。

#### 规格轴找到的（均为实测复现）

| # | 发现 | 我的复核 | 处置 |
| --- | --- | --- | --- |
| S1 | **Task 3 的反向验证是假的**：`cx.ts` 只有 4 行，而 jscpd 有默认 `minLines`，复制它**一个克隆都找不到**——那一步会保持绿色 | 复核 `cx.ts` = **4 行** ✓ | 换成 29 行的 `theme.ts`；并把 `minLines: 5` 显式写进配置 |
| S2 | Task 7 的 dev server 前提**两头都错**：探针自带 5184；手工在 5181 起一个会让 Playwright 的 webServer 因端口被占直接失败 | 复核 `ui.probe.mjs:26` = 5184 ✓、`playwright.config.ts` `PORT=5181` + `reuseExistingServer:!CI` ✓ | 删掉起 server 那一步；**spec 里同样的错也改了** |
| S3 | `ignoreIssues` **不能按符号名忽略**（形状是「glob → 问题种类」），计划里的机制根本不存在，会响亮报错逼实施者临场改法 | 独立查 knip 官方文档确认 ✓ | 整份手工基线删掉，换成 `ignoreExportsUsedInFile` 对象形式 + `@public` |
| S4 | 断言集来源与 spec 不一致：spec 要逐行 `gated`，计划现算，而现算会因调预算而**无声缩小断言集** | 复核公式复算结果一致（19/6） | `budgetMs` 与 `gated` **冻结进基线文件** |
| S5 | 三处既有文档会变成假话：`README:148`、`TECH_DEBT` §1.1、§1.3 | 复核三处原文 ✓ | 写进 Task 4 / Task 8 的清单 |
| S6 | `git update-index --chmod=+x` 在 `git add` **之前**跑会 128 报错 | 代理有复现；改动本身无争议 | 写明顺序，并给出 `--add --chmod=+x` 写法 |
| S7–S11 | 「五条/六条」计数打架；Task 5 列了 `AGENTS.md` 却一步没改（`git add` 空操作）；spec 表里「≤123 / ≤12%」两个上界都不对（真值 212 / 12.3%）；门禁只防一个方向（新增局面静默不进断言集）；`yarn gates` 漏进 README | 逐条复核 ✓ | 全部已改 |

#### 怀疑轴找到的（这条最重）

**G1：探针看不见自己的覆盖缩水——设计要防的那件事，恰好是它防不住的。**

我核实了源码：`checkCriteria(rows)` 只吃本次的行（`ui.probe.mjs:1037`），
`:1048` 对 `board` 缺失**直接跳过判据**，而全仓唯一读 `measurements.json` 的地方（`:826`）
是「拒绝覆盖基线」的守卫，**不是比对**。所以：从 `STATES` 里删掉一个状态、
或某颗控件从 DOM 里消失 → 探针少几行量测 → **全绿**。
Phase 02 那次事故的形态可以原样复现。

**这条我没有自己决定**——它改变要建的东西，且多一份需要维护的基线文件，属于用户的决定。
**用户的裁定（2026-10-13）：两把棘轮都加**（探针覆盖 + 测试条数），
落成上面的 Task 8 与 Task 9。

其余已处置的：G4（基准门禁只锁 search 的 depth/nodes，`threat`/`vct`/`evaluate` 裸奔——
我核了产物 schema，那些字段确实是机器无关的布尔与整数，**已补判**）；
F1/F2/F5（Linux 滚动条与字体可能把 620px / 36.7% 推过线、25 分钟超时太紧——
**已改成三个 job + 首跑取数 + 平台校准必须单独提交**）；
F4（knip 的 9 vs 10 可能不是版本漂移而是运行间不确定——**Step 5 改成连跑三次逐字节比**）；
腐化路径（调预算间接缩小断言集——**已冻结**；jscpd 豁免列表单向增长——**要求 TECH_DEBT 里写"只减不增"**）。

**G3 我自己实测验证了**（怀疑轴只给了推测）：jscpd **只认逐字相同的克隆**。
逐字复制 `Found 1 clones`；把所有标识符改名、结构完全保留 → **`Found 0 clones`**。
已作为**明写的局限**进 README 与 spec：它是复制粘贴检测器，不是「重复实现」检测器。
