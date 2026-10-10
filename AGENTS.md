# AGENTS.md

Gomoku Lab 的开发约定。通用工程原则（想清楚再写、保持简单、最小改动、目标驱动）见上层 `~/AGENTS.md`，这里只写本项目特有的部分。

## 动手之前

1. 确认当前处于哪个阶段（见 `docs/ROADMAP.md`），一次只推进一个阶段，做完一个验收一个。
2. 改规则或引擎之前先读 `docs/RULES.md` 与 `docs/AI_ENGINE.md`，那里写明了已定的语义与已知局限。
3. 接口契约在 `docs/ARCHITECTURE.md`。要改分层或数据流，先改文档再改代码。

## 硬性约束

- **不使用 `enum`**。`tsconfig.app.json` 开了 `erasableSyntaxOnly`，一律用 `as const` 对象加联合类型。
- **`core` / `ai` / `learn` 的算法部分不得引入 React、DOM、Zustand、localStorage、IndexedDB、Worker**。引擎逻辑本身（`patterns` / `evaluate` / `candidates` / `difficulty` / `search`）与全部 `core` 模块必须是能脱离浏览器直接单测的纯逻辑。
  - `learn/` 是教学内容层：`types.ts` / `verify.ts` / `hints.ts` / `lessons.ts` / `puzzles.ts` 全是纯逻辑，依赖方向 `features → store → learn → ai → core` 单向，**不得被 `ai`/`core` 反向依赖**。棋盘的字符画解析器住在 `lib/board-lines.ts`（内容与测试共用）。
  - **例外**：`ai/worker.ts` 与 `ai/browserEngine.ts`。前者是 Worker 的入口，后者负责创建 Worker——只有这两个文件允许触碰 Worker，且只做消息收发，不含任何搜索逻辑。`ai/engine.ts` 虽然也住在 `ai/` 下，但它连 Worker 都不碰（发送函数是注入进来的），仍是可单测的纯状态机。
- `Date.now()` 只允许出现在 `ai/search.ts` 的时间预算里，且超时行为必须仍然可以通过 `budgetMs` 参数在测试里强制触发——不要把它改成不可覆盖的常量。
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
- 不允许为了让测试通过而删除有效断言、跳过用例或替换成无意义的 mock。
- **写完一条声称能抓住某个缺陷的用例，就把修复临时撤掉跑一次**，确认它真的会红。这是本项目验证测试本身有鉴别力的固定做法，历史记录见 `docs/TEST_REPORT.md`。
- `yarn bench`（`bench/`）不属于 `yarn test`：它只输出数字、不做断言，跑一次要一两分钟。**写进文档的每一个性能数字都必须来自它，不许估。**

## 提交前

```bash
yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e
```

五条全绿才算完成。改了棋盘交互或布局，再加一次真实浏览器目视复核。

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
