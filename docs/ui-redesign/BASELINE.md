# UI/UX 改版 · 基线（Phase 00）

本文件记录**改版开始那一刻**仓库与界面的真实状态，是后续所有「改好了没有」的对照点。
里面的每一个数字都来自本机实跑，没有一处是估的；跑法与产物路径写在文末，可以逐条复跑。

**本阶段未改动任何产品代码。** 唯一的仓库新增是可复跑的探针 `bench/ui.probe.mjs`
与它产出的截图，见 §6。

---

## 1. 审计对象

| 项 | 值 |
| --- | --- |
| 分支 | `main` |
| HEAD | `afcab74c60146e76d2265ecf103e3acd34cb29ce` |
| 提交标题 | `docs(usage): 按真实界面重写使用说明，补齐缺的、改掉不准的` |
| 工作区 | 干净（`git status --porcelain` 无输出） |
| 已跟踪文件 | 未跟踪的 `dist/`、`test-results/`、`vitest-report.json`、`.playwright-mcp/` 均已被 `.gitignore` 覆盖 |

工作区干净，因此不存在「覆盖未提交改动」的风险。审计全程未执行任何写仓库的 git 操作。

## 2. 环境与工具链

| 项 | 值 |
| --- | --- |
| OS | macOS 26.6.2（Build 25G83），arm64 |
| CPU / 内存 | Apple M3，8 核 / 16 GiB |
| Node | v26.11.1 |
| 包管理器 | yarn 1.22.22（`AGENTS.md` 固定 yarn） |
| 浏览器 | Google Chrome 155.0.8059.39（Playwright 与探针都用本机 Chrome，不下载 Chromium） |

`node_modules` 里实际解析到的版本（不是 `package.json` 的范围）：

| 包 | 版本 | 包 | 版本 |
| --- | --- | --- | --- |
| react / react-dom | 19.3.0 | vite | 8.3.4 |
| zustand | 5.0.15 | vitest | 5.0.3 |
| typescript | 6.0.3 | @playwright/test | 1.64.0 |
| tailwindcss | 4.3.3 | oxlint | 1.87.0 |
| @testing-library/react | 16.3.3 | jsdom | 30.1.2 |

## 3. 基线命令的实跑结果

按 `AGENTS.md` 的提交前清单顺序逐条跑，全部在一次会话内、机器基本空载时完成。

| # | 命令 | 退出码 | 结果 | 耗时 |
| --- | --- | --- | --- | --- |
| 1 | `yarn lint` | `0` | oxlint 无任何输出（零告警零错误） | 0.20 s |
| 2 | `yarn typecheck` | `0` | `tsc -b` + e2e + bench 三个 project 全过 | 2.82 s |
| 3 | `yarn test` | `0` | **45 个文件 / 805 条用例全过**，0 失败 | 19.40 s |
| 4 | `yarn build` | `0` | 85 个模块，产物见下 | 1.94 s |
| 5 | `yarn e2e` | `0` | **46 条全过**（桌面 32 + 移动触屏 7 + 平板触屏 7） | 1.1 min |
| 6 | `yarn e2e:prod` | `0` | **5 条全过**（自带一次 `yarn build`） | 15.7 s |

**没有任何一条是带病通过的**：不存在被跳过的用例、被 `.skip` 的套件或已知的 flaky 重跑。

### 3.1 构建产物（`yarn build`）

```
dist/index.html                   0.65 kB │ gzip:   0.43 kB
dist/assets/worker-N-PbjJma.js   11.77 kB
dist/assets/index-SY5WzUy5.css   29.26 kB │ gzip:   6.52 kB
dist/assets/index-IpBS3a-6.js   322.01 kB │ gzip: 102.01 kB
✓ built in 148ms
```

### 3.2 单元测试里最慢的 6 个文件

数字取自 §3 那次全量跑的 `vitest-report.json`（机器空载）：

