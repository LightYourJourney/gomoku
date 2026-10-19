# 发布就绪评估（Phase 09A）

> **这份文件的定位**：给「能不能发布、还差什么」一个可核对的答案，
> 而不是又一份功能清单。所有数字都是本机**实跑**得来的，命令写在 §9；
> 没有跑过的项目显式标成「未验证」，不用推断补齐。
>
> **本阶段没有向任何外部平台发布**，没有创建托管项目、没有部署、没有修改域名/DNS/账号。
> **需要知悉的一条事实**：本地提交 `836bcc5` 已出现在 `origin/main`（推送发生在
> 审查期间；本会话没有执行 `git push`）。代码在远端可见**不等于**部署——没有任何站点上线。
> 发布前请确认远端仓库的可见性（公开/私有）符合预期。

## 1. 结论：三级判定

| 判定 | 结论 | 依据 |
| --- | --- | --- |
| **可进入部署准备** | ✅ **是** | 代码与产物侧的门禁全绿；构建、子路径、Worker、持久化、安全头都有实跑证据 |
| **可进行 staging 部署** | ✅ **是（有前置条件）** | 需要用户在目标平台创建项目并授权；按 [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) 配置后，先跑一遍 §9 的冒烟项 |
| **可公开发布** | ⛔ **否（本阶段）** | 缺一次**真实托管环境**的验证（响应头、缓存、域名、404），缺少 Chrome 之外的浏览器实测；公开策略（域名、是否被索引）尚未由用户确认。**不是代码缺陷阻断** |

换句话说：**发布候选（RC）状态成立**，但「RC」不等于「已发布」。
本阶段把「部署前该做的准备」做完了，发布动作与对外承诺仍然留待用户授权。

## 2. 基线

| 项 | 值 |
| --- | --- |
| 上一阶段基线 | Phase 08 审计提交 `254e6f7` |
| 本阶段工作区 | Phase 09A 变更（见 §10 的提交说明；审计时未提交） |
| 运行环境 | macOS（Darwin 25.6.0）/ Node v26.12.0 / Yarn 1.22.22 |
| 浏览器（自动化） | 本机 Chrome（`channel: 'chrome'`），桌面 / Pixel 7 / iPad 横屏三套视口 |
| 产物 | `dist/` 412 KB；`index.js` 334 KB（gzip 104 KB）、CSS 34 KB（gzip 7 KB）、Worker 11 KB（gzip 4 KB） |

Phase 08 之后的产品代码改动集中在：学习进度写入时序、分析结论的路径语义、
学习题解缓存、生命周期 flush 钩子，以及发布资源/安全头；**没有改规则、搜索算法、
AI 决策、判题口径或布局**。

## 3. 学习进度的写入时序（§二）

### 3.1 三层语义，不再混为一谈

| 层 | 含义 | 失败时 |
| --- | --- | --- |
| 内存态 | `learnStore` 里的 `progress`，UI 立即读到 | 不会失败 |
| 排队 | 一次待写的进度（`queued`），**新值覆盖旧值** | 不会失败 |
| 落盘 | `storage.save()` 真正写 IndexedDB | 吞掉这一笔；下一次变更重新排队；会话内内存态仍可用 |

`learnStore` 现在用**串行的 latest-wins 队列**：同一时刻最多一个写入在飞，
排队位只保留最新值。因此旧写入不可能覆盖新写入，也不会为每次渲染各写一遍。
新增的 `flush()` 返回「当前队列排空」的 Promise——它是**同步点**，不是落盘保证。

### 3.2 浏览器关闭前

`useFlushOnHide` 在 `visibilitychange === 'hidden'` 与 `pagehide` 时调用 `flush()`。
这是**尽力而为**：浏览器不保证页面隐藏后的异步 IndexedDB 事务一定完成，
进程被强杀、崩溃、断电时更不保证。**任何「关闭前绝对不丢」的说法都不成立**，
文档与 UI 都没有这样承诺。

### 3.3 明确的边界

- **载入完成前的写入不在 `flush()` 的等待范围内**。首屏载入期间发生的修改会挂起，
  载入后补写；若页面在载入完成前就被销毁，这次补写可能来不及。窗口只有毫秒级。
- **串行化只在单个标签页内成立**。两个标签页同时改进度是最后写入者胜；
  没有跨标签页锁，也不打算在这一阶段引入。
