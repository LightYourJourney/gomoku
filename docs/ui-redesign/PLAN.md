# UI/UX 改版 · 分阶段实施计划（Phase 00 → 07）

依据：[FINDINGS.md](FINDINGS.md) 的 28 条发现 + [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) 的规范。
基线：[BASELINE.md](BASELINE.md)，含 156 张截图与 156 条量测。

> **⚠️ 这份编号与后续任务书不是同一套。**
>
> 本文件按「布局 → 排版 → 信息密度 → 棋盘 → 状态 → 无障碍 → 收官」切；
> 而任务书（Phase 01 起）按「令牌与组件 → 对战布局 → ……」切。
> 两套的对应关系与实际进展记在 [PHASE_01.md](PHASE_01.md) 的 §九。
>
> **`PLAN.md` 现在只当「28 条发现各自归谁」的索引**，不再代表执行顺序。
> 要盯的是「每条发现恰好被一个阶段认领」——截至 Phase 01 结束，
> 仍未认领的只有 F-UI-02 与 F-UI-16，两条都建议归任务书的 Phase 02（对战页布局）。

---

## Phase 00 · 基线与规范（本阶段，已完成）

**交付。** 基线实跑记录、19 个受控状态的 156 张截图与量测、28 条发现、设计规范、本计划。
新增可复跑的探针 `bench/ui.probe.mjs`（`yarn ui:probe`）。

**未做。** 未改任何产品代码；未覆盖历史审计与阶段截图；未引入依赖。

**结论摘要。** 对比度、键盘可达性、错误恢复三项**没有发现缺陷**；
问题集中在布局（1 条 P0、1 条 P1）与信息密度（1 条 P1）。

---

## 每个阶段的统一门槛（先定好，再开始）

以下六条对 Phase 01–06 一律适用，各阶段不再重复：

1. **先写会红的测试再改。** 改了 `core` / `ai` / `store` / `persist` 的行为必须如此
   （`AGENTS.md` 已规定）；改布局则必须补一条**真实浏览器**的 e2e 断言并做反向验证
   （撤掉修复确认它会红）。
2. **命令以 `AGENTS.md` 的「提交前」为准**（不复述，避免两处各说各话）：
   五条 `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e`，
   **阶段收尾再加 `yarn e2e:prod`**——每个 Phase 都是一个阶段，所以每一个都要跑它。
   （`AGENTS.md` 给 `e2e:prod` 的理由是 CSS 打包与代码分割只在构建后才不一样，
   Phase 02 全程在改 Tailwind 类名，正是它要守的东西。）
3. **重跑探针并逐张对照**：`yarn ui:probe --out after-phaseNN`，与 `before/` 比对，
   差异写进该阶段的记录。探针**已经会拒绝覆写 `before/`**（不带 `--out` 直接退出码 2），
   所以这条不靠人记性。
4. **五条量化判据**（都能从 `measurements.json` 直接判真假，
   与 `DESIGN_SYSTEM.md` §12 逐条一致，改一处要同步另一处）
   ——这是 **Phase 01 定下的五条**；**Phase 03 又补了两条**（网格线设备像素宽度、最后一手与
   标记文字的对比度），现在共 **七条**，以 `bench/ui.probe.mjs` 的 `checkCriteria()` 与 §12 为准：
   - `contrastViolations` 全 0；
   - `board.w` 与 `board.h` ≥ 320（全部状态、全部视口）；
   - `boardRatioOfViewport` 在任何 ≥1024 的视口下 ≥ 35%；
   - `document.horizontalOverflow` 全 `false`；
   - `smallTargets` 里 `under24` **只允许剩下棋盘交叉点**（`rect[intersection-*]`），其余为 0。

   最后一条为什么要给棋盘开口子：一格 = 棋盘/16，390 px 屏幕上即使满幅也只有约 24 px，
   **棋盘永远过不了 24 px 这条线**，而规范又明令不许放大命中区。
   一条永远红的判据会被当成噪声——那正是 F-UI-01 得以存活的同一种失效模式。
   棋盘的安全由前两条单独守。

   Phase 05 起再加一条：`reducedMotion.stillAnimating` 为空数组。
5. **文档同步**：改动落到哪一层就更新哪份文档（`AGENTS.md` 的表格）。
   阶段进度追加到 `docs/ROADMAP.md`。
6. **一次只做一个阶段**，做完验收再进下一个。

---

## Phase 01 · 布局地基与回归守护

**这一阶段的定位**：把 P0 与布局类问题一次修完，并给「布局量级」补上守护。
**不引入任何新的视觉语言**——只改几何，不改颜色、字号、组件结构。

### 目标与范围