| 文件 | 空载 | 负载中（同一份代码，另一次全量跑） |
| --- | --- | --- |
| `src/ai/selfplay.test.ts` | 17.6 s | **25.0 s** |
| `src/components/board/Board.test.tsx` | 4.5 s | **8.4 s** |
| `src/features/learn/screens.test.tsx` | 2.3 s | 4.5 s |
| `src/features/learn/PracticeBoard.test.tsx` | 1.7 s | 2.7 s |
| `src/ai/difficulty.test.ts` | 1.7 s | 2.3 s |
| `src/ai/search.test.ts` | 1.6 s | — |

**两列都要留着，因为它们的差就是结论**：同一份代码，`selfplay` 在机器被别的任务压住时
从 17.6 s 变成 25.0 s（+42%），`Board.test` 从 4.5 s 变成 8.4 s（+87%）。
这解释了 `vite.config.ts` 为什么把超时从 5 s 放宽到 15 s——负载下的假红比真红更贵。

**读这一节要先跑一次全量 `yarn test`**：`vitest-report.json` 是**每一次**跑测都整份覆写的
（单跑一个文件也会覆盖它，`vite.config.ts` 里没有「只有全量才写」的开关）。
本文件写作期间就因为中途单跑了一条 `contrast.test.tsx`，让那个文件一度只剩 8 个套件 / 57 条。

改版会动到 `Board` / `screens` / `PracticeBoard` 三个文件对应的组件，
**这三条的耗时是改版后的回归参照**（都按空载那一列比）。

## 4. 受控界面状态（19 个）

截图不能靠「打开应用随手拍」——那样两次拍到的不是同一个界面，改版前后就没有可比性。
所以每个状态都由 `bench/ui.probe.mjs` **用受控夹具构造并断言到位**：

| 组 | 状态 | 怎么造出来的 |
| --- | --- | --- |
| 对战 | `battle-empty` | 清空存档，默认人机 / 执黑 / 初级 |
| 对战 | `battle-midgame` | 30 手存档，轮到玩家 |
| 对战 | `battle-thinking` | 11 手散局 + 专家档，轮到 AI（实测能搜满 2604 ms） |
| 对战 | `battle-hint` | 30 手存档 + 点「求提示」，等候选与棋盘标记出现 |
| 对战 | `battle-finished` | 9 手存档，末手黑棋成五，终局弹窗自动弹出 |
| 对战 | `battle-ai-error` | Worker 桩（一 `postMessage` 就回 error）+ 29 手存档 |
| 对战 | `battle-finish-unsaved` | 关掉 IndexedDB + 播 8 手，由页面点下第 9 手 |
| 教学 | `learn-list` / `learn-list-done` | 进度 `lastView: 'learn'`，完成 0 节 / 5 节 |
| 教学 | `learn-diagram` | 恢复第 1 课，翻到带棋盘演示的第 2 页 |
| 教学 | `learn-practice` / `-wrong` | 翻到练习页；后者故意走 (0,0) 触发判错 |
| 残局 | `puzzle-list` | 进度 `lastView: 'puzzles'` |
| 残局 | `puzzle-wrong` / `puzzle-correct` | 打开「横向补满」；正确那一张**先点三次提示、从棋盘标记上读坐标再点**，不写死答案 |
| 复盘 | `review-empty` / `review-library` | IndexedDB 里 0 条 / 3 条棋谱 |
| 复盘 | `review-replay` / `review-analysis` | 打开 9 手那局并走到末手；后者再等分析跑完 9 / 9 |

### 4.1 三套手顺夹具，都经过校验

手顺不是随手编的——`bench` 之外另有一份**校验器**（一次性使用，未入库）逐个检查：
无重复落子、无提前成五、以及**「五连窗口内不能有 4 子」**（间断四同样是下一手就成五，
会让引擎走「必防」捷径，思考态根本拍不到）。

| 夹具 | 手数 | 校验结论 |
| --- | --- | --- |
| `MIDGAME` | 30（黑 15 / 白 15） | 双方最长连子 3，无成五点 |
| `BLACK_WINS` / `WHITE_WINS` | 9 / 10 | 只在末手成五 |
| `SPARSE` | 11 | 子与子相隔 2 格以上，**零个四子窗口** |

