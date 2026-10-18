# AGENTS.md

Gomoku Lab 的开发约定。通用工程原则（想清楚再写、保持简单、最小改动、目标驱动）见上层 `~/AGENTS.md`，这里只写本项目特有的部分。

## 动手之前

1. 确认当前处于哪个阶段（见 `docs/ROADMAP.md`），一次只推进一个阶段，做完一个验收一个。
2. 改规则或引擎之前先读 `docs/RULES.md` 与 `docs/AI_ENGINE.md`，那里写明了已定的语义与已知局限。
3. 接口契约在 `docs/ARCHITECTURE.md`。要改分层或数据流，先改文档再改代码。

## 硬性约束

- **不使用 `enum`**。`tsconfig.app.json` 开了 `erasableSyntaxOnly`，一律用 `as const` 对象加联合类型。
- **`core` / `ai` / `learn` 的算法部分不得引入 React、DOM、Zustand、localStorage、IndexedDB、Worker**。引擎逻辑本身（`patterns` / `evaluate` / `candidates` / `difficulty` / `search`）与全部 `core` 模块必须是能脱离浏览器直接单测的纯逻辑。
  - `learn/` 是教学内容层：`types.ts` / `verify.ts` / `hints.ts` / `lessons.ts` / `puzzles.ts` 全是纯逻辑，依赖方向 `features → learn → ai → core` 单向，**不得被 `ai`/`core` 反向依赖**（`store` 不依赖 `learn`：`src/store/` 只 import `core` / `persist` / `ai`）。棋盘的字符画解析器住在 `lib/board-lines.ts`（内容与测试共用）。
  - **例外**：`ai/worker.ts` 与 `ai/browserEngine.ts`。前者是 Worker 的入口，后者负责创建 Worker——只有这两个文件允许触碰 Worker，且只做消息收发，不含任何搜索逻辑。`ai/engine.ts` 虽然也住在 `ai/` 下，但它连 Worker 都不碰（发送函数是注入进来的），仍是可单测的纯状态机。
- **时钟一律可注入。** `Date.now()` 的**调用**只允许出现在 `ai/search.ts` 的时间预算里，
  且超时行为必须仍然可以通过 `budgetMs` 参数在测试里强制触发——不要把它改成不可覆盖的常量。
  别处需要时钟就走**参数注入**：`ai/threat.ts` / `ai/search.ts` / `learn/verify.ts` / `learn/hints.ts`
  的签名都是 `now: () => number`，调用方把 `Date.now` 传进去（见 `features/learn/PracticeBoard.tsx`），
  测试里换成假时钟。**不要在函数体内直接写 `Date.now()`**——那样时间就固定不住了。
  （这条原先写的是「只允许出现在 `ai/search.ts`」，比事实更绝对：注入式的用法一直存在，
  `persist/gameRecords.ts` 与 `features/review/GameLibrary.tsx` 的注释还按旧措辞引用了它。）
- **`core` 是对局状态的唯一真相**。棋盘与手顺都由 `replay()` 从手顺重建，不要写增量维护的旁路。
- **状态不可变**。`applyMove` / `undo` / `resign` 返回新对象，不原地修改。
- **AI 请求必须绑定 `requestId` 与 `gameVersion`**，两道闸门都过才允许落子。任何新增的「可能改变棋局」的异步路径都要走同样的校验。
- **教学题的答案是算出来的，不许写死坐标**。题目只声明局面与目标谓词（`PuzzleGoal`），判定走 `learn/verify.ts` 的 `judgeMove`。新增或修改题目之后必须让 `learn/content.test.ts` 全绿——它逐个跑求解器，无解、开局已分胜负、手数奇偶对不上都会在那里被点名。
- **`forcedWin` 类目标必须在落子前的盘面上判**（`isForcedWinStart`）。拿落子后的盘面调 `findForcedWin` 等于白送攻方一手，会把输棋判成赢棋。
- **提示请求是只读的**。`purpose: 'hint'` 的响应只允许写提示状态，**不许调用 `applyMove`**；局面一变就要整体清空提示。提示与落子请求分别记录在 `pendingHintRequestId` / `pendingRequestId` 上，互不挤占，但**共用同一个只增不减的请求号计数器**——分成两个计数器迟早会撞号，撞号意味着迟到的提示响应会去兑现落子请求。
- **界面文案一律简体中文。**
- **包管理器固定 yarn。**

## 测试