| 发现 | 内容 | 修法 |
| --- | --- | --- |
| F-UI-01 (P0) | 教学 / 残局 / 复盘三页 `lg:grid-rows-[auto_minmax(0,1fr)]` 导致棋盘塌陷 | 删掉这条模板。**已用注入 CSS 在真实浏览器里验证**：学习练习页 169 → 630/736 px（3.7–4.4×），讲解页 330 → 736 px |
| F-UI-02 (P1) | 对战页 1024–1279 棋盘被固定宽度侧栏压到 35–48% | 侧栏改 `clamp(220px,18vw,300px)` / `clamp(280px,24vw,380px)`。**已试算**：1024 下 362 → 474 px（35.4% → 46.3%），1440 持平，四档均无横向溢出。**执行时取的是 `clamp(240px,18vw,300px)` / `clamp(300px,24vw,380px)`**（`DESIGN_SYSTEM.md` §10.1 与 `BattleScreen.tsx`；下限抬了 20px），上面那组试算数按旧下限算的 |
| F-UI-05 (P1) | 布局量级没有 e2e 守护 |
| F-UI-08 (P2) | 复盘页标题在 390 下一字一行 |
| F-UI-16 (P2) | 窄屏「标签 —— 值」被拉到整宽两端 |
| F-UI-20 (P3) | 移动端顶栏导航左对齐留空 |
| F-UI-21 (P3) | 顶栏在列表页随内容滚走、在对战页固定 |

### 预期修改文件

| 文件 | 改什么 |
| --- | --- |
| `src/features/learn/LessonView.tsx:62` | 删 `lg:grid-rows-[auto_minmax(0,1fr)]` |
| `src/features/puzzles/PuzzleScreen.tsx:147` | 同上 |
| `src/features/review/ReplayBoard.tsx:44` | 同上 |
| `src/features/battle/BattleScreen.tsx:132` | 三栏列宽改 `clamp()`；`InfoRow` 加最大宽度 |
| `src/components/board/BoardStage.tsx` | 棋盘最小尺寸兜底 + 让位规则注释 |
| `src/features/shell/AppHeader.tsx:137` | 导航在窄屏铺满（`justify-between` 或 `flex-1`） |
| `src/features/learn/LearnScreen.tsx:70` / `src/features/puzzles/PuzzleScreen.tsx:54` | `AppHeader` 移出滚动容器（与 `ReviewScreen` 对齐） |
| `src/features/review/GameLibrary.tsx:46` | 标题与说明换行 |
| `e2e/layout.spec.ts` | **新增**：布局预算断言 |

### 用户可观察到的变化

- 桌面上打开教学 / 残局 / 复盘，**棋盘回到正常大小**（1440 下 169 px → 约 700 px）。
- 1024–1279 的笔记本上，对战页棋盘明显变大（362 px → 约 500 px），侧栏先窄下来。
- 手机上看复盘页，标题正常横排。
- 教学 / 残局的列表页，顶栏不再跟着内容滚走。

### 风险与依赖

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 删掉 `grid-rows` 后侧栏不滚动 | `aside` 的 `overflow-y-auto` 需要父级 `min-h-0` 链完整才生效 | 真实浏览器逐档复核右栏能否滚到底 |
| 棋盘容器尺寸变化 | `BoardStage` 是 `container-type: size`，任何高度链变化都会改棋盘大小 | 用 `ui:probe` 的 `board` 字段逐档核对 |
| 侧栏 `clamp()` 抖动 | 窗口拖动时列宽连续变化，可能出现 1px 级跳动 | 用 `vw` 而非 `%`，并在 1024/1100/1279 三档各截一张 |
| 顶栏移出滚动容器 | 会改变页面高度分配，可能让列表页出现双滚动条 | 复核 `document.scrollHeight` 与容器 `scrollHeight` |

**依赖**：无。这是第一阶段。

### 验收标准

1. `yarn ui:probe --out after-phase01` 后，`measurements.json` 满足：
   - 全部 19 个状态、全部视口 `board.w ≥ 320`；
   - `learn-practice` / `puzzle-wrong` / `review-replay` 在 1024 / 1280 / 1440 / 1920 下
     `board.w ≥ 620`，且 `boardDetails.intersectionHit` **不再出现 11×11**；
   - `battle-midgame` 在 1024 下 `boardRatioOfViewport ≥ 45%`。
2. `e2e/layout.spec.ts`（本阶段新增）覆盖下面**五条**，全绿且逐条**反向验证过**
   （撤掉对应修复，它必须变红）：

   | # | 断言 | 守哪一条 |
   | --- | --- | --- |
   | 1 | 棋盘 ≥ 320 px 见方 | F-UI-05 |
   | 2 | ≥1024 时棋盘占中列宽 ≥ 70% | F-UI-05 |
   | 3 | 390 下复盘页 `h1` 的 `boundingBox().width > 60`（不再一字一行） | F-UI-08 |
   | 4 | 列表页滚动到底之后，顶栏的 `boundingBox().y` 不变 | F-UI-21 |
   | 5 | 390 下顶栏导航占满整行（导航右边缘与 header 右边距之差 ≤ 24 px） | F-UI-20 |

   第 3 条**不能靠探针**：`headings` 只产出 `{level, text}`，没有宽度，
   写进探针判据是一条判不了真假的断言。F-UI-16（窄屏标签值跨整宽）同理只做
   截图目视——它是观感问题，没有可断言的阈值，**这一条如实标注为「本阶段只目视，不设断言」**。
3. 「右栏不得溢出」**不在本阶段的判据里**：它是 Phase 03 的目标
   （Phase 02 的字号变大会先把它推高，见 Phase 02 风险表）。
4. 六条统一门槛全过。

### 回归测试范围

- 全量单测（805 条）——本阶段不应改任何组件逻辑，一条都不该红。
- `e2e` 全项目（46 条）+ `e2e:prod`（5 条）。
- `ui:probe` 全部 19 个状态 × 6 档宽度的截图逐张目视（重点：`learn-*`、`puzzle-*`、`review-*`）。