`SPARSE` 是专门为「AI 正在思考」造的：实测它让专家档跑满
**2604 ms / 深度 5 / 8666 节点**（`reason: timeout`）。换成中局那张夹具时，
白棋存在一条 **3 手算杀**，`findForcedWin` 一走 VCF 就在 **1–4 ms** 内返回
（`reason: win`），「思考中」在屏上留不住——这一条是量出来的，不是推断
（当时的判据是 AI 面板显示「判断 直接取胜 · 耗时 4 ms」）。

探针对这个状态额外加了一道 `postAssert`：**截完图再确认一次状态条上还写着
「AI 思考中…」**，否则响亮地失败。没有这道复核时它拍到的是「AI 已经落子」的下一帧，
图看着正常、状态却是错的。

### 4.2 视口矩阵

| 维度 | 取值 | 说明 |
| --- | --- | --- |
| 宽度 | 390 / 768 / 1024 / 1280 / 1440 / 1920 | 任务书指定的六档 |
| 高度 | 390 → 844，其余 → 900 | |
| 矮窗口 | 1280×680、1440×700 | 只对 `battle-empty` 与 `battle-midgame` 补拍，避免上百张重复图 |
| 主题 | 浅色（全部六档）+ 深色（390 与 1440） | 主题由设置项落地，不靠 `prefers-color-scheme` |
| 像素比 | 1 | 截图尺寸 = CSS 像素尺寸，便于按 px 核对 |

合计 **19 个状态 / 156 张截图**。设备像素比取 1 是有意的：要按 CSS 像素核对字号与命中区。

## 5. 量测：与截图同时采的一组 DOM 事实

截图能看出「不好看」，看不出「棋盘只有 169 px」「命中区只有 21 px」。
所以每次截图都在**同一帧**上采一组数字，写进 `measurements.json`：

| 字段 | 是什么 |
| --- | --- |
| `document` / `regions` | 文档滚动尺寸、`header` / `main` / `aside` 的矩形与 `grid-template-columns` |
| `board` / `boardRatioOfViewport` | 棋盘 SVG 的矩形，以及它占视口宽度的百分比 |
| `boardDetails` | 坐标标签与交叉点命中区的**实际 CSS 像素尺寸** |
| `fontHistogram` / `typeSamples` | 真实渲染的字号分布，以及「字号 / 行高 / 颜色 / 字重」的组合清单 |
| `contrastViolations` | 逐元素算出的对比度（沿祖先链合成有效背景），低于 AA 阈值的全列出来 |
| `smallTargets` | 小于 44×44 的可交互元素，并标出是否连 24×24 都不到 |
| `overflowing` / `clipped` / `scrollContainers` | 越界、被裁切、以及**纵向装不下要滚动**的容器 |
| `headings` / `buttons` | 可见的标题层级与按钮文案，用来审信息架构 |
| `spinner` | 状态药丸里那个转圈的 `animation-name` 与时长 |
| `metaThemeColor` | `meta[name=theme-color]` 的当前值（F-UI-17 的证据） |
| `statusPill` | 状态条文案，用来核对「这一张图确实是那个状态」 |

对比度与命中区的算法（有效背景合成、相对亮度、AA 阈值、24 px 下限）都写在
`bench/ui.probe.mjs` 的 `MEASURE` 里，读得到、改得动。

## 6. 产物与复跑

```
bench/ui.probe.mjs                         探针本体（`yarn ui:probe`）
docs/ui-redesign/screenshots/before/       156 张截图
docs/ui-redesign/screenshots/before/measurements.json   156 条量测
```

命名规则：`<组>-<状态>__<视口>-<主题>.png`，例如
`battle-battle-midgame__1024-light.png`、`review-review-analysis__390-dark-dark.png`。

```bash
yarn ui:probe                              # 全部 19 个状态 × 视口矩阵
yarn ui:probe battle-thinking              # 只跑指定状态（位置参数即状态名）
yarn ui:probe battle-thinking --merge      # 只重拍它，并把结果并回 measurements.json
yarn ui:probe --out after-phase01          # ← 改版期间用这个，别把基线覆盖掉
```

