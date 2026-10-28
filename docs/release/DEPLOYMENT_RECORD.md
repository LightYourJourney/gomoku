# 部署记录

> 这份文件记录**已经发生过的真实部署**：什么时候、把哪个提交、部署到了哪里，
> 以及线上验收的原始读数。与方案/清单分开，避免「计划」和「事实」混写。
> 最新一次在最上面。

## Phase 11C/11D/11E · 0.5.0（当前生产）

| 项 | 值 |
| --- | --- |
| 应用版本 | `0.5.0` |
| 引擎版本 | `search-1`（未改语义） |
| 提交 / 标签 | `db8881c`（终审 App 热修）/ `v0.5.0+build.2`；`v0.5.0` 保留首发 `6616ebe`，`v0.5.0+build.1` 指向前一热修 `1f60604` |
| 生产部署 | `f3301897-095b-4223-8e84-220016c856b9`（https://f3301897.gomoku-lab.pages.dev） |
| 生产地址 | **https://gomoku-lab.pages.dev** |
| 预览部署 | `a7b4ac2d-5ea0-4a28-b92d-d9f02b2054c0`（https://a7b4ac2d.gomoku-lab-preview.pages.dev） |
| 部署时间 | 2026-10-28（UTC+8） |
| 回滚目标 | `bb679255-05b9-430f-b8bf-735a7c9af974`（前一热修 `1f60604`）→ `c299d837…`（首发）→ `07a264f2…`（0.4.0） |
| 产物 | 8 文件 / 484 KB；`index-eXmydIYX.js`、`index-CFWSMnlC.css`、`worker-B6Ge9L6W.js` |
| 验收 | CI `40720509578` 五 job 全绿；预览与生产 `e2e:remote` 均 **189/189**；生产 meta `app-version=0.5.0`、`build-commit=db8881c…`；CSP/HSTS/X-Frame-Options 正常 |

- **授权**：用户 2026-10-28 明确要求“确认 CI 全绿，再部署”。
- **P2 决定**：05/08/09/10 接受并披露；06/07 作为发布阻断并已修复。
- **回滚**：先切回 `c299d837…`（首发 0.5.0），再回滚 `07a264f2…`（0.4.0）；DB 仍为 3。
- **已部署**：终审整改 `db8881c`（App hash 续走范围、回归与文档）已上线。

## Phase 11B · 棋盘编辑器与局面研究 0.4.0（历史）

| 项 | 值 |
| --- | --- |
| 应用版本 | `0.4.0` |
| 引擎版本 | `search-1`（本阶段未改搜索/评估语义） |
| 提交 | `d20eca9d1090dfb7e2c19efe947c97931d10e3d7` |
| Git 标签 | `v0.4.0`（指向 `d20eca9`） |
| 生产项目 | `gomoku-lab` |
| 生产地址 | **https://gomoku-lab.pages.dev** |
| 生产部署 ID | `07a264f2-baa4-4bec-b746-d27867e361af` |
| 部署时间 | 2026-10-24 23:00（UTC+8） |
| 部署方式 | `npx wrangler@4.151.3 pages deploy dist --project-name gomoku-lab --branch main --commit-hash d20eca9…`（Git 自动部署仍未启用） |
| 预览项目 / 部署 | `gomoku-lab-preview` / `3c2b66a2-a936-49f2-b697-4dc308a90da5` |
| 上一生产部署（回滚目标） | `f02c38ca-372b-47d9-8c34-9374dbcd77d1`（`0.3.0` / `1cd2be0`） |
| 产物 | 8 文件 / 464 KB；`index.html`、`assets/index-DMiHvN23.js`、`assets/index-Dr4TU3Zd.css`、`assets/worker-B6Ge9L6W.js` |

### 发布授权与前置状态

- **授权**：用户于 2026-10-24 明确要求「发布并部署」；授权覆盖提交 `d20eca9`
  与 `v0.4.0`，不包含域名、环境变量、数据策略或权限变更。