---

## Phase 02 · 排版、间距与圆角体系

**定位**：把 `DESIGN_SYSTEM.md` §3 / §4 / §5 从纸面落到代码。机械面最大，
但改动都是「换类名」，不改结构、不改行为。

### 目标与范围

| 发现 | 内容 |
| --- | --- |
| F-UI-15 (P2) | 面板标题（12px）比面板内正文（14px）还小；11px 阅读性文字 18 处 |
| F-UI-25 (P3) | 圆角 6 种、间距 20+ 处不在 4px 栅格上 |

### 预期修改文件

- `src/index.css`：把六级字号写成令牌（`--text-page` / `--text-section` / …）并暴露给 Tailwind；
- `src/components/ui/*.tsx`（`Panel` / `Button` / `Segmented` / `Switch` / `Modal`）；
- 全部 `text-[11px]` 使用点（实测 18 处，集中在 `AiPanel` / `HintPanel` / `ReviewScreen` / `SettingsPanel`）；
- 全部非 4 倍数间距（`p-3.5` / `px-2.5` / `gap-2.5` / `py-1.5` / `gap-1.5`）与 `rounded-[10px]`。

### 用户可观察到的变化

- 面板标题更容易定位（12 → 13 px），说明文字不再小到需要凑近看。
- 卡片、按钮、徽标的圆角不再是六种混用；元素间距看起来更整齐。

### 风险与依赖

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| **字号变大 → 面板变高 → 右栏溢出加剧** | 11 → 12 px 会让段落长高约 9% | 本阶段**只记录**溢出数字，由 Phase 03 的渐进披露收口；验收里不要求「右栏不溢出」 |
| 间距吸到栅格会改变大量布局 | 44 个文件里有 20+ 处 | 逐类替换（间距 → 圆角 → 字号），每类跑一次全量测试与探针 |
| 字号令牌化引入新抽象 | 与「不为抽象而抽象」冲突的风险 | 只做**映射**不做新体系：令牌值就是现有 Tailwind 值，不新增字号 |

**依赖**：Phase 01（布局稳定之后才谈字号，否则两次都要重跑探针）。

### 验收标准

1. `fontHistogram` 中：**11px 出现次数 ≤ 1**（品牌副标题），且不得出现在 `p` 元素上。
2. `rounded-*` 的取值只剩 `md`/`lg`/`xl`/`2xl`/`full` 五种；
   `p-3.5`/`px-2.5`/`gap-2.5`/`py-1.5` 在 `src/**/*.tsx` 中 0 处。
3. `contrastViolations` 仍为 0（字号变了，对比度不能跟着变差）。
4. `lib/contrast.test.tsx` 全绿。

### 回归测试范围

- `lib/contrast.test.tsx`（必跑，字号与颜色联动）
- 全部组件测试（`Panel` / `Button` / `Segmented` / `Switch` / `Modal` 的用例会直接受影响）
- `ui:probe` 全部截图逐张目视——**这一阶段的回归主要靠眼睛**，量测只能证明没超出阈值

---

## Phase 03 · 信息密度与渐进披露

> **实际执行的 Phase 03 不是这一份。**
>
> 后续任务书下发了另一份「Phase 03 — 棋盘质感、交互反馈和 AI 信息呈现优化」，
> 与本节的交集只有 **F-UI-03（AI 面板的渐进披露）** 一处。按「任务书是本次指令」的口径，
> 执行的是任务书那一份，完整记录见 [PHASE_03.md](PHASE_03.md)。
>
> 本节的其余四条（**F-UI-13** 难度改纵向列表、**F-UI-22** 棋谱补难度、
> **F-UI-26** 课程摘要、**F-UI-27** `Segmented.hint`）当时留给了后续阶段，
> **后来在同一个 Phase 03 的第二轮里全部做完**（见 `PHASE_03.md` §15.2）；
> `PLAN.md` Phase 04 的 **F-UI-12**（判题标记的「1」）也一并做了。
> 下面这段验收标准 1 的两行已在执行那一份时顺带达成（实测：
> `battle-midgame` @1440 右栏溢出 **0**；`battle-hint` @1440 的 `棋谱` 顶边 **605** ≤ 750），
> 依据是探针新补的 `headings.top`——此前那条判据**根本没有可读的几何数据**，判不了。

**定位**：让默认界面只留「结论 + 可操作项」。这是唯一一个引入新交互模式的阶段。

### 目标与范围

| 发现 | 内容 |
| --- | --- |
| F-UI-03 (P1) | 算法说明常驻 + 右栏在桌面宽度下就装不下 |
| F-UI-13 (P2) | 五个难度挤进三列 |
| F-UI-22 (P3) | 棋谱条目信息过少 |
| F-UI-26 (P3) | 课程摘要在 390 下被截断 |
| F-UI-27 (P3) | `Segmented` 的 `hint` 没有调用方 |

### 预期修改文件

