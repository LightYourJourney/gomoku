# 阶段 C 实施计划：导航进历史 + 深链接（路径路由）+ 按页拆包

> 出处：评估报告 §4.4、§4.5、§10「阶段 C」；裁定见 §14 第 1、5 条，§14.2 第 14–16 条（路径路由、页面 + 子页面），
> §14.3 第 17–18 条（进模块自动展开上次那节保留；收尾部署到预览站验证）。URL 方案的比较见 `PHASE_B_C_DECISIONS.md` 第二节。

## 目标

1. 切页、进出子页面都进浏览器历史；后退 / 前进逐层返回，回到第一条之后再后退才离开应用。
2. 地址就是位置：刷新、直达都回到同一个页面 + 子页面。
3. 入口包回到有余量的状态；门禁收紧为「入口上限下调 + 总量上限」（裁定 5，只此一次）。
4. 不引入路由库；`#share=` 协议、备份格式、`progress` 的 schema 不变。

## 地址表

| 位置 | 地址 | 备注 |
| --- | --- | --- |
| 对战 | `/` | |
| 课程列表 / 某节课 | `/learn`、`/learn/<课程 id>` | |
| 残局列表 / 某道题 | `/puzzles`、`/puzzles/<题目 id>` | |
| 棋谱库 / 回放某局 / 局面编辑器 | `/review`、`/review/<棋谱号>`、`/review/editor` | 编辑器从棋谱库进入，与哪一局无关；棋谱号是本机自增号，只在本机有意义 |

都相对于 `import.meta.env.BASE_URL`（子路径部署 `VITE_BASE=/gomoku/` 时是 `/gomoku/learn`）。尾斜杠容忍（`/learn/` 同 `/learn`）。
认不出的地址：开头是认得的页面（`/learn/a/b`、`/review/abc`——Cloudflare 的 `/learn/*` 改写会把它们送进应用）就回那一页的列表，
否则按对战处理（`/foo` 在 Cloudflare 上是 404 页，只有 dev / preview 会走到这里）；两种都 `replaceState` 掉坏地址（终审第 8 条）。

## 设计决定

