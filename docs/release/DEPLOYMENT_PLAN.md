# 部署方案（Phase 09A）

> **状态：只做方案与配置，不执行发布。**
> 本阶段没有创建任何托管项目、没有部署、没有改域名/DNS/账号。
> 代码提交 `836bcc5` 已在 `origin/main`（推送发生在审查期间，本会话未执行 push）；
> **远端有代码不等于有站点**，下面的步骤在用户明确授权后才执行。

## 1. 推荐方案

**默认：Cloudflare Pages。**

决定性理由不是价格，而是**它支持自定义响应头**：本项目的 CSP、
`X-Frame-Options`、HSTS、按路径缓存都写在 `public/_headers` 里，
Cloudflare Pages 会解析这个文件并下发；GitHub Pages 没有等效能力。
其余理由：

- 免费额度对本站绰绰有余：产物 **412 KB / 8 个文件**，限额是 20,000 文件、单文件 25 MiB；
  免费版 **500 次构建/月**、1 个并发构建、单次构建 20 分钟超时（[官方限额页](https://developers.cloudflare.com/pages/platform/limits/)，2026-09-05 更新）。
- 官方限额页**没有带宽条目**（不按带宽计费），静态站点不存在流量账单。
- Git 集成：推送到 `main` 自动构建；其他分支生成预览部署，可在合并前用真实 URL 验收。
- 自定义域名 + 自动 HTTPS；部署历史里可**一键回滚**到任一先前部署。
- 不需要 Pages Functions / Cloudflare Workers：项目的“Worker”是浏览器里的
  **Web Worker**，与边缘函数无关，产物里就是同源的 `worker-<hash>.js`。

**降级方案：GitHub Pages**。只有在「必须把站点和仓库放在同一个平台」时才选它，
代价是安全头无法落地（见 §2）。

## 2. 平台对比

| 维度 | Cloudflare Pages（推荐） | GitHub Pages | 自建静态服务器 |
| --- | --- | --- | --- |
| 接入复杂度 | 低：连仓库、填两条命令 | 低：Actions 工作流 | 高：要管机器、证书、发布脚本 |
| 免费额度 | 500 构建/月、20,000 文件、25 MiB/文件；无带宽条目 | 站点 ≤1 GB；**100 GB/月软带宽**；10 次构建/小时软限制（用自定义 Actions 工作流时不适用）；部署 10 分钟超时（[官方限额页](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)） | 取决于机器与流量 |
| 产物规模 | 412 KB / 7 文件，远低于限额 | 远低于限额 | — |
| HTTPS | 自动 | 自动 | 自行配置 |
| 自定义域名 | 支持 | 支持 | 支持 |
| Git 自动部署 | 支持（含分支预览） | 支持（Actions） | 需自己写 |
| 回滚 | **部署历史一键回滚** | revert 后重新部署；无“切换部署”按钮 | 自行实现 |
| 自定义响应头 | **支持 `_headers`** | **不支持** | 支持（自己配） |
| 缓存控制 | `_headers` 按路径设置 | 不可配置 | 自己配 |
| 404 页 | 使用 `404.html` | 使用 `404.html` | 自己配 |
| 维护成本 | 极低 | 极低 | 高 |

**GitHub Pages 的硬伤**：CSP、`X-Frame-Options`、`Referrer-Policy`、HSTS
都无法通过响应头下发。`<meta http-equiv="Content-Security-Policy">` 能表达一部分策略，
但 **`frame-ancestors` 在 meta 中无效**，且无法设置 HSTS / Permissions-Policy。
如果最终只能选 GitHub Pages，必须在发布说明里明确「安全头未落地」，
而不是假装 `_headers` 会生效。

**Netlify / Vercel** 也能满足需求（都支持自定义头），本轮没有逐项核对它们的
免费额度，故不作为默认推荐；若用户已有其中一个账号，可按同一份构建配置迁移。

## 3. 构建配置（两个平台通用）

| 项 | 值 |
| --- | --- |
| 安装命令 | `yarn install --frozen-lockfile` |
| 构建命令 | `yarn build` |
| 输出目录 | `dist` |
| Node | 与 CI 一致用 26（`NODE_VERSION=26`）；若平台镜像尚未提供，退到 22，并在本地用同一大版本复跑门禁 |
| 环境变量 | 无（根路径部署）；子路径部署见 §4 |
| 产物内不应出现 | `.env`、源码映射、`localhost`、第三方 URL |

> 首次在平台构建时，必须核对 **Node 大版本**与本地/CI 一致。版本漂移会让
> `tsc -b` 或 Vite 构建行为变化，这类问题本地复现不了。

## 4. 路径策略

- **根路径部署**（`https://<project>.pages.dev/`、`https://gomoku.example.com/`）：
  直接 `yarn build`，`base` 默认 `/`。
- **子路径部署**（`https://example.com/gomoku/`）：`VITE_BASE=/gomoku/ yarn build`，
  末尾必须有斜杠。产物里的 HTML、JS、CSS、favicon、Worker chunk 都会带前缀。
- 两种方式都已在本地验证：子路径构建后
  `grep -o 'src="[^"]*"' dist/index.html` 得到 `/gomoku/assets/...`。
- 站内没有前端路由，**不需要 SPA fallback / rewrite 规则**；唯一有效入口是 `/`。
- `public/404.html` 的返回链接写的是 `/`，按**根路径部署**设计。若确实要部署到子路径，
  必须把它改成对应的前缀（或改用同源的相对入口），否则从深层 404 返回会落到站点根。

## 5. Cloudflare Pages 操作步骤（授权后执行）

### 5.1 Git 集成（推荐）

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git。
2. 选择仓库与分支 `main`。
3. 构建配置：Framework preset `None`；Build command `yarn build`；
   Build output directory `dist`。
4. 环境变量：`NODE_VERSION=26`（若镜像不支持则 22，并在本地复跑门禁）。
5. 首次部署完成后，用分配到的 `*.pages.dev` 域名做 §6 的验收。
6. 验收通过后再绑定自定义域名；绑定前确认用户已同意域名与公开策略。

### 5.2 直接上传（备选，不做 Git 集成）

```bash
yarn build
npx wrangler pages deploy dist --project-name gomoku-lab
```

需要 Cloudflare 登录与项目创建权限；**本阶段不执行**。

> `public/_headers` 会被复制到 `dist/_headers`。Cloudflare Pages 解析它并
> **不会**把它当静态资源下发；本地验证时用等价服务器注入同样的头即可。

## 6. 部署后验收（staging）

```bash
BASE=https://<staging-domain>

# 1) 首页与关键资源
curl -sI "$BASE/" | grep -iE 'content-security-policy|x-frame-options|referrer-policy|permissions-policy|strict-transport-security'
curl -sI "$BASE/assets/$(curl -s "$BASE/" | grep -o 'index-[^"]*\.js' | head -1)" | grep -i cache-control

# 2) 元数据
curl -s "$BASE/robots.txt"
curl -s "$BASE/" | grep -o '<title>[^<]*'

# 3) 404
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/does-not-exist"   # 期望 404
```

浏览器侧按 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 的「staging 冒烟」逐项过：
首屏、AI 应手（Worker）、刷新恢复、教学完成、残局多解、复盘、深浅主题、
390/768/1440 三档、控制台 0 error、Network 面板只有同源请求。

## 7. 缓存与更新

- `/assets/*`：文件名带内容哈希，`Cache-Control: public, max-age=31536000, immutable`。
  更新版本必然换文件名，不会读到旧代码。
- `/` 与 `/index.html`：`max-age=0, must-revalidate`，每次回源校验，避免入口被缓存住。
- `/robots.txt`：1 小时。
- 回滚不需要清 CDN：回滚切换的是整套部署，旧哈希资源仍在旧部署里。

## 8. 明确不做

- 不添加第三方统计 / 广告 / 追踪 / 远程字体 / 新外部 API。
- 不添加后端、账号、云数据库；本地优先的定位不变。
- 不为部署引入 Service Worker；断网刷新仍需要能访问宿主。
- 不修改远端仓库权限、域名、DNS 或账号设置。
- 不在本阶段向任何平台发布。