- `src/components/panels/AiPanel.tsx`：算法说明收进「?」；没有分析结果时整块不占位；
- `src/components/panels/HintPanel.tsx`：脚注同样处理；
- `src/components/ui/Panel.tsx`：头部支持一个可选的动作位（放「?」）；
- `src/components/panels/SettingsPanel.tsx`：难度改**纵向单选列表**（不是 5 列，理由见 F-UI-13）；
- `src/features/review/GameLibrary.tsx`：条目补难度（**不加时间戳**，见下）；
- `src/features/review/ReviewScreen.tsx`：出处行 11 → 12 px，**保留在明面**（§7 的豁免）；
- `src/features/learn/LearnScreen.tsx`：摘要不再 `truncate`；
- `src/components/ui/Segmented.tsx`：删掉没有调用方的 `hint`。

### 用户可观察到的变化

- AI 引擎面板默认只显示结论与数字，算法术语要点开才看得到。
- 五个难度排成一行。
- 棋谱条目能看出是人机局的哪一档。

### 风险与依赖

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 收起之后用户找不到说明 | 渐进披露的经典失败模式 | 用「?」而不是纯折叠（可发现性更高）；测试里断言展开/收起与 `aria-expanded` |
| **棋谱时间戳加不了** | `AGENTS.md` 规定 `Date.now()` 只能出现在 `ai/search.ts`；`GameRecord` 也刻意不存时间（先后由自增主键表达），加时间戳会让所有存量棋谱作废 | F-UI-22 只补**难度**（数据已在 `record.difficulty` 里），不补时间 |
| `Panel` 头部加动作位 | 影响全部 6 个面板 | 动作位可选，不传时 DOM 与现在完全一致 |

**依赖**：Phase 02（字号定了，才知道收起多少内容才够）。

### 验收标准

1. **右栏不再有内容落在折线以下**（1440×900）：

   | 状态 | 现状（实测） | 目标 |
   | --- | --- | --- |
   | `battle-midgame` | 藏 244 px | `aside.hidden ≤ 100` |
   | `battle-hint` | 藏 378 px；`棋谱` 面板顶边 **y=907**（整块在视口外） | `棋谱` 顶边 **≤ 750**（至少露出 150 px） |

   这两个数字是量出来的，不是拍的。右栏可视高 841 px，四块面板的内容高
   1085 / 1219 px：`对局` 231 + `AI 引擎` 213 + `AI 提示` 218→352 + `棋谱` 355。

   **光靠收起两段说明不够。** 两段说明加起来约 170 px（`AI 引擎` 的算法说明
   约 100 px、`AI 提示` 的脚注约 70 px）——只够 `battle-midgame` 达标，
   `battle-hint` 还差一截。所以本阶段**至少要动两个杠杆**：
   渐进披露（约 170 px）＋ 面板结构精简（`AI 引擎` 没有结果时整块不占位，约 40 px，
   以及 `棋谱` 列表的 `max-h` 从 288 px 收紧）。**做不到就把差多少、差在哪如实记下来，
   不许悄悄放过。**
2. **默认界面上不再出现算法说明**。判据不能用 `buttons`——那段说明是 `<p>`，
   从来不进 `buttons` 列表，拿它当判据是一条**恒真的空断言**。
   正确的判据是 `typeSamples`：其中**不得存在 `sample` 以 `p{引擎跑在` 或 `p{提示用`
   开头的组合**（现状各出现在 7 个 / 1 个状态）。
3. `battle-empty`（**不是** `puzzle-list` / `learn-list`——`SettingsPanel` 只被
   `BattleScreen.tsx:134` 渲染，难度控件根本不在那两个列表页上）的截图里，
   五个难度档以纵向列表呈现且互不压盖；`learn-list` 的课程摘要完整可读。
4. 探针的 `headings` / `buttons` / `typeSamples` 快照写进本阶段记录，
   作为「默认界面有什么」的存档。

### 回归测试范围

- `AiPanel.test.tsx` / `HintPanel.test.tsx`（会直接红，属于预期）
- `review.test.tsx`（棋谱列表文案变了）
- `learn/screens.test.tsx`
- `e2e/learn.spec.ts`（课程列表文案）
- 新增一条 e2e：说明可以展开并读得到，且展开状态刷新后不保留

---

## Phase 04 · 棋盘与棋盘上的信息

**定位**：本改版**风险最高**的一阶段——动的是 `Board.tsx`，命中区、roving tabindex、
ARIA grid、焦点环全在里面。**必须真实浏览器逐项复核。**

### 目标与范围

| 发现 | 内容 |
| --- | --- |
| F-UI-10 (P2) | 移动端交叉点 21×21，且触屏没有落子前预览 |
| F-UI-14 (P2) | 复盘回放的落子编号只有 6.91–8.31 px |
| F-UI-12 (P2) | 判题标记的红圈里写着没有含义的「1」 |

### 预期修改文件

- `src/components/board/Board.tsx`：触摸路径的预览与确认；标记的 label 语义；
- `src/features/review/ReplayBoard.tsx`：编号的呈现方式；
- `src/features/learn/PracticeBoard.tsx`：判题标记带明确符号；
- `src/components/board/Board.test.tsx` + `e2e/board.spec.ts`（新增）；
- `bench/ui.probe.mjs`：**新增一个量测字段**「回放编号的实际渲染高度」，
  否则验收标准 1 判不了（现有字段里没有它）。

### 用户可观察到的变化

- 手机上第一次点交叉点先出现预览，再点一次才落子（或提供等效的确认机制）。
- 复盘时逐手编号大到能读。
- 走错时，那颗子被明确标成「错」，而不是标个「1」。