| # | 决定 | 理由 |
| --- | --- | --- |
| D1 | `lib/routes.ts`：纯函数 `parseRoute(pathname, base)` / `formatRoute(route, base)` 与 `Route` 类型，无 DOM | 地址规则单测成表；`_redirects` 的一致性用例也从这里取页面前缀 |
| D2 | `store/navigationStore.ts`：持有 `route` 与「这次进入要不要恢复上次那节」标记；动作 `navigate(route, { replace? })`、`enterPage(page)`（顶栏用）；`popstate` 时以地址为准更新 `route`。**`learnStore.view` / `setView` 搬走**，`progress.lastView` 由导航 store 在页面变化时写（经 `learnStore` 现有的 `update`），schema 不动 | 评估报告 §4.5：页面位置的归属是历史原因；现在位置以地址为准，留在学习进度里就是两份真相 |
| D3 | 进历史的只有：切页面、进出子页面。对局内动作、复盘游标、弹窗**不进历史** | 后退键不是悔棋键（`PHASE_B_C_DECISIONS.md` 共同行为） |
| D4 | 冷启动：地址里有页面就以地址为准；裸 `/` 等学习进度载入后用 `progress.lastView` 恢复（`replaceState`，不多一条历史），带「恢复上次那节」标记。地址里的 id 找不到（课程下线、棋谱删了）→ `replaceState` 回该页列表，不报错 | 与现在「刷新回到上次那页」一致；裸 `/` 既是对战页也是「没说去哪」，只在冷启动时有歧义，按上次位置解 |
| D5 | **进模块自动展开上次那节（裁定 17）**，**由导航 store 做**（终审第 1 条：页面在渲染期改外部 store 与历史栈不合法）：`enterPage` 在进度已载入时直接去 `/learn/<上次那节>`（一条历史）；没载入就先去 `/learn`，载入后若这期间没发生过别的导航，把这条历史 `replaceState` 成 `/learn/<id>`。冷启动裸 `/` 同理。地址栏直达 `/learn`、后退 / 前进回到 `/learn` 不展开。页面只读地址；地址里的 id 不存在时页面把地址换回列表。已经在这个模块的子页面里再点顶栏的这一项：回到列表（推入一条历史，终审第 5 条）；已在列表则不动 | 现有用例「存在上次停留的课程时，直接展开那一节」断言不改（改为经 `enterPage` 进入，与真实点击同路）；后退回列表不会被再次自动展开（那会吃掉前进历史） |
| D6 | 部署：`public/_redirects` 为**每个页面前缀**写两条改写（`/learn /index.html 200`、`/learn/* /index.html 200`，`puzzles`、`review` 同）；**不写 `/* /index.html 200`**（Cloudflare 的规则优先于静态文件，会把发布后已不存在的旧分块也回成 HTML）。`_headers` 给这些路径补与 `/` 相同的 `Cache-Control: max-age=0, must-revalidate`。`404.html` 文案改成列出四个入口。单测核对：`routes.ts` 里的每个页面前缀在 `_redirects` 里都有两条规则、没有 `/*` | 文档（developers.cloudflare.com/pages/configuration/redirects）：200 代理只支持站内相对路径；规则优先于资源。目标写 `/index.html` 还是 `/` 文档没说清，**收尾在预览站实测**（裁定 18） |
| D7 | 「下一节 / 下一题」也推入一条历史（每个子页面一条）。子页面状态由地址派生：`LearnScreen` / `PuzzleScreen` 的 `openId`、`ReviewScreen` 的 `open` / `editorOpen` 换成读 `route`；页面里的「← 列表」按钮 `navigate` 到列表（push）。`lastVisited` 跟着地址写：进到某节课 / 某道题写它，回到列表写 null（现在只有点按钮时写；后退回列表也该写，否则下次点顶栏又展开一节用户已经退出的课） | 一处真相 |
| D8 | 回放直达：`/review/<棋谱号>` 冷启动或前进 / 后退到它时，从棋谱库按号读一局（`GameRecordsStorage` 已有 `get`？没有就加只读的按号取），读到前显示加载态，读不到 `replaceState` 回 `/review` | 棋谱号是本机自增号 |
| D9 | 分享链接的路径改用应用根（`BASE_URL`），不再用 `location.pathname`——否则在 `/review/12` 里生成的链接会带上本机的棋谱号（复盘页与局面编辑器两处，终审第 3 条）。分享预览照旧靠 `#share=`，在任意路径上都能打开；关闭预览回到原地址 | `ReviewScreen.share` 现在传的是 `window.location.pathname` |
| D10 | 拆包：`React.lazy` 拆三组——复盘组（`ReviewScreen`，含编辑器、数据管理）、教学组（`LearnScreen` + `PuzzleScreen`）、分享预览（`SharePreview`）。**实施时的出入**：教学与残局各自成块（共用的 `PracticeBoard` 由打包器自动抽成第三块），不硬合并；并且启动时先下好地址要去的那一页、其余在后台下——不这么做，`Suspense` 揭开占位的约 300 ms 节流让冷启动直达复盘页从 17 ms 变成 307 ms（实测，见测试报告）。`Suspense` 的占位是一行「正在载入…」；**分块加载失败**落到错误边界，给「页面没能载入（可能是网络断了或应用刚更新），刷新重试」与刷新按钮 | 评估报告 §4.4。项目没有 Service Worker，发布后旧页面请求旧块是真实路径 |
| D11 | `quality/bundle-budget.mjs`：入口按 `dist/index.html` 里的入口脚本认（拆包后 `index-*.js` 不再保证唯一）；入口上限下调、新增全部 JS 的总量上限。两个数都定为**拆完后的实测值 + 约 10% 余量取整到千字节**，提交信息写明实测与上限 | 裁定 5：只收紧，批准仅限这一次 |
| D12 | `vite preview` / dev server 自带 SPA 回退（`appType: 'spa'`），e2e 与 `e2e:prod` 不用改服务器；但它们不代表 Cloudflare 的行为——那由 D6 的一致性单测 + 预览站实测兜着 | |

## Task 1：地址规则（先写失败测试）

- [ ] `lib/routes.test.ts`：四类页面、子页面、尾斜杠、子路径 base、认不出的地址、`formatRoute ∘ parseRoute` 往返；`_redirects` 一致性（`?raw` 读 `public/_redirects`）。
- [ ] 实现 `lib/routes.ts`；写 `public/_redirects`、补 `public/_headers`、改 `public/404.html`。

## Task 2：导航 store

- [ ] `store/navigationStore.test.ts`（jsdom 的 `history` 可用）：`navigate` push / replace 与 `route` 同步；`popstate` 以地址为准；`enterPage` 带恢复标记、`popstate` 不带；冷启动裸 `/` 等进度载入后按 `lastView` 恢复（replace，不多历史）；冷启动带页面不看 `lastView`；页面变化写 `lastView`。
- [ ] 实现；`App.tsx` 按 `route.page` 挂页面；`AppHeader` 用 `enterPage`；`learnStore` 去掉 `view` / `setView`（`bootstrap` 里合并 `lastView` 的那段随之改为只合并进度）。
- [ ] 既有用例：`learnStore.test`「载入时恢复上次所在的视图」挪到导航 store（断言的事实不变）；其余测试里 `useLearnStore.setState({ view })` / `getState().view` 换成导航 store 的同义写法。**断言的事实一条不改**，只改取值位置；逐条列在测试报告里。

