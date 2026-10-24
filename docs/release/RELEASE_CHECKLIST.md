# 发布检查清单（Phase 09A）

> 用法：每次发布前从第一项开始，逐项打勾；**不允许跳项**。
> 任何一项失败 → 不发布；已发布则按 [ROLLBACK_PLAN.md](ROLLBACK_PLAN.md) 回滚。
> 「本阶段未执行」的项在 Phase 09A 里保持未勾选，这是刻意的。

## A. 发布前（代码与门禁）

- [ ] `git status` 干净，发布提交就是评审过的那个提交
- [ ] `yarn lint` 通过
- [ ] `yarn typecheck` 通过
- [ ] `yarn test` 全过（Phase 11B 基线：1,333）
- [ ] `yarn build` 通过
- [ ] `yarn e2e` 全过（Phase 11B 基线：176）
- [ ] `yarn e2e:prod` 全过（Phase 10F 基线：6）
- [ ] `yarn e2e:browsers` 全过（Firefox / WebKit 各 8 条，基线：16）
- [ ] `yarn gates` 通过（循环 / 死码 / 重复 / 测试条数棘轮）
- [ ] `yarn check:coverage` 通过
- [ ] `yarn ui:probe --out <临时目录>` 七条判据全过（基线：38 状态 / 308 张）
- [ ] `yarn bench:check` 通过（基线：19/19 + 29 项不变量）
- [ ] 本次改动若涉及规则/引擎/store，新增的失败测试已先写后过
- [ ] 本次改动若涉及命中区/响应式，已有 Playwright 用例并在真实浏览器复核

## B. 构建产物

- [ ] `dist/` 只含预期文件：`index.html`、`assets/*`、`favicon.svg`、`robots.txt`、`404.html`、`_headers`
- [ ] 无 `.map`、无 `.env`、无 `localhost` / `127.0.0.1`
- [ ] `dist/index.html` 无内联 `<script>`；资源路径带正确的 base
- [ ] Worker chunk 存在，且被 `index-*.js` 以同源相对路径引用
- [ ] 子路径部署时：`VITE_BASE=/xxx/ yarn build` 后，HTML/JS/CSS/favicon/Worker 全部带前缀
- [ ] 产物体积无异常增长（Phase 10F：总计 416 KB / gzip 主 JS 107 KB / Worker 5.4 KB）

## C. 安全与元数据

- [ ] `public/_headers` 随产物一起部署；目标平台**确实支持**自定义响应头
- [ ] 线上 `Content-Security-Policy` 与仓库一致；`script-src 'self'`，无 `'unsafe-eval'`
- [ ] `X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`、HSTS 均已下发
- [ ] 真实浏览器走完主流程，**0 条 `securitypolicyviolation`**
- [ ] 无第三方资源请求；Network 面板只有同源请求
- [ ] 控制台 0 error / 0 warning
- [ ] `robots.txt` 可访问且内容符合公开策略
- [ ] `title` / `description` / `favicon` / `theme-color` 正确；深色下 theme-color 变深
- [ ] `yarn audit --groups dependencies` 无 advisory；新增依赖已评估（本阶段无新增运行时依赖）

## D. staging 冒烟（真实托管环境）

- [ ] 首屏渲染出棋盘，状态条说轮到玩家
- [ ] AI 应手正常（Worker 在生产路径加载成功）
- [ ] 落子音效在首次交互后可播放（受浏览器自动播放策略限制）
- [ ] 刷新后对局恢复；学习进度与棋谱仍在
- [ ] 教学：完成一节 → 「下一节」出现；重进已完成课程仍有出口
- [ ] 残局：三级提示出现「解」标记；走另一头多解同样判对
- [ ] 复盘：能进入、时间轴可跳转、结论卡片文案与路径一致
- [ ] 深浅主题切换正常；`prefers-reduced-motion` 下无持续动画
- [ ] 390 / 768 / 1440 三档无横向溢出、棋盘完整可见
- [ ] 不存在的路径返回 404 且 404 页可返回应用
- [ ] 缓存头：`/assets/*` 为 `immutable`，入口为 `must-revalidate`
- [ ] 首页 meta 的 `app-version` / `engine-version` / `build-commit` 与目标提交一致（`curl` 即可）
- [ ] 回滚演练完成一次（见 ROLLBACK_PLAN §5）

## E. 公开发布前（额外）

- [ ] 用户明确授权发布，并确认域名与公开范围
- [ ] 已决定是否允许搜索引擎索引（当前 `robots.txt` 为允许）
- [ ] Safari / Firefox 至少各做一次冒烟（当前自动化只覆盖 Chrome）
- [ ] 在发布说明中写明：无后端、数据只存本机、换域名/换浏览器不会带走进度
- [ ] 在发布说明中写明：关闭页面前的最后一次写入是尽力而为，不是保证
- [ ] 知悉 GitHub Pages 无法落地安全头；若选它，发布说明必须注明

## F. 签核

| 项 | 记录 |
| --- | --- |
| 发布提交 | |
| 门禁执行时间 | |
| staging URL | |
| 冒烟执行人 / 时间 | |
| 回滚演练结果 | |
| 公开发布授权 | 未授权（Phase 09A） |

> **Phase 09A 状态**：A–C 已在本地执行并全部通过（见
> [RELEASE_READINESS.md](RELEASE_READINESS.md) §9）。
>
> **Phase 09B 状态（2026-10-20）**：A–D **已在真实生产环境执行并通过**——
> 线上 <https://gomoku-lab.pages.dev>，提交 `2ec65fa`，全量 e2e 162/162、
> 业务流程烟雾 16/16。逐项读数见 [DEPLOYMENT_RECORD.md](DEPLOYMENT_RECORD.md) §3。
> E 中「Safari / Firefox 冒烟」仍未做；自定义域名未绑定。
>
> **Phase 10F 状态（2026-10-21）**：用户已明确批准提交 `b67ea93` 的生产发布与
> `v0.2.0` 标签；A–D **已在真实生产环境执行并通过**——
> 应用 `0.2.0`、提交 `b67ea93`、部署 `d3f5f6cc…`；预览与生产线上 e2e 均 162/162，
> 定向验收（五档、专家超时、提示、复盘、Worker、CSP、旧库）全过。
> `ui:probe` 与覆盖棘轮由 CI `probe` job 执行（本阶段未改界面）。
> E 中「Safari / Firefox 冒烟」仍未做；自定义域名未绑定。
>
> **Phase 11A 状态（2026-10-23，已发布）**：应用 `0.3.0`、提交 `1cd2be0`、
> 生产部署 `f02c38ca…`、标签 `v0.3.0`；预览与生产线上 e2e 均 166/166，
> 单测 1,280 / UI 探针 308 张全过。回滚目标 `d3f5f6cc…`（0.2.0）；
> 数据格式与恢复语义见 [docs/data/](../data/)。
>
> **Phase 11B 状态（2026-10-24，已发布）**：应用 `0.4.0`、提交 `d20eca9`、
> 生产部署 `07a264f2…`、标签 `v0.4.0`；预览与生产线上 e2e 均 174/174。
> 发布时单测 1,331 / Firefox+WebKit 12 / UI 探针 308 张全过；阶段验收补充测试后
> 当前基线 1,333 / 176 / 16。`DB_VERSION 2→3` 新增
> `positions` 表；回滚到 0.3.0 不能直接打开已升级的库，回滚前先导出需要保留的局面。