- **存储适配器吞掉落盘失败**：`saveProgress` 在 IndexedDB 失败时仍 resolve
  （这是刻意的降级——内存态继续可用、不白屏）。因此「排空队列」不等于「已落盘」，
  `flush()` 的成功也不代表数据写进了磁盘。

### 3.4 测试

`learnStore.test.ts` 的「写入时序（Phase 09A）」6 条：按序落盘、旧写入不覆盖新值、
`flush` 等到整条队列排空、空队列立即完成、单次失败不阻塞后续写入、同值不重复写。
`useFlushOnHide.test.tsx` 4 条：隐藏触发、可见不触发、`pagehide` 触发、卸载取消订阅。
全部用可控的 `GatedStorage` / 事件派发，**没有任意 sleep**。

## 4. 分析结论的路径语义（§三）

新增显式分类 `SearchPath = 'search' | 'shortcut' | 'aborted' | 'none'`，
由 `SearchReason` 穷举映射（`searchPathOf`），随 `MoveVerdict.reason` 一路带到复盘卡片。

| 路径 | 来源 `reason` | 卡片文案 |
| --- | --- | --- |
| `search` | `search` | 搜索完成 |
| `shortcut` | `win` / `block` / `opening` | 规则/快速路径判定 |
| `aborted` | `timeout` | 预算内未搜完（启发式） |
| `none` | `no_move` | 无可用着法 |

UI **不再**根据 `depth` / `nodes` / 耗时推断是否搜索过；深度 0、节点 0 的捷径局
现在如实显示「规则/快速路径判定」。搜索算法与走子决策零改动。
测试覆盖 `searchPathOf` 的五种映射、`buildVerdict` 的 reason 透传、
`analysisStore` 的携带，以及复盘卡片在 `reason: 'win'` 时的渲染。

## 5. 主线程与性能（§四）

### 5.1 更正 Phase 08 的 60–132 ms

Phase 08 的计时块里含一个固定 `waitForTimeout(60)`，且从 Playwright 调用点起算，
把派发与读取开销都算进了「同步阻塞」。Phase 09A 用**页内同步点击 + MutationObserver**
重测，并区分纯函数与浏览器：

| 测量 | 结果 |
| --- | --- |
| 纯函数 `solveMove`（23 道题/课，预热 + 7 次取 **CPU 最小值**） | 最慢 **9.08 ms**（lesson `defense`）；三次复跑 8.4–9.1 ms |
| 纯函数 `judgeMove`（正确解） | 最慢 **4.32 ms**（puzzle `forced-counter`）；三次复跑 4.1–5.0 ms |
| 纯函数 `judgeMove`（无关点） | ≤ **0.85 ms** |
| 空载时同一基准的 wall 首测 | 4.81–5.15 ms（求解）/ 2.39–2.97 ms（判题） |
| 生产产物：第 3 级提示 → DOM 标记出现 | 空载 **1.3–4.3 ms**；同一台机器负载 35–45 时 **2.7–7.6 ms**（`yarn bench:blocking`） |
| 生产产物：落子 → 反馈出现（空载） | 同步处理 + 提交在 2 ms 内；端到端反馈受 React 调度影响 |
| dev 模式同口径（空载） | 10–14 ms（React 开发版 + 未压缩，差异来自开发开销） |
| >50 ms 的 long task（空载） | 生产产物 **0 次**；dev 下偶见一次 52 ms |

**测量条件必须一起读**：`bench:learn` 的三次复跑是在**负载均值 35–45** 的机器上做的
（大量无关进程）。因此正文采用**进程 CPU 最小值**（不受抢占影响，含 V8 后台线程，是上界）；
同一时段的 wall 中位会被调度放大到 15–160 ms，**不能归因于这段代码**。
空载时的 wall 首测（4.81 / 2.39 ms）与 CPU 最小值（9.08 / 4.32 ms）是同一量级。

**结论：不存在 60–132 ms 的主线程阻塞，不把求解挪进 Worker。**
`solutionCache` 保留：它省下「再做一次」重付的几毫秒，是顺手的小优化，
**不是**对某个 130 ms 卡顿的修复。复现命令见 §9。

## 6. 发布资源与元数据（§五）