### 风险与依赖

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 破坏命中区 | 那 100 行注释里的每条坑（`strokeWidth 0`、整格铺满、`touch-action`）都是踩出来的 | 不改命中区几何；`e2e/tablet.spec.ts` 的四角与四边中点用例必须保持全绿 |
| 破坏键盘路径 | roving tabindex、`hasEverFocusedRef`、focus/blur 挂在 `<svg>` 上 | `Board.test.tsx` 与 `e2e/a11y.spec.ts` 全跑；焦点环的位置与尺寸断言不变 |
| 落子变成两次点击**伤害桌面体验** | 桌面有 hover 预览，不需要确认 | 确认机制只在触摸输入下启用，桌面路径一行不改 |
| **不能用 `matchMedia` 判指针类型** | `ARCHITECTURE.md` 有成文理由反对用 JS 判媒体查询（用户中途改设置分支不更新；jsdom 里 `matchMedia` 缺失、测试与真实行为脱节），`lib/motion.test.ts` 还有一条守卫测试钉着这条约束 | 改用**事件自带的输入模态**：`pointerdown` / `click` 的 `event.pointerType === 'touch'`。它不判媒体查询、不需要桩、Playwright 的触摸上下文里天然为真、鼠标上下文里天然为假——既守住约定，又比 `matchMedia` 更准 |
| 编号变大盖住棋子 | 现有的 0.26 半径就是为「露出棋子」选的 | 换画法（编号移到棋子旁或在屏幕坐标层），而不是把半径加回去 |

**依赖**：Phase 01（棋盘尺寸先稳定，否则编号的字号算不准）。

### 验收标准

1. 探针新增一个量测字段「回放编号的实际渲染高度」，在 390 与 1440 下都 **≥ 10 px**。
2. `e2e/board.spec.ts`：粗指针下两次点按才落子；细指针下一次落子（两条都要有）。
3. `e2e/tablet.spec.ts` 与 `e2e/mobile.spec.ts` 全绿，且**逐条反向验证**
   （改坏命中区，确认它们会红）。
4. 判题标记的 `label` 在 `PracticeBoard` 的用例里被断言为明确符号。

### 回归测试范围

- `Board.test.tsx`（最大的一份组件测试）、`PracticeBoard.test.tsx`、`BattleScreen.test.tsx`
- `e2e/`：`battle` / `a11y` / `mobile` / `tablet` 四个 spec 全量
- 真实浏览器里手动走一遍：鼠标落子、键盘落子、触屏落子、回放逐手

---

## Phase 05 · 状态、反馈与错误

**定位**：把「界面说的话」与「实际发生的事」对齐。

### 目标与范围

| 发现 | 内容 |
| --- | --- |
| F-UI-04 (P1) | 切换模式立刻开新局，无确认无提示 |
| F-UI-06 (P2) | 「轮到 AI」时药丸仍转圈 |
| F-UI-07 (P2) | 减少动态下转圈照转 |
| F-UI-09 (P2) | 三个文本按钮低于 24×24 |
| F-UI-23 (P3) | 「直接取胜」实际是 3 手算杀 |
| F-UI-24 (P3) | 恢复终局存档时弹窗不显示存档状态 |
| F-UI-28 (P3) | 按钮没有 `active` 态 |

### 预期修改文件

- `src/features/battle/status.ts` + `src/components/panels/StatusPill.tsx`：思考态与「轮到 AI」分开；
- `src/index.css`：`prefers-reduced-motion` 名单纳入 `animate-spin`；
- `src/components/ui/Button.tsx` + `AiPanel.tsx` + `HintPanel.tsx`：新增 `text` 档、撑命中区、补 `active` 态；
  **（已交付）**：`text` 档即现在的 `ghost` 档（`DESIGN_SYSTEM.md` §6.1 的第四档，
  `sm` 档命中区 24px 有断言），`active:` 态已补进 `Button` / `Switch` / `MatchBar` / `AppHeader` / `Board`；
- `src/features/review/ReplayBoard.tsx`：把「← 回到棋谱列表」从 `primary` 降为 `default`，
  落实 `DESIGN_SYSTEM.md` §6.1 的「一屏最多一个 `primary`」（现状 `review-replay` 同屏两个，见该节）；
  **（已交付）**：该按钮现在不带 `variant`（= 默认 `secondary`），那一页唯一的 `primary` 是「开始分析」；
- `src/ai/types.ts` + `src/ai/search.ts`：`SearchResponse` 补 `plies`（先写会红的测试）；
- `src/components/panels/SettingsPanel.tsx` + `gameStore.ts`：模式切换护栏；
- `src/components/panels/AiPanel.tsx`：`win` 的文案按算杀手数分档；
- `src/components/panels/ResultDialog.tsx` + `BattleScreen.tsx`：恢复终局存档时的存档状态说明。

**执行状态（事后补记，按代码逐条核过）**：这份清单写在 Phase 00，此后有的**已经落地**、
有的**还没有**，两者混在一起。核过的结果：

- **已落地**：思考态与「轮到 AI」分开（`StatusPill` 的 `busy`——不忙时不转圈）；
  `text` 档（现名 `ghost`）、命中区、`active` 态；`review-replay` 的 `primary` 降档；
  模式切换护栏（`SettingsPanel` 的拦截钩子 + `BattleScreen` 的实现）。