- **发布前**：`main` 干净 @ `d20eca9`；CI run `40099529506` 五个 job 全绿；
  生产仍为 `f02c38ca…`（0.3.0），预览仍为 `f2b3eca8…`（0.3.0）。
- **门禁**：单测 1,331；本地 E2E 174；`e2e:prod` 6；Firefox/WebKit 12；
  UI 探针 38 状态 / 308 张；覆盖棘轮 3,084；基准 19/19 + 29 不变量。
  发布后阶段验收补充了 2 条单测、2 条 E2E（390/768/1024/1440 与深色主题、v2→v3 旧库兼容；
  生产代码未变；当前仓库基线为 1,333 / 177 / 18）。

### 1. 资源指纹（生产实测，与本地 `dist/` 逐字节一致）

| 资源 | 大小 | SHA-256 |
| --- | --- | --- |
| `index.html` | 832 B | `e9def5b8999b10410a29706928e466ab432e6e9b5163f26a47fca5ffe137bade` |
| `assets/index-DMiHvN23.js` | 392,458 B | `13acde0ac5cb79a02505dfcd75931b8bac0c31d9596b6fbdd2c808593a7b688f` |
| `assets/worker-B6Ge9L6W.js` | 13,994 B | `696a075240aa0f825239004f3ba70d7e6f085bb9d22ebfeb3e32c238c59aa79b` |
| `assets/index-Dr4TU3Zd.css` | 35,250 B | `829e4089a3fa701d13dd441f3e459638d4689a3d5979b731e5806cbc3fc87e6b` |

### 2. 预览与生产验收

| 项 | 预览 | 生产 |
| --- | --- | --- |
| `yarn e2e:remote` | **174 / 174** | **174 / 174** |
| 编辑器：编辑/撤销/重做/键盘 | ✅ | ✅ |
| 保存 → 刷新 → 打开 → 删除 | ✅ | ✅ |
| 从合法棋谱载入第 9 手 | ✅ | ✅ |
| AI 五档与「技术细节」预算 | ✅ | ✅ |
| 导入/导出局面文件 | ✅ | ✅ |
| 移动端/平板触摸编辑与两栏 | ✅ | ✅ |
| CSP / HSTS / X-Frame-Options / 缓存 | ✅ | ✅ |
| 404 / robots.txt | ✅ | ✅ |

预览首次全量受网络抖动影响只完成 68 条；拆分 Chrome 152、移动 12、平板 10
全部通过后，全量复跑 174/174。生产首次全量 174/174（7.6 分钟）。

### 3. 数据兼容

- `DB_VERSION` 2 → 3，新增 `positions` 表；`progress` / `records` 不动。
- 局面记录 schema v2；旧 v1 记录只读迁移，时间显示「时间未知」。
- **回滚注意**：0.3.0（DB 2）无法直接打开 DB 3。回滚前先导出需保留的局面；
  回滚不会删除 IndexedDB 数据，但编辑器在该版本不可用。

### 4. 回滚

目标 `f02c38ca…`（0.3.0）。Dashboard → Pages → `gomoku-lab` → Deployments →
Rollback；或重新部署 `1cd2be0` 的 `dist/`。执行前按上节评估 DB 3 影响。

### 5. 已知限制

静态合法性不证明合法历史；AI 专家档更慢；跨浏览器只覆盖编辑器主路径；
无局面重命名；仅 Chrome/Firefox/WebKit 自动化，无 Safari/iOS 真机；
手动部署、`*.pages.dev`。


## Phase 11A · 数据备份与导入导出 0.3.0（历史）

