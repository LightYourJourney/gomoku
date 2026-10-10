# Gomoku Lab · 五子棋实验室

一款离线可用的现代五子棋 Web 应用：人机对战、AI 提示、互动教学、残局挑战与对局复盘。

**当前进度：Phase 2（强化 AI）已完成，待验收。** 五档难度全部开放，引擎具备棋型识别（含隔子型）、Zobrist 置换表、迭代加深与算杀搜索；AI 提示可以在棋盘上标出推荐着法，且**只做分析、绝不落子**。规则与 AI 均经过自动化测试验证（401 条单元 / 组件用例 + 17 条端到端）。

![桌面端浅色主题](docs/screenshots/desktop-light.png)

## 快速开始

```bash
yarn install
yarn dev          # 开发服务器
```

打开终端里提示的地址即可开始对局。首次开局默认玩家执黑、AI 初级难度。

## 命令

| 命令 | 作用 |
| --- | --- |
| `yarn dev` | 启动开发服务器 |
| `yarn build` | 类型检查 + 生产构建，产物在 `dist/` |
| `yarn preview` | 预览生产构建 |
| `yarn typecheck` | 类型检查（应用代码 + E2E 代码） |
| `yarn test` | 运行单元测试（Vitest） |
| `yarn test:watch` | 单元测试监听模式 |
| `yarn e2e` | 运行端到端测试（Playwright，使用本机 Chrome） |
| `yarn lint` | oxlint |
| `yarn bench` | 跑引擎基准（约一两分钟），数字见 `docs/AI_ENGINE.md` 的「实测」一节 |

## 已实现的能力

**规则（`src/core`）**
15×15 自由规则：黑先，横竖斜任意方向连续五枚或更多即胜（长连有效、无禁手），棋子下满且无人成五判和。规则是零依赖的纯函数，与 React 完全分离。

**对战**
玩家执黑或执白、人机对战或本地双人、**入门 / 初级 / 中级 / 高级 / 专家五档 AI**、落子音效、最后一步高亮、当前回合提示、坐标开关、悔棋、重新开始、认输、终局弹窗、棋谱记录。人机悔棋会一次收回双方各一手，把主动权交还玩家。

**AI（`src/ai`）**
在 Web Worker 中运行，绝不阻塞主线程。具备棋型识别（窗口枚举，**能看见隔子型**）、候选点生成、Negamax + Alpha-Beta + 迭代加深、Zobrist 置换表、杀手着法、算杀搜索（连续冲四）、时间预算与超时回退、必胜与必防判断。每个请求绑定棋局版本，过期或取消的响应会被丢弃，不会改动棋局。

五档难度的差异来自**真实的参数差异**（候选宽度、深度上限、时间预算、算杀开关），不是给同一套搜索贴上不同标签；档位差异由引擎自对弈测试守住。

**AI 提示**
点「求提示」让引擎用一段固定的短预算单独算一遍，给出前三推荐着法与紧急程度（必胜 / 必须防守 / 危险 / 一般），棋盘上用编号 1/2/3 标出。提示走的是 `purpose: 'hint'` 的**只分析**请求：它和 AI 正式走子共用引擎，但互不挤占预算，**响应只写提示状态、绝不落子**；局面一变（落子 / 悔棋 / 重开）标记立刻清空。

![AI 提示](docs/screenshots/phase2-hint.png)

**本地存档**
每步自动存入 localStorage，刷新页面即恢复对局；即使刷新时正轮到 AI，恢复后它也会接着把这局走完。存档格式带版本号，任何损坏的存档都会被安全丢弃。

![桌面端深色主题](docs/screenshots/desktop-dark.png)

## 技术栈

React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 4 · Zustand 5 · Web Worker · Vitest 5 · Playwright

（动画库 `motion` 排在 Phase 5：Phase 1 时装了但全库零引用，属于提前引入，已移除。）

无后端、无账号、无云数据库、不依赖任何第三方大模型 API。规则与 AI 全部自研。

## 目录结构

```
src/
├─ core/       纯规则与对局状态机（零 React、零 DOM）
├─ ai/         棋型、评估、搜索与 Worker 适配
├─ store/      Zustand 状态（对局 / 设置）
├─ persist/    存档序列化与校验
├─ lib/        主题、音效、坐标格式化等无状态工具
├─ components/ 展示层（棋盘 / 面板 / 原子组件）
└─ features/   按功能组织的容器组件

docs/          架构、规则、AI、路线图、测试报告与截图
e2e/           Playwright 端到端测试
bench/         引擎基准脚本（yarn bench，不进常规测试套件）
```

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 分层、数据流与接口契约
- [docs/RULES.md](docs/RULES.md) —— 规则定义与边界情形的处理
- [docs/AI_ENGINE.md](docs/AI_ENGINE.md) —— 引擎原理、难度参数与已知局限
- [docs/ROADMAP.md](docs/ROADMAP.md) —— 五个阶段的进度与下一步
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) —— 测试覆盖、浏览器验证记录与已知问题
- [AGENTS.md](AGENTS.md) —— 参与开发前的约定

## 移动端

![移动端](docs/screenshots/mobile-light.png)