| 项 | 状态 |
| --- | --- |
| `title` / `description` / `favicon` / `viewport` / `theme-color` | ✅ 齐备；`theme-color` 随主题同步（深色 `#0f1115`） |
| 子路径部署 | ✅ `VITE_BASE=/gomoku/ yarn build` 后 HTML、JS、CSS、favicon 全部带前缀；Worker chunk 正常加载 |
| `robots.txt` | ✅ 新增 `public/robots.txt`（`Allow: /`，默认允许索引）。**公开发布前由用户确认**；若要禁止索引，改成 `Disallow: /` |
| `llms.txt` | ❌ 按本阶段要求**不添加**；Phase 08 的教训记在审计报告里 |
| 404 | ✅ 新增 `public/404.html`（应用无前端路由，唯一入口是 `/`）；静态托管会用该页 |
| 第三方资源 | ✅ 0 个；产物里只有同源 HTML/JS/CSS/favicon/Worker |
| 控制台 | ✅ 生产产物全流程 0 error / 0 warning |
| 网络 | ✅ 5 个同源请求（`/`、CSS、JS、Worker、favicon），0 外源请求、0 个 4xx/5xx |
| README 口径 | ✅ 删除「应用不含任何网络请求 / 完全离线」的错误说法，改为「无后端、无第三方运行时请求、零数据外发；静态资源仍走 HTTP」 |

## 7. 生产安全（§六）

| 检查 | 结果 |
| --- | --- |
| 密钥 / 配置泄漏 | 仓库无 `.env`；源码与 `package.json` 无 API key / token / 密码；产物无源码映射、无 `localhost` |
| 动态脚本执行 | 无 `eval` / `new Function` / `document.write` / `innerHTML` / `dangerouslySetInnerHTML` |
| 运行时网络调用 | 无 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon` |
| 第三方资源 | 产物外链只有 React 内部的 XML 命名空间与错误文档字符串，**不会被请求** |
| Worker 路径 | 产物内 `worker-<hash>.js` 由同源加载，e2e:prod 覆盖了这条最易断的链路 |
| URL / 输入安全 | 唯一入口是 `/`，无前端路由；用户输入只有棋盘坐标（整数、按棋盘尺寸校验）与设置项，不进入 URL、`href`、`innerHTML` 或网络请求 |
| 依赖 | 运行时依赖仅 3 个（React / React DOM / Zustand）；`yarn audit --groups dependencies` 0 条，全量 0 条 |
| 开发工具链 | Playwright / Vitest / oxlint / Tailwind 等只在开发与 CI 执行，**不进入 `dist/`**；它们的告警不等于可被利用的线上问题，本轮全量 audit 也为 0 |
| 安全响应头 | `public/_headers` 定义 CSP、nosniff、Referrer-Policy、X-Frame-Options、Permissions-Policy、HSTS；按路径设置缓存 |
| CSP 实测 | 用真实 `dist/` + 按 `_headers` 注入头的本地服务器，走完对战/提示/教学/残局/复盘/主题切换：**0 条 `securitypolicyviolation`** |

**已知取舍**：`style-src` 必须带 `'unsafe-inline'`——应用有 13 处 React `style` 属性，
CSP 对样式属性只认 inline。`script-src` 保持 `'self'`，没有 `'unsafe-eval'` /
`'unsafe-inline'`。`frame-ancestors 'none'` 只能通过响应头生效，
所以**这些头只有支持自定义响应头的托管平台才能落地**（Cloudflare Pages / Netlify 等）。
GitHub Pages 没有等效功能，见 §10。

## 8. IndexedDB 兼容（§七）

- 库名 `gomoku-lab`，版本 **2**，`progress` + `records` 两个对象表由
  `persist/schema.ts` 统一建；任何一处打开都调用 `ensureSchema`，避免「各建各的表」的老 bug。
- 进度载荷自带 `schemaVersion = 1`；版本不匹配时安全丢弃，不静默串读。
- **老库可读**：新增测试构造「v1、只有 progress 表」的库，写入一份合法进度，
  再走生产路径（v2）打开：`onupgradeneeded` 补建 `records` 表，旧进度**原样读回**。
  棋谱侧原有的同场景回归测试继续通过（持久层共 34 条）。
- IndexedDB 不可用（隐私模式、策略禁用、配额失败）时退到内存态，功能不中断；
  刷新后该次会话的进度会丢——这是既定降级，不是新增缺陷。
- **同源即隔离**：`http://localhost:5173` 与生产域名是不同 origin，IndexedDB 与
  localStorage **不会**迁移。部署后首次访问从空进度开始；本阶段**不做**导入/导出系统。