| 项 | 值 |
| --- | --- |
| 应用版本 | `0.3.0` |
| 引擎版本 | `search-1`（本阶段未改搜索/评估语义） |
| 提交 | `1cd2be0d7c7bf3ee6ae0b24ae09d72e822f79fb8` |
| Git 标签 | `v0.3.0`（指向 `1cd2be0`） |
| 生产项目 | `gomoku-lab` |
| 生产地址 | **https://gomoku-lab.pages.dev** |
| 生产部署 ID | `f02c38ca-372b-47d9-8c34-9374dbcd77d1` |
| 部署时间 | 2026-10-23（UTC+8） |
| 部署方式 | `npx wrangler@4.151.3 pages deploy dist --project-name gomoku-lab --branch main --commit-hash 1cd2be0…`（Git 自动部署仍未启用） |
| 预览项目 / 部署 | `gomoku-lab-preview` / `f2b3eca8-68f7-4440-88d1-56318b5f03c9` |
| 上一生产部署（回滚目标） | `d3f5f6cc-673e-4391-a418-13b5830d633a`（`0.2.0` / `b67ea93`） |
| 产物 | 8 文件 / 418 KB；`index.html`、`assets/index-7a8i5tmm.js`、`assets/index-kfu74e6U.css`、`assets/worker-B6Ge9L6W.js` |

### 发布授权与前置状态

- **授权**：用户于 2026-10-23 明确要求「发布 Phase 11A 到生产」；授权覆盖提交
  `1cd2be0` 与 `v0.3.0`，不包含域名、环境变量、数据策略或权限变更。
- **未启用 Git 自动部署**：Cloudflare Pages `Git Provider: No`；本次仍为手动覆盖。
- **发布前**：`main` 干净 @ `1cd2be0`；CI run `39818140559` 四个 job 全绿；
  生产仍为 `d3f5f6cc…`（0.2.0），预览仍为 `b21394c5…`（0.2.0）。

### 1. 资源指纹（生产实测，与本地 `dist/` 逐字节一致）

| 资源 | 大小 | SHA-256 |
| --- | --- | --- |
| `index.html` | 832 B | `079928672f4aba275089191b326638df645b104cea889c6959dd8292d5823c4a` |
| `assets/index-7a8i5tmm.js` | 367,596 B | `560e34d26ba16262ba7ef997ae3d1df2ec237586aacb541b50caecddf643eb03` |
| `assets/worker-B6Ge9L6W.js` | 13,994 B | `696a075240aa0f825239004f3ba70d7e6f085bb9d22ebfeb3e32c238c59aa79b` |
| `assets/index-kfu74e6U.css` | 35,212 B | `8633c91095658fe2abf7da652bd4799888d7336d85e7c1bddeb9b2349bcaae5f` |

### 2. 预览与生产验收

| 项 | 预览 | 生产 |
| --- | --- | --- |
| `yarn e2e:remote` | **166 / 166** | **166 / 166** |
| 数据管理面板 / 导入导出 | ✅ | ✅ |
| 备份恢复（棋谱/进度/偏好/会话） | ✅ | ✅ |
| 严格导入零写入 / 取消零写入 | ✅ | ✅ |
| Worker / CSP / 4xx / 第三方 | ✅ 0 / 0 / 0 | ✅ 0 / 0 / 0 |

生产首次全量有一次落子坐标用例超时，单跑复过；复跑全量 166/166。

### 3. 数据兼容

DB `2`、进度 `1`、棋谱 `1`、会话 `2` 均未改。旧进度/旧棋谱可读，v1 会话
只读迁移；导入只合并，不删除现有记录。回滚不会清空 IndexedDB。

### 4. 回滚

目标 `d3f5f6cc…`（0.2.0）。Dashboard → Pages → `gomoku-lab` → Deployments →
Rollback；或重新构建 `b67ea93` 的 `dist/` 手动部署。

### 5. 已知限制

只合并不替换；10 MiB / 2,000 局上限；偏好/会话与 IndexedDB 不同事务；
仅 Chrome/Chromium 实测；仍为手动部署、`*.pages.dev`。


## Phase 10F · AI 引擎 0.2.0（历史）