- **未落地**：`prefers-reduced-motion` 名单纳入 `animate-spin`（`index.css` 的名单里没有它，
  而 `StatusPill` 是全站唯一用 `animate-spin` 的地方——**开了减少动态，那个圈照转**）；
  `SearchResponse` 补 `plies`（即 F-UI-23）。
- 其余几条（如弹窗的存档状态说明）**没有逐条核**。

**动手前照代码核一遍，别把这份清单当待办表。**

### 用户可观察到的变化

- AI 卡住时药丸不再假装在思考。
- 开了「减少动态效果」，屏幕上不再有任何东西在动。
- 误点「本地双人」不会直接丢掉这一局。
- 面板会说「算杀得手（3 手）」而不是「直接取胜」。

### 风险与依赖

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 模式切换加确认**降低**了切换速度 | 它是个高频操作吗？——不是（换模式要重开一局） | 确认只在「当前局已落子」时弹；空盘直接切 |
| 改 `status.ts` 会动到播报 | `BoardAnnouncer` 复用 `describeStatus` | 两处一起改，`BoardAnnouncer.test.tsx` 与 `status.test.ts` 同时更新 |
| `win` 文案分档需要 `plies` | `SearchResponse`（`ai/types.ts`）目前只有 `reason` / `depth`，界面推不出「几手算杀」 | **加字段，不是放弃**：`search.ts` 的算杀分支里 `const forced = findForcedWin(...)` 紧接着就构造返回值，`forced.plies` 与已在用的 `forced.nodes` 同一作用域；一手成五那条捷径在 `:464`，`plies` 恒为 1。所以是「`SearchResponse` 加一个 `plies` + 两处 return」，**先写失败测试再改**。这是一条可复现的误导（面板说「直接取胜」而棋还要走两手），不允许留着「可能不做」 |

**依赖**：Phase 03（面板结构稳定之后再改里面的文案）。

### 验收标准

1. `ui:probe` 的 `reducedMotion.stillAnimating` 为**空数组**。
2. `battle-ai-error` 的截图里药丸**不含**转圈图标。
3. `smallTargets` 里 `under24` 为 0（全状态、全视口）。
4. 新增 e2e：在已落子的局面上点「本地双人」会先出确认；取消后盘面不变。

### 回归测试范围

- `status.test.ts` / `BoardAnnouncer.test.tsx` / `AiPanel.test.tsx` / `ResultDialog.test.tsx`
- `gameStore.test.ts`（模式切换路径）
- `e2e/a11y.spec.ts`（减少动态那条）
- 真实浏览器里开着系统「减少动态效果」走一遍

---

## Phase 06 · 无障碍与标题结构

**定位**：把无障碍从「Lighthouse 100」推到「读屏真的能走通一局」。

### 目标与范围

| 发现 | 内容 |
| --- | --- |
| F-UI-11 (P2) | 标题层级不一致，讲解页 h2 → h1 倒挂 |
| F-UI-17 (P3) | `theme-color` 不随主题 |
| F-UI-18 (P3) | `viewport-fit=cover` 没有安全区补偿 |
| F-UI-19 (P3) | 图标语言混用 |

### 预期修改文件

- 各页面的 `h1`（`BattleScreen.tsx` / `StepView.tsx` / `PracticeBoard.tsx` / `ReplayBoard.tsx`）；
- `index.html` + `settingsStore.ts`（主题色随主题更新）；
- `index.css`（安全区变量）；
- `AppHeader.tsx`（图标统一）；
- `e2e/a11y.spec.ts` 扩充。

### 用户可观察到的变化

- 读屏用户按标题跳转时，每个页面都能找到唯一的一级标题。
- 深色主题下手机浏览器地址栏跟着变深。
- 刘海屏横屏时内容不再贴边。

### 风险与依赖

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 加 `h1` 会改变现有布局 | `h1` 默认有 margin 与字号 | 显式给类名，不依赖浏览器默认样式 |
| 安全区 padding 在无刘海设备上会是 0 | `env()` 在支持的设备上才非 0 | 用 `max(现有 padding, env(...))` |
| Lighthouse 已经 100 | 改动可能让它掉下来 | 四页 × 两主题重跑 Lighthouse，作为本阶段的验收之一 |

**依赖**：Phase 05（文案与状态先稳定，避免两次改同一批文件）。

### 验收标准

1. `ui:probe` 的 `headings`：**每个状态恰好一个 `h1`，且排在所有 `h2` 之前**。
2. `metaThemeColor` 在深色下不再是 `#f6f4f0`。
3. Lighthouse 四页 × 两主题无障碍仍为 100。
4. VoiceOver（macOS）走通「进入对战 → 落子 → 听播报 → 悔棋」这条路径，
   过程写进 `docs/TEST_REPORT.md`。

### 回归测试范围

- `e2e/a11y.spec.ts` 全量
- 真实浏览器 + 读屏实测（这是本阶段的主要验证手段，不是补充）
- 全部页面的截图目视（`h1` 会改变排版）

---

## Phase 07 · 收官：after 基线、文档与终审

**定位**：不是新功能阶段，是把前面六个阶段的成果固化下来。

### 目标与范围