## 9. 门禁实跑（2026-10-20，本机）

| 命令 | 结果 |
| --- | --- |
| `yarn lint` | ✅ oxlint 通过（0.19 s） |
| `yarn typecheck` | ✅ 三份 tsconfig 全过（2.93 s） |
| `yarn test` | ✅ **65 文件 / 1085 用例**全过 |
| `yarn build` | ✅ 产物 412 KB（gzip：JS 104 KB / CSS 7 KB / Worker 4 KB） |
| `yarn e2e` | ✅ **162 条**全过（本次 8.0 min，负载机器；空载首跑 3.4 min；Chrome 桌面/移动/平板） |
| `yarn e2e:prod` | ✅ **5 条**全过（13.8 s，真实产物 + Worker + 持久化） |
| `yarn gates` | ✅ 循环/死码/重复/测试条数棘轮全过；0 clones；1085 单测 / 162 e2e |
| `yarn check:coverage` | ✅ 172 条 / 21 状态，3084 条控件与标题，覆盖未缩小（+136 新增） |
| `yarn ui:probe --out <临时目录>` | ✅ 38 状态 / **308 张**截图，七条量化判据全过（本次 9.4 min，负载机器；空载首跑 5.3 min） |
| `yarn bench:check` | ✅ 19/19 断言行一致 / 6 条跳过 / 29 项不变量一致 |
| `yarn bench:learn` | ✅ 23 道题/课；最慢求解 9.08 ms、最慢判题 4.32 ms、判错 ≤0.85 ms（CPU 最小值，负载机器，三次复跑 8.4–9.1 / 4.1–5.0） |
| `yarn bench:blocking` | ✅ 生产产物页内：第 3 级提示同步 0.2–0.4 ms、DOM 2.7–7.6 ms（负载 35–45；空载首测 1.3–4.3 ms） |

复现 §5 的浏览器测量（一次性脚本，未入库）：

```bash
yarn build
yarn preview --port 5192 --strictPort     # 或按 _headers 起静态服务器
yarn bench:blocking                       # 页内同步点击 → MutationObserver 记录 DOM 变更
```

## 10. 已知风险与未验证项

| 项 | 影响 | 处置 |
| --- | --- | --- |
| **没有在真实托管环境验证** | 响应头、缓存、404、HTTPS 重定向、自定义域名都只是本地等价验证 | staging 部署后按 RELEASE_CHECKLIST 逐项核 |
| **浏览器矩阵只有 Chrome** | Firefox / Safari 未实测；`module worker`、IndexedDB、CSS 特性在旧版 Safari 上可能有差异 | 公开发布前补一次 Safari/Firefox 冒烟；README 已声明 Worker 无降级 |
| **低端设备未实测** | 9 ms 是桌面 CPU 上的上界；低端手机可能慢数倍 | 仍远低于 2 s / 3 s 预算；若公开发布，建议在真机复跑 `bench:blocking` |
| **CSP 依赖自定义响应头** | GitHub Pages 无法下发 CSP / X-Frame-Options / HSTS | 默认推荐 Cloudflare Pages；GitHub Pages 作为降级方案，明确损失 |
| **关闭页面前的 flush 不保证** | 极端时机（隐藏后立即杀进程）可能丢最后一笔 | 已如实标注；进度为低价值数据，不做更强承诺 |
| **多标签页并发写** | 两个标签页同时改进度时最后写入者胜 | 单标签页内已串行；跨标签页锁不在本阶段范围，已如实记录 |
| **localhost 数据不迁移** | 部署后首次访问是空进度 | 本阶段不做导入/导出；在 USAGE/README 需要时补一句 |
| **无 Service Worker** | 断网后刷新需要能访问宿主 | 不声称「离线可用」；README 已改为准确口径 |
| **`llms.txt` 未加** | 仅影响 Lighthouse Agentic 分 | 按本阶段要求不加；公开策略确认后再议 |

## 11. 下一步

- **Phase 09B 不在本阶段范围内**，本阶段结束后停止，不自动开始。
- 若用户授权 staging：按 [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) 建项目 → 部署 →
  按 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 核验 → 失败则按 [ROLLBACK_PLAN.md](ROLLBACK_PLAN.md) 回滚。
- 公开发布前至少补：真实托管验证、Safari/Firefox 冒烟、公开域名与索引策略确认。