| 项 | 值 |
| --- | --- |
| 应用版本 | `0.2.0` |
| 引擎版本 | `search-1`（Phase 10C 只改执行速度，未改决策语义） |
| 提交 | `b67ea930528375e2cff21bcb3c9332c82061a75e` |
| Git 标签 | `v0.2.0`（指向 `b67ea93`） |
| 生产项目 | `gomoku-lab` |
| 生产地址 | **https://gomoku-lab.pages.dev** |
| 生产部署 ID | `d3f5f6cc-673e-4391-a418-13b5830d633a` |
| 部署时间 | 2026-10-21（UTC+8） |
| 部署方式 | `npx wrangler@4.151.3 pages deploy dist --project-name gomoku-lab --branch main --commit-hash b67ea93…`（Git 自动部署仍未启用） |
| 预览项目 / 部署 | `gomoku-lab-preview` / `b21394c5-5179-4053-b19f-455e06aaf213` |
| 上一生产部署（回滚目标） | `e5a32d20-5523-4cdd-b6a8-88db36a35f1f`（`2ec65fa`） |
| 产物 | 8 文件 / 416 KB；`index.html`、`assets/index-maCHdY9Y.js`、`assets/index-DcvwGzkf.css`、`assets/worker-B6Ge9L6W.js` |

### 发布授权与前置状态

- **授权**：用户于 2026-10-21 在本会话中明确批准将提交 `b67ea93` 发布到生产，
  并批准创建 `v0.2.0` 标签；授权只覆盖该提交与标签，不包含域名、环境变量、
  数据策略或权限变更。
- **未启用 Git 自动部署**：Cloudflare Pages 项目显示 `Git Provider: No`；
  本次仍为手动 Wrangler 覆盖，推送 `main` 不会自动上线。
- **发布前核实**（2026-10-21，部署前）：

| 项 | 发布前状态 |
| --- | --- |
| `main` | `fa78e39` |
| 最新 CI | run `39615200353` 成功（`fa78e39`，四个 job 全绿） |
| 生产部署 | `e5a32d20-5523-4cdd-b6a8-88db36a35f1f`，Source `2ec65fa` |
| 生产入口 / Worker | `assets/index-BZwilo3W.js` / `assets/worker-N-PbjJma.js`（11,771 B） |
| 增量评估 | 旧 Worker 不含该路径；候选 `search.ts` 走 `createIncrementalEvaluator` |
| 仓库与生产差异 | 生产停在 `2ec65fa`；仓库已含 Phase 10D / 10E / 10F |
| 发布记录 | 只有 Phase 09B；需要补 Phase 10F |

### 1. 资源指纹（生产实测，与本地 `dist/` 逐字节一致）

| 资源 | 大小 | SHA-256 |
| --- | --- | --- |
| `index.html` | 832 B | `cb8d2c860ff15ca1359b2045877b339f254bb107fa4050a8f9ddbb3fe66b66bd` |
| `assets/index-maCHdY9Y.js` | 343,278 B | `e2fce81d690cdd81d4fcc0c0dfdf41d2e84cd2cd0dbd05d351f0cd81bb44366e` |
| `assets/worker-B6Ge9L6W.js` | 13,994 B | `696a075240aa0f825239004f3ba70d7e6f085bb9d22ebfeb3e32c238c59aa79b` |
| `assets/index-DcvwGzkf.css` | 35,177 B | `2ed40fe89e4ab1a2e74fafea78f07be7257a87ff54cb3f342e62908cfba55a97` |

增量评估的构建证据：Phase 09B 的 `worker-N-PbjJma.js` 为 11,771 B，不含该路径；
本次 `worker-B6Ge9L6W.js` 为 13,994 B，SHA 与 `b67ea93` 的本地构建一致，
而该提交的 `src/ai/search.ts` 叶子评分走 `createIncrementalEvaluator`。

`index.html` 的 meta 直接给出可核验的版本：

```
app-version    = 0.2.0
engine-version = search-1
build-commit   = b67ea930528375e2cff21bcb3c9332c82061a75e
```