- 新增或修改 `core` / `ai` / `store` / `persist` 的行为，必须先写失败测试。这些层全是纯函数或可注入依赖的，没有理由不做 TDD。
- 组件测试用 Testing Library，断言用户能看到的东西（`data-testid`、可访问角色、文本），不要断言内部 state。
- **命中区、布局、滚动这类只在真实浏览器里成立的约束，单元测试抓不到**（jsdom 不做命中测试）。改了棋盘命中区或响应式布局，必须补一条 Playwright 用例并在真实浏览器里复核。
- **布局预算有量化判据**（`e2e/layout.spec.ts`）：任何视口下棋盘 ≥ **320px** 且为正方形；
  **宽度 ≥1024 且高度 ≥900 时**棋盘 ≥ **620px**（620 只在 `height: 900` 下断言——
  低高度窗口里棋盘受高度约束，1024×768 实测 597px，仍远高于 320 底线）；
  两栏/三栏下棋盘与侧栏互不压盖、状态条与工具栏互不相交。
  **高度极小的横屏窗口（900×480 / 915×412）棋盘会低于 320**：`320 + 顶栏 + 工具栏`
  物理上放不下。这是**唯一**一条以物理不可行为由不修的布局项，记在
  `docs/ui-redesign/KNOWN_ISSUES.md` 的 M-3（连带规范 §8.1 的绝对措辞待调整）。
  改断点、栅格或棋盘容器的高度策略时，这几条断言必须仍然全绿。
- 不允许为了让测试通过而删除有效断言、跳过用例或替换成无意义的 mock。
- **写完一条声称能抓住某个缺陷的用例，就把修复临时撤掉跑一次**，确认它真的会红。这是本项目验证测试本身有鉴别力的固定做法，历史记录见 `docs/TEST_REPORT.md`。
- `yarn bench`（`bench/`）不属于 `yarn test`：它只输出数字、不做断言，跑一次要一两分钟。**写进文档的每一个性能数字都必须来自它，不许估。**

## 提交前

```bash
yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e
```

五条全绿才算完成。改了棋盘交互或布局，再加一次真实浏览器目视复核。

### 两道闸门，各管各的

| | 跑什么 | 什么时候跑 | 挡不住什么 |
| --- | --- | --- | --- |
| **快档** | `lint` / `typecheck` / `test` / `build` / `yarn gates`（四道防退化闸门） | **本地 `git push` 自动拦**（`.githooks/pre-push`，热跑 30–45 秒，看机器负载）+ CI 的 `fast` job | e2e、探针、基准 |
| **全档** | 上面 + `e2e` + `e2e:prod` + 探针 + 覆盖棘轮 + `bench:check` | 只有 CI（`.github/workflows/quality.yml`） | — |

**「本地绿了、推得出去」不等于「安全网没缩水」**：快档不含 e2e 与探针，
而「某颗控件从所有扫描里消失」这类退化（Phase 02 真发生过一次）**只有探针 + 覆盖棘轮抓得到**。
所以改了界面结构、布局或扫描范围之后，要等 CI 的全档绿，不能本地绿了就放心。

**绕过与调松都是违规，不是选项**：`git push --no-verify` 是明确接受的逃生门（代价自负），
但**闸门自己的那几份文件**是 **review 必看项**：`knip.jsonc` / `.jscpd.json` /
`bench/baseline.json` / `quality/*.baseline.json` / `.githooks/`，
以及 **`.github/workflows/quality.yml`**——最后这个是决定「闸门跑不跑」的总开关
（一个 `continue-on-error` 就能让它变成只打印不判红）。
工具坏了或环境变了，正确动作是**更新钉住的版本并说明**，不是放宽配置。

阶段收尾（以及任何改了构建配置、Worker 或资源路径的改动）再加一条：

```bash
yarn e2e:prod
```

它自带一次 `yarn build`，跑在 `dist` 产物上（独立端口与配置，见
`playwright.prod.config.ts`）——Worker 的 module 路径、CSS 打包、代码分割
在构建之后与 dev 下并不一样，只有这条通道能发现差异。

## 文档同步

以下改动必须同步更新文档，否则视为未完成：

| 改动 | 要更新的文档 |
| --- | --- |
| 规则语义、坐标约定、状态机 | `docs/RULES.md` |
| 分层、接口契约、数据流、渲染方案 | `docs/ARCHITECTURE.md` |
| 搜索算法、评估、难度参数、引擎局限 | `docs/AI_ENGINE.md` |
| 阶段进度 | `docs/ROADMAP.md` |
| 测试结果、浏览器验证、发现的问题 | `docs/TEST_REPORT.md` |
| 教学内容、题库、判定与提示模型 | `docs/ARCHITECTURE.md` 的「教学内容的判定模型」一节 |

## 不要做的事

- 不要为了抽象而抽象。没有第二个棋类，就不要写「通用棋类框架」。
- 不要提前构建当前阶段用不到的能力。
- 不要把未经搜索验证的随机着法包装成高难度 AI。难度必须来自真实的参数与算法差异，否则如实标注为未开放。
- 不要用固定阈值把每一手都断言成「最佳 / 好棋 / 失误」。分析结论必须注明引擎、预算与局限。
- 不要在棋盘上用 emoji 或临时占位图形充当最终视觉。