1. `yarn ui:probe --out after` 拍完整套，与 `before/` 逐张对照，写一份差异说明；
2. 更新 `docs/screenshots/` 里的阶段截图（`desktop-*` / `mobile-*` / `phase*-*`）；
3. 文档同步：`README.md`（能力与截图）、`docs/USAGE.md`（交互有变的部分）、
   `docs/ARCHITECTURE.md`（棋盘渲染与响应式一节）、`docs/ROADMAP.md`；
4. 两轴独立终审（标准轴 + 规格轴并行），修完遗留；
5. 把「布局预算」的判据固化进 `AGENTS.md` 的测试约定。

### 预期修改文件

`docs/ui-redesign/*`、`docs/screenshots/*`、`README.md`、`docs/USAGE.md`、
`docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、`AGENTS.md`。

### 验收标准

1. `after/` 与 `before/` 的 156 张截图一一对应，差异清单里每条都能追到某个 Phase。
2. 四条量化判据全过（对比度 0 违规 / 无横向溢出 / 无 <24px 命中区 / 棋盘 ≥320px）。
3. 两轴终审 0 条 P0、0 条 P1 未处理。
4. `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e && yarn e2e:prod` 全绿。

### 回归测试范围

**全量**。这一阶段不改产品代码，任何一条红都说明前面某个阶段留下了问题。

---

## 全局约束（七个阶段都不许碰的）

| 不许碰 | 原因 |
| --- | --- |
| `src/index.css` 的 28 个颜色令牌的**值**（浅深各一套，共 56 条声明） | 经过 WCAG AA 反推 + 156 次实测验证；要改必须先过 `contrast.test.tsx` |
| `core` / `ai` / `learn` 的算法语义 | 规则、搜索、难度、判定都是产品资产（`AGENTS.md` 硬性约束） |
| `persist/` 的数据格式与版本号 | 改格式会让所有存量存档 / 进度 / 棋谱作废 |
| 棋盘的 SVG 几何（`viewBox`、命中区、棋子半径、色令牌） | 命中区与自适应是踩出来的，动一处要重验四角与四边中点 |
| 现有测试的**有效断言** | 不允许为了通过而删断言、跳过用例或换成无意义的 mock |
| 新增运行时依赖 | 当前只有 react / react-dom / zustand；动效用纯 CSS 是刻意选择 |

## 排期与先后依赖

```
Phase 01 布局地基 ──→ Phase 02 排版间距 ──→ Phase 03 信息密度 ──→ Phase 05 状态反馈 ──→ Phase 06 无障碍 ──→ Phase 07 收官
                          │                                        ▲
                          └──→ Phase 04 棋盘（只依赖 01 与 02）──────┘