## Task 3：子页面接地址

- [ ] 失败测试：`LearnScreen` / `PuzzleScreen` 读 `route`；带恢复标记时展开上次那节并把地址换成 `/learn/<id>`；不带标记（直达 / 后退）显示列表；后退回列表写 `lastVisited = null`；`ReviewScreen` 由 `/review/<号>` 打开回放、号不存在回列表、`/review/editor` 打开编辑器；分享链接不带子路径。
- [ ] 实现 D7–D9。

## Task 4：拆包与失败边界

- [ ] 失败测试：错误边界在子组件抛「动态导入失败」时显示刷新提示（单测）；`e2e:prod` 加「冷启动直达 `/review`」「直达 `/learn/<id>`」「拦掉复盘分块请求 → 显示刷新提示」三条。
- [ ] 实现 D10；改 `bundle-budget.mjs`（D11）。

## Task 5：e2e 与验收

- [ ] `e2e/navigation.spec.ts`：对战 → 教学（自动展开上次那节）→ 回列表 → 残局 → 某题，连按后退逐层返回、最后一次离开应用（`about:blank`）；前进恢复；刷新留在原地；分享预览进出不影响历史；对局内落子 / 悔棋不进历史。
- [ ] 五条命令 + `gates`；`e2e:browsers`（交 CI，本机无 Firefox / WebKit）；`ui:probe` 重拍（界面结构改动按 `AGENTS.md` 要等 CI 全档）。
- [ ] 部署到 Cloudflare **预览**环境（不动生产，按 `DEPLOYMENT_RECORD.md` 的预览做法），实测：深链接直达与刷新、`/assets/不存在.js` 仍是 404 而不是 HTML、`/foo` 是 404 页、`_headers` 在 `/learn/x` 上生效；跑 `e2e:remote` 指向预览地址。结果记入测试报告。
- [ ] 文档：`ARCHITECTURE.md`（导航一节、依赖表若有新边）、`TECH_DEBT.md` §1.3（「无 router」改写为「不用路由库，但进历史、有深链接」）、`USAGE.md`（地址）、`RELEASE_CHECKLIST.md`（`_redirects` 一项）、`TEST_REPORT.md`「〇之二八」、`ROADMAP.md`；`tests.baseline.json` 只上调。
- [ ] 两轴审查 → 提交 → 推送 → 盯 CI 全档。

## 验收标准

1. 三层进入后逐层后退的 e2e 通过；第四次后退离开应用。
2. 刷新与直达：四个页面、三类子页面都回到原地（e2e + `e2e:prod`）。
3. 入口 gzip 实数低于新上限；总量上限存在且通过；拆包后入口比现在（132,290 B）小至少 25%。
4. 分块加载失败有界面（e2e:prod 用例）。
5. 现有 a11y / 布局 / 焦点用例全绿，探针重拍无意外差异。
6. 预览站实测四项通过。

## 自审

**第一轮（与裁定、报告对照）**
1. 评估报告 §4.5 原建议「进 `history.state`、URL 不变」，已被裁定 1（做深链接）取代；`history.state` 只用来放 D5 的恢复标记以外什么都不放——位置以地址为准。
2. 裁定 5 要「入口上限下调 + 新增总量上限」：D11 两项都有；入口的认法改了（从文件名改为读 `index.html`），这是拆包的必然结果，提交信息写明。
3. 裁定 14 点名的四件事（`_redirects` 按页面写、不写 `/*`、`404.html`、preview / e2e 的回退）：D6、D12 覆盖。
4. 原来所有 `setView(...)` 的调用点（顶栏、课程页「去残局」、残局全做完回对战、复盘「开始一局」、分支接管后回对战）语义都是「进入一个模块」，一律换成 `enterPage`——自动展开的行为与现在逐一相同。

**第二轮（时序与边界）**
5. 冷启动裸 `/`：学习进度是异步读的。现在的 `bootstrap` 有「载入期间用户已经点了导航就不覆盖」的合并；导航 store 同样只在「启动后还没发生过任何导航」时才按 `lastView` 恢复，否则作罢。用例钉住。
6. 冷启动带 `#share=`：学习进度在关闭预览后才载入（现状），载入后若仍没导航过，按 `lastView` 恢复——与现在关闭预览后回到上次那页一致。
7. `/review/<号>` 的异步读取与快速前进 / 后退：读回来时地址已经不是这个号就丢弃（与 store 的过期闸门同一思路）。
8. 关闭分享预览用 `replaceState(pathname + search)`，地址的路径部分没变，`route` 不用动；导航 store 只在 `popstate` 与自己的 `navigate` 里改 `route`，不监听 `hashchange`。
9. `popstate` 监听在 store 模块里注册一次，不放在组件 effect 里（StrictMode 的双调用、页面卸载都不影响）。
10. 编辑器有未保存的摆盘时按后退：与现在点「← 返回」一样直接离开，不加拦截（`beforeunload` 式的确认不在本阶段范围）。