**`--out` 不是可选项**，而这一点**不靠人记性**：探针在不带 `--out`、且
`before/measurements.json` 已存在时会直接拒绝开跑（退出码 2），并打印正确的命令。
只有显式给 `--force` 才允许重拍基线。写下这条闸门的原因很直接——
「在文档里写一句记得加 `--out`」挡不住手滑，而基线被覆盖是不可逆的。

产物体积：**156 张 PNG 共 27.4 MiB**（平均 180 KiB，最大 572 KiB）。
仓库原有 `docs/screenshots/` 是 6.4 MiB、`.git` 是 15 MiB，所以这一份约等于把
截图资产翻了两番。它是有意的取舍——改版前后逐张对照是后面七个阶段的验收手段，
少拍就等于少一份对照。**若要收窄，应整体降采样（例如只留 1440/390 两档），
而不是挑着留一部分**：挑着留会让「一一对应」在 Phase 07 无从校验。

探针自己拉起 dev server（端口 **5184**，与 e2e 的 5181、生产冒烟的 5182、
渲染探针的 5183 都错开），跑完自己关掉。它落在 `bench/` 下是刻意的：
`vite.config.ts` 的 watcher 白名单已排除 `bench/**`，跑探针期间改文件不会把页面刷掉
（那是 F-30 那类假红灯的来源）。

**改版之后带上 `--out` 重跑一遍，产物就是一份同口径的对照**——
同一批状态、同一批视口、同一套量测字段，只换了代码。

## 7. 本阶段**没有**做的事

- 没有改任何产品代码（`src/` 一行未动）。
- 没有覆盖 `docs/audit/` 下的历史审计记录，也没有覆盖 `docs/screenshots/` 下的阶段截图。
- 没有动 `docs/ROADMAP.md` 里既有的五个阶段结论，只在末尾追加了 UI 改版的入口。
- 没有引入新的运行时依赖。
- 探针字段没有为「以后可能要用」而加：`MEASURE` 里每一项都被 `FINDINGS.md` 的某一条引用
  （`contrastViolations` → §5、`boardDetails` → F-UI-01/10/14、`scrollContainers` → F-UI-03、
  `metaThemeColor` → F-UI-17、`spinner` + `reducedMotion` → F-UI-07、`smallTargets` → F-UI-09、
  `clipped` → F-UI-26、`headings` → F-UI-11、`typeSamples` → F-UI-15）。
  两处例外如实列出：`statusPill` 与 `counts` 是核对与汇总用的，
  不作为任何结论的判据——留着的理由是「一张图对不对得上状态，得有个字段能证明」。

## 8. 基线的局限

如实列出，避免把这份数据当成比它本身更强的东西：

1. **量测都是单次采样**：每个组合只采一帧。字号、命中区、对比度这类几何量是确定性的，
   重复采样不会变；但**没有做多次采样的抖动分析**。
2. **对比度只覆盖纯色背景**。祖先链上只要有 `background-image`（棋盘木纹、品牌标记的渐变）
   就如实跳过，不猜。棋盘上的 SVG 文字（坐标、编号徽标）因此全在覆盖之外——
   它们由仓库自己的 `lib/contrast.test.tsx` 单独守着。
3. **命中区量的是 DOM 矩形**，量不到「手指够不够得着」。20 px 的交叉点在物理屏幕上
   到底多难戳，探针给不出结论，只能给尺寸。
4. **`battle-ai-error` 与 `battle-finish-unsaved` 两个状态用了桩**（不会回应的 Worker、
   抛错的 `indexedDB`）。截图里的 DOM 全是应用自己的错误路径渲染的，桩只负责触发，
   但这两个状态**不等于**真实故障现场的全部表现。
5. **深色主题只采了 390 与 1440 两档**。中间几档的深色是按 CSS 变量推的，没有逐张看。
6. 探针只跑 **dev server**。生产构建的渲染差异由 `yarn e2e:prod` 那条通道负责，
   它验的是行为不是外观。