```

- **01 必须最先**：它是 P0，且所有后续阶段的截图都要在稳定布局上拍。
- **02 排在 03 前**：字号定了才知道该收起多少内容；反过来会做两遍。
- **04 可以并行**（只依赖 01/02）：它动的是棋盘，与面板体系不重叠；但风险最高，建议单独一段完整时间。
- **05 排在 03 后**：改的是面板里的文案与结构。
- **06 排在 05 后**：同一批文件不要连着改两轮。
- **07 最后**：不改代码。

---

## 自审记录

（三轮自审 + 一轮独立终审的发现与修正逐条记在下面。）

### 第 1 轮

1. **`--out` 缺失会让基线被覆盖。** 原计划让每个阶段「重跑探针」，但探针默认写 `before/`，
   第一次重跑就把基线毁了。→ **已在 Phase 00 补上 `--out`，并把「不许覆盖 before」写进统一门槛。**

2. **F-UI-22「补时间戳」违反仓库约定。** `AGENTS.md` 规定 `Date.now()` 只能出现在
   `ai/search.ts`，`GameRecord` 也刻意不存时间。原计划里写「补时间/难度」是错的。
   → **改为只补难度。** 并回到 `FINDINGS.md` 把这一条的表述改准。

3. **阶段划分漏掉了 F-UI-04。** 28 条发现里第 4 条（模式切换无确认）在第一版计划里没有归属。
   → **归入 Phase 05**（它本质是「破坏性操作没有反馈」）。

4. **Phase 02 的验收标准与 Phase 03 冲突。** 字号变大必然让面板变高，
   若在 02 就要求「右栏不溢出」，02 会被迫提前做 03 的渐进披露。
   → **把「右栏不溢出」从 02 挪到 03**，02 只记录数字。

### 第 2 轮

5. **Phase 04 的「两次点击落子」会伤桌面。** 原计划一刀切改成两次确认，
   而桌面本来就有 hover 预览——那是把移动端的问题搬到桌面上。
   → **改为只在粗指针（`pointer: coarse`）下启用**，并加一条「细指针仍是一次落子」的反向用例。

6. **F-UI-14 的修法写反了。** 原写法是「把编号半径加回去」，
   但 0.26 的半径正是为了「让棋子露在数字外面」——加回去会让编号盖住棋子。
   → **改为换画法**（编号移到棋子旁 / 屏幕坐标层），并在风险表里写明不能动半径。

7. **「五条全绿」不足以保证布局没退化。** 第一版把统一门槛写成「五条 + 探针」，
   但探针是**人工目视**，不是断言。F-UI-01 活了两天的根因正是这个。
   → **Phase 01 必须新增可断言的 `e2e/layout.spec.ts`**，且必须做反向验证（撤掉修复确认它会红）。

8. **Phase 02 引入「字号令牌」有过度抽象的风险。** 与 `AGENTS.md` 的
   「不要为了抽象而抽象」相抵。
   → **限定为映射而非新体系**：令牌值就是现有 Tailwind 值，不新增字号、不新增换算。

### 第 3 轮

9. **`status.ts` 的改动会波及 `BoardAnnouncer`。** 障碍者播报复用 `describeStatus`，
   改思考态色调时会顺手动到播报文案。
   → 在 Phase 05 的风险表里写明「两处一起改」，并把 `BoardAnnouncer.test.tsx` 列进回归范围。

10. **Phase 05 的 `win` 文案分档可能做不了。** `SearchResponse` 目前只有
    `reason` / `depth`，没有 `plies`——推不出「几手算杀」就只能编，而编是禁止的。
    → 加一条明确的退路：**推不出来就先不改文案**，记进遗留，不硬凑。

11. **缺一条「做完怎么知道真的变好了」的判据。** 原文只有「重跑探针对照」，
    但对照是人工的。
    → 统一门槛里补上**四条量化判据**（对比度 0 违规 / 无横向溢出 / 无 <24px 命中区 /
    棋盘 ≥320px），它们都能从 `measurements.json` 直接判真假。

12. **Phase 06 只写「Lighthouse 100」是自我循环。** Phase 5 的 Lighthouse 已经是 100，
    再拿它当验收等于什么也没验。
    → 补上真正能证明的判据：`headings` 每页恰一个 `h1` 且在 `h2` 之前；
    **VoiceOver 实测走通一条路径**并写进测试报告。

13. **`before/` 的 156 张截图与 `after/` 的对应关系没有约定。** 若 after 少拍或多拍，
    「一一对应」就无从谈起。
    → Phase 07 的验收里写明「156 张一一对应」，并要求探针输出的文件名规则不变
    （`<组>-<状态>__<视口>-<主题>.png`）。

14. **Phase 03 的验收标准写得做不到。** 原文是「`aside.hidden ≤ 0`」，
    但量过之后才发现：两段说明加起来只有约 170 px，而 `battle-hint` 藏了 378 px。
    照原文写，Phase 03 要么达不成、要么被迫临时扩范围。
    → 拆成两条可判定的目标（`battle-midgame` 藏 ≤ 100 px；
    `battle-hint` 的 `棋谱` 面板顶边 ≤ 750），**并写明至少要用两个杠杆、各能省多少 px**。
    这一条是量了才知道的，也说明验收标准必须建立在测过的数字上。

### 独立终审

由另一个上下文独立执行（读代码、复算数字、逐条对照仓库约定），完整结论见
[REVIEW.md](REVIEW.md)。**21 条里有 20 条经我逐条复算后确认属实并已改掉**，
其中三条是硬伤：

1. **统一门槛第 4 条从 Phase 01 起就不可能通过**——它要求 `under24` 全为 `false`，
   而棋盘一格在 390 视口下永远小于 24 px，计划自己又明令不许放大命中区。
   → 判据改成「`under24` 只允许剩下棋盘交叉点」。**一条永远红的判据会被当成噪声，
   那正是 F-UI-01 得以存活的同一种失效模式。**
2. **Phase 01 的侧栏 `clamp()` 与 Phase 03 的「难度改 5 列」互斥**：左栏压到 220 px 时
   每列只剩 26.8 px，必然压盖。→ 难度改成**纵向单选列表**，5 列方案直接排除。
3. **棋盘换算基准错了**：`viewBox` 是 `1 + 14 + 1 = 16` 个单位，不是 17。
   探针量的 `intersection-7-7` 四次全部等于棋盘/16，是我自己文档里的推导错了。
   → F-UI-14、DESIGN_SYSTEM §8.1/§8.2/§8.4 的数字全部重算。

另有三条「判据本身是空断言」的（`buttons` 里查算法说明、探针没有 `headings` 宽度字段、
把难度控件判在 `puzzle-list` 上），以及一条约定冲突（用 `matchMedia` 判指针类型
与仓库的成文立场相反 → 改用 `event.pointerType`）。**全部已改。**

---

## 遗留与不做的事

以下事项**本改版不做**，如实列出：

1. **暗色主题只做到「沉稳」这一层**，不做独立的暗色配色探索（现有令牌已经过对比度验证，推倒重来的收益撑不起风险）。
2. **不做组件库化**。现有的 `ui/` 目录够用；把 6 个原子组件包装成设计系统组件库属于为抽象而抽象。
3. **不做动画体系升级**。四个 keyframes 覆盖了全部需要标注的变化，引入动画库是负收益
   （Phase 1 装过 `motion`，全库零引用后移除）。
4. **不做首屏性能优化**。Phase 5 实测过（首屏应用自身 136 ms、落子一手 0.30 ms 中位），
   结论是「测过、不做」；UI 改版不得把它改坏，但也不以此为目标。
5. **不做棋盘的视觉重绘**（木纹、棋子渐变、星位）。它们是产品识别度的一部分，
   且已有对比度守卫；除非某个 Phase 的截图证明它有问题。
6. **不给探针加断言阈值门禁**。`ui:probe` 与 `yarn bench` 一样只产事实；
   要设门禁得先有 CI，那是另一个决定。