**第三轮（测试与门禁）**
11. 依赖方向：`lib/routes.ts` 纯函数（lib 允许 core / ai，这里一个都不用）；`store/navigationStore` 用 `lib` 与 `learnStore`；页面从 `store` 取——都在允许表内，`check:layers` 自动查。
12. jsdom 里各测试文件共用一个 `location`：导航 store 的用例与改到的页面用例在 `beforeEach` 里 `history.replaceState(null, '', '/')` 并重置 store。
13. 懒加载后页面挂载晚一拍：`useFocusOnMount` 在页面真正挂载时才跑，焦点用例应当照旧；`Suspense` 占位期间没有顶栏，本机分块是毫秒级——若 e2e 或探针抓到闪烁，再给占位补顶栏。
14. 探针（`ui:probe`）与覆盖棘轮（`quality/coverage.baseline.json`）可能因结构变化出差异：只接受「同一界面换了加载方式」造成的差异，逐条核对后再更新，更新理由写进提交信息。
15. 条数棘轮只增；挪动的用例条数不变。

## 独立终审

终审者只读源码与计划，十二条意见逐条核实，处理如下（「已在实现中」= Task 1–3 动手时已经这么做了）。

| # | 意见 | 核实 | 处理 |
| --- | --- | --- | --- |
| 1 | D5 让页面渲染期读标记、清标记、`replaceState`，是渲染期改外部 store 与历史栈；「标记放 `history.state`」后退时会再次展开，且 `exitShare` 会用 null 覆盖它 | 成立 | 恢复全部放进导航 store（D5 已改写）；不用 `history.state`。已在实现中 |
| 2 | 用后退 / 前进离开回放不会走 `closeRecord`：分析不停、回放不关、分支弹窗状态带到下一局 | 成立 | 一个依赖地址子页面的 effect 统一处理打开与关闭；分支弹窗状态记下棋谱号，换局即失效。已在实现中，有用例 |
| 3 | `PositionEditor` 的分享同样用 `location.pathname` | 成立 | 一起改成应用根 |
| 4 | `main.tsx` / `App.tsx` 为 `shareTokenFromHash` 引入 `sharing/link`，会把 `persist/transfer` 的校验等约 1.4k 行留在入口；`bench:split` 没算这部分 | 待 Task 4 实测 | token 解析挪到无依赖的小模块；以实测为准 |
| 5 | 刷新后会停在编辑器；在子页面点当前页的顶栏项计划没定（`e2e/editor.spec.ts` 依赖它回到列表） | 成立 | 定为回到列表（推入一条历史），列表上再点不动；有用例 |
| 6 | `update` 是私有的；`lastView` 的合并要保留；`lastVisited = null` 只在「子页 → 列表」那次转移时写 | 成立 | 新增 `recordView`；`lastView` 合并保留、只删 `view`；null 只在同一模块「子页 → 列表」时写。已在实现中。载入前写下的 null 会被合并的 `??` 吞掉：只在「进度还没载入就从一节课退回列表」这个极窄时序里出现，后果是下次点顶栏多展开一次，记为已知限制 |
| 7 | `lastCategory` 只在点开时设；「下一节」push 还是 replace 没定；验收的后退次数与 e2e 的 `robots.txt` 起点 | 成立 | `lastCategory` 改为随打开的题派生（有用例）；「下一节」push（D7）；e2e 按实际条数写断言，起点用新开页面而不是 `seed` |
| 8 | `/learn/a/b` 在 Cloudflare 上会被 `/learn/*` 送进应用，不是「到不了」 | 成立 | 认得页面的坏地址回那一页列表（`fallbackRoute`），有用例 |
| 9 | 错误边界要在页面层、以页面为 key，否则整屏失效、后退也救不回；e2e 拦分块要用 `route.abort`（preview 的 SPA 回退会把缺失的 js 回成 HTML） | 成立 | Task 4 照此做 |
| 10 | 入口口径应是入口 script 加它 modulepreload 的分块 | 成立 | Task 4 照此做 |
| 11 | 子路径部署：`_redirects` / `_headers` 按根路径写，`404.html` 链接写死 `/`；非 Cloudflare 主机深链接刷新即 404，而 `DEPLOYMENT_PLAN.md` 仍声称支持子路径 | 成立 | 文档写明：子路径或非 Cloudflare 主机要自己配同样的回退规则；应用内的地址解析与生成都按 `BASE_URL`（有用例） |
| 12 | `document.title` 不变；`Suspense` 占位没有 `main` / `h1` | 成立 | 标题本阶段不做（写进已知限制）；占位用 `main` 包一行状态文字 |