### 2. 发布前门禁

| 命令 | 结果 |
| --- | --- |
| `yarn lint` / `yarn typecheck` | ✅ |
| `yarn test` | ✅ 1,220 / 1,220（75 文件） |
| `yarn build` | ✅ 重复构建哈希一致 |
| `yarn e2e` | ✅ 162 / 162 |
| `yarn e2e:prod` | ✅ 6 / 6（新增构建版本标识用例） |
| `yarn gates` | ✅ 循环 0 / knip 通过 / 0 重复 / 棘轮 1,220 · 162 |
| `yarn bench:check` | ✅ 19/19 断言 + 29 不变量 |
| CI `quality` @ `b67ea93` | ✅ run `39620082908`，fast / e2e / probe / bench 四 job 全绿 |

### 3. 预览与生产验收

| 项 | 预览 | 生产 |
| --- | --- | --- |
| `yarn e2e:remote` | **162 / 162** | **162 / 162** |
| 五档 AI 应手 | ✅ 本次 1 / 2 / 4 / 6 / 6 | ✅ 本次复验 1 / 2 / 4 / 5 / 6（高级 1600 ms、专家 2600 ms 均超时回退） |
| 专家 2600 ms 超时回退 | ✅ 显示启发式免责说明 | ✅ 实际观测到 |
| 提示 | ✅ 3 个候选，手数不变 | ✅ 同左 |
| 复盘分析 | ✅ 9 / 9，引擎 `search-1` | ✅ 同左 |
| Worker | ✅ 每页 1 个 `worker-B6Ge9L6W.js` | ✅ 同左 |
| CSP / 4xx / 第三方请求 | ✅ 0 / 0 / 0 | ✅ 0 / 0 / 0 |
| 移动端 | ✅ Pixel 7 触屏 11 条 | ✅ 同左（另含 iPad 横竖屏 9 条） |
| 边缘配置 | — | ✅ `worker-src 'self'`、`/assets/*` immutable、入口 `must-revalidate`、自定义 404 |

### 4. 回滚演练（预览环境真实执行）

- `b21394c5`（0.2.0）→ `0954a194`（`2ec65fa`）：项目域入口变回 `index-BZwilo3W.js`。
- `0954a194` → `b21394c5`：入口恢复 `index-maCHdY9Y.js`，`build-commit` 回到 `b67ea93`。

两次均在数秒内完成，无需重建。**生产未执行回滚**；`e5a32d20…` 保留为可用的上一部署。

### 5. 数据兼容

学习进度 `schemaVersion = 1`、棋谱 `1`、对局存档 `2`，本次均未改动。
真实浏览器中把 v1 旧库（只有 `progress`）升级到 v2（`progress` + `records`），
旧学习进度原样读回；另注入 `schemaVersion = 1` 的旧棋谱，复盘页正常列出
「黑方胜 · 双人 · 9 手」。回滚不会触发丢弃路径。

### 6. 已知限制

| 项 | 说明 |
| --- | --- |
| 专家等待 | 仍约 2.6 s，约 43% 搜索超时后回退启发式；不承诺 8 层 |
| 战术题集 | 一手题集五档全过，存在天花板效应，不能据此给档位排名 |
| 浏览器 | 仅 Chrome / Chromium 实测；Safari / Firefox 未验 |
| 设备 | 无低端真机数据；4× CPU 限速仅作参考 |
| 部署方式 | 仍为手动 Wrangler；未开启 Git 自动部署 |
| 域名 | 仍使用 `*.pages.dev`；未改 DNS / 自定义域名 |

### 7. 更新流程（当前有效）

```bash
yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e && yarn e2e:prod && yarn gates && yarn bench:check
npx wrangler pages deploy dist --project-name gomoku-lab-preview --branch main \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "…"
REMOTE_BASE=https://<preview-deployment-url> yarn e2e:remote   # 必须 162/162
# 用户明确批准后：
npx wrangler pages deploy dist --project-name gomoku-lab --branch main \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "…"
REMOTE_BASE=https://gomoku-lab.pages.dev yarn e2e:remote
```

