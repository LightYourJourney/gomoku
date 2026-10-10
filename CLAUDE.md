# CLAUDE.md

这一行指向项目唯一的开发约定文件，避免两份规则各说各话。

**开发约定见 [AGENTS.md](AGENTS.md)。** 通用工程原则见上层 `~/CLAUDE.md`。

只有在本文件与 `AGENTS.md` 冲突时，以 `AGENTS.md` 为准——它是为这个项目写的。

## 快速索引

| 我要做的事 | 先读 |
| --- | --- |
| 搞清楚当前做到哪了 | [docs/ROADMAP.md](docs/ROADMAP.md) |
| 改规则或对局状态机 | [docs/RULES.md](docs/RULES.md) |
| 改搜索或评估 | [docs/AI_ENGINE.md](docs/AI_ENGINE.md) |
| 改分层、接口、棋盘渲染 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 看测试怎么跑、验证过什么 | [docs/TEST_REPORT.md](docs/TEST_REPORT.md) |

## 最容易被忽略的三条

1. `core` 与 `ai` 的**算法部分**是纯逻辑层，不得引入 React、DOM、Zustand 或浏览器 API。唯一的例外是 `ai/` 下的 Worker 适配外壳——权威表述在 `AGENTS.md`，**以那份为准**，这里不复述以免两处再次分叉。
2. 改引擎、规则、store 的行为必须先写失败测试；改棋盘命中区或响应式布局必须补 Playwright 用例并在真实浏览器复核——jsdom 抓不到这类问题。
3. 提交前 `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e` 五条全绿。