---

## Phase 09B · 首次正式部署（历史）

### 1. 本次发布

| 项 | 值 |
| --- | --- |
| 发布版本 | `2ec65fa`（`fix(review): 两轴评审整改——复盘可靠度措辞、基准可复现与文档口径`） |
| 当前 `main` | `46e3652`（仅文档/配置 + 线上验收配置，**运行时产物与 `2ec65fa` 逐字节相同**，已在本地重建比对） |
| 部署平台 | Cloudflare Pages（账号信息已脱敏：账号与 Account ID 不随仓库公开，部署者可在本地 `wrangler` 配置中查看） |
| 生产项目 | `gomoku-lab` |
| 生产地址 | **https://gomoku-lab.pages.dev** |
| 部署 ID | `e5a32d20-5523-4cdd-b6a8-88db36a35f1f` |
| 部署时间 | 2026-10-20 10:26（UTC+8） |
| 部署方式 | `wrangler pages deploy dist --project-name gomoku-lab --branch main`（Git 集成未启用） |
| 产物 | 8 文件 / 412 KB；入口 `index.html`、`assets/index-BZwilo3W.js`、`assets/index-DcvwGzkf.css`、`assets/worker-N-PbjJma.js` |
| 公开范围 | 公开可访问（无账号、无后端、无用户数据上传） |
| 预览环境 | `gomoku-lab-preview` 项目，同一提交 `2ec65fa`，用于正式发布前的验收 |

### 2. 发布前门禁（本机，提交 `2ec65fa`）

| 命令 | 结果 |
| --- | --- |
| `yarn lint` / `yarn typecheck` | ✅ |
| `yarn test` | ✅ 65 文件 / 1085 用例 |
| `yarn build` | ✅ |
| `yarn e2e` | ✅ 162 |
| `yarn e2e:prod` | ✅ 5 |
| `yarn gates` | ✅（棘轮 1085 · 162） |
| `yarn check:coverage` | ✅ 3084 条，未缩小 |
| `yarn ui:probe` | ✅ 38 状态 / 308 张，七条判据全过 |
| `yarn bench:check` | ✅ 19/19 + 29 项不变量 |

### 3. 线上验收（生产地址，真实浏览器）

#### 3.1 边缘配置

| 项 | 实测 |
| --- | --- |
| HTTP | HTTP/2 200，HSTS `max-age=31536000` |
| CSP | `default-src 'self'`；`script-src 'self'`；`worker-src 'self'`；`style-src 'self' 'unsafe-inline'`；`frame-ancestors 'none'` |
| 其余安全头 | `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`、`Permissions-Policy` |
| 缓存 | `/` → `max-age=0, must-revalidate`；`/assets/*` → `max-age=31536000, immutable` |
| 404 | 深层路径返回 404 并展示自定义页 |
| `_headers` | 不可下载（404） |
| 产物一致性 | 首页、JS、CSS、Worker、favicon、robots、404 与本地 `dist/` **SHA-256 逐字节一致** |

#### 3.2 全量 e2e 对线上 URL

`yarn e2e:remote`（`playwright.remote.config.ts`，`REMOTE_BASE` 可覆盖）：

- 预览站：**162 / 162 通过**
- 生产站：**162 / 162 通过**

覆盖：对战、AI Worker 应手、悔棋、认输、终局入库、复盘分析、教学完成与刷新、
残局多解、390 / 768 / 1080 / 1440 / 1920 布局、深浅主题、触屏命中。

#### 3.3 按业务流程走的烟雾（生产 URL）

| 步骤 | 结果 |
| --- | --- |
| 首屏 | ✅ 标题 `Gomoku Lab · 五子棋实验室` |
| 对战 → AI 应手 | ✅ 盘面 2 手（Worker 在生产路径加载成功） |
| 悔棋 | ✅ 回到 0 手 |
| 认输 → 结果弹窗 | ✅ 文案「你认输了」 |
| 本地双人九手成五 → 入库 | ✅ 棋谱「黑方胜 · 双人 · 9 手」 |
| 复盘分析 | ✅「当前第 1 手：与引擎首选相当」 |
| 教学练习判对 → 刷新 | ✅ 回到刚完成的课时 |
| 进度恢复 | ✅「已完成 1 / 8 节」 |
| 残局正确落子 | ✅ 解法 (7,7) 判对 |
| 下一题 | ✅ 已切换 |
| 深色主题刷新保持 | ✅ `theme-color` 前后均为 `#0f1115` |
| 控制台 / 网络 / CSP | ✅ error 0、4xx 0、外源 0、CSP 违规 0 |
| 移动端（390） | ✅ 无横向溢出；触摸落子 + AI 应手 |

合计 **16 / 16**。

#### 3.4 截图

`docs/release/screenshots/`：`desktop-light.png`、`desktop-dark.png`、
`mobile-light.png`、`mobile-dark.png`（1280×900 / 390×844，生产地址实拍）。

#### 3.5 发布过程中修复的一个门禁问题

第一次推送被 `pre-push` 拒绝：`knip` 把 `playwright.remote.config.ts` 判成
「无人使用的文件」——它只通过 CLI 参数被引用，不在 import 图里。
处理方式不是删掉它，而是转成正式能力：加 `yarn e2e:remote`、
纳入 `tsconfig.e2e.json`、在 `knip.jsonc` 的 `entry` 里登记并写明理由。

另外两次推送失败是**网络层**（`HTTP2 framing layer` / 连接超时）而非门禁；
改用 SSH 推送成功，`origin` 仍是 HTTPS，未改动仓库的远程配置。

### 4. 自动部署与更新流程

当前是**手动部署**（Git 集成未启用）：

```bash
yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e && yarn e2e:prod && yarn gates
yarn e2e:remote                                  # 先对当前线上跑一遍，确认基线是绿的
npx wrangler pages deploy dist --project-name gomoku-lab --branch main
REMOTE_BASE=https://gomoku-lab.pages.dev yarn e2e:remote   # 部署后复验
```

若要改成 Git 自动部署：Cloudflare Dashboard → Pages → `gomoku-lab` → Settings →
Build & deployments → 连接 Git 仓库，Build command `yarn build`，输出目录 `dist`，
环境变量 `NODE_VERSION=26`。**启用后每次推 `main` 都会自动上线**，需要先确认这一步。

### 5. 回滚（已在真实环境验证路径可用）

Cloudflare Dashboard → Pages → `gomoku-lab` → Deployments → 选中上一部署 → **Rollback**。

Phase 09B 发布时只有一次生产部署，尚无「上一版」可回；Phase 10F 起该按钮已有真实上一部署
（`e5a32d20…`）可回。命令行等价操作留档：重新部署旧提交的 `dist/`（需先 checkout 旧提交并构建）。

**数据兼容**：本次未改动任何 `schemaVersion`（进度 1 / 棋谱 1 / 存档 2），
回滚不会触发数据丢弃。

### 6. 已知限制

| 项 | 说明 |
| --- | --- |
| 无 Git 自动部署 | 目前靠手动 `wrangler pages deploy`，推送不会自动上线 |
| 无自定义域名 | 使用 `*.pages.dev`；绑定自定义域名需额外确认 DNS |
| 仅 Chrome 实测 | Playwright 的 mobile/tablet 项目也是 Chromium 内核；Safari/Firefox 未验 |
| 数据不跨域迁移 | `localhost` 与 `gomoku-lab.pages.dev` 不同源，本地进度不会带过去 |
| 关闭前落盘不保证 | 见 RELEASE_READINESS §3.3 |
| 无 Service Worker | 断网刷新需要能访问宿主 |
