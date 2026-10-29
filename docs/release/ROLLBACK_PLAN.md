# 回滚方案（Phase 09A）

> 目标：**任何一次发布出问题时，能在几分钟内回到上一个已知可用的版本**，
> 并且说清楚回滚不会修好什么、会丢什么。

## 1. 触发条件

满足任意一条即回滚，不做“再观察一下”：

- 首屏白屏、JS 报错、棋盘不渲染；或某个主流程（对战/教学/残局/复盘）不可用。
- Worker 加载失败，AI 不走子。
- 刷新后进度或棋谱丢失（且不是浏览器隐私模式/清数据导致）。
- 安全头缺失、CSP 误杀主流程，或页面被意外嵌入 iframe。
- 404 / 资源路径错（子路径部署时最容易发生）。

## 2. 回滚路径（按优先级）

### 2.1 Cloudflare Pages：切换到上一个部署（首选，秒级）

1. Dashboard → Workers & Pages → 项目 → **Deployments**。
2. 找到上一个验收通过的部署（按时间与提交号确认）。
3. 该部署右侧菜单 → **Rollback**。

回滚切换的是**整套部署**，不重新构建；旧部署的哈希资源仍在其下，入口页
`index.html` 会重新指向旧的 `index-<hash>.js`。无需清 CDN 缓存。

**验收**：

```bash
BASE=https://<domain>
curl -s "$BASE/" | grep -o 'index-[^"]*\.js'      # 应回到旧哈希
curl -sI "$BASE/" | grep -i content-security-policy
# 再走一遍 RELEASE_CHECKLIST 的 staging 冒烟
```

### 2.2 Git revert + 重新部署（仅在启用 Git 自动部署后可用）

**当前项目未启用 Git 集成**（Cloudflare Pages 显示 `Git Provider: No`），
所以 `git push` 不会自动构建、也不会自动上线。只有将来显式开启 Git 集成后，
下面这条才会触发部署：

```bash
git revert --no-edit <bad-commit>
git push origin main        # 仅在启用 Git 集成后触发构建
```

当前若要保留提交历史地回滚，revert 之后必须再按 2.3 手动部署。
**注意**：revert 会新增一个提交；不要用 `git reset --hard` 改写已发布的历史。

### 2.3 手动直传（当前实际方式）

```bash
git checkout <last-good-commit>
yarn install --frozen-lockfile
yarn build
npx wrangler pages deploy dist --project-name gomoku-lab --branch main \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "rollback to <last-good-commit>"
```

这是当前所有发布的实际路径（2.1 的 Dashboard Rollback 除外），不是「紧急」专用。
执行前必须确认 `git status` 干净、提交号正确、`dist/index.html` 的
`build-commit` 与目标提交一致。

## 3. 回滚不会修好什么

| 项 | 说明 |
| --- | --- |
| 已缓存的入口页 | 入口 `max-age=0, must-revalidate`，下一次加载会回源；没有 Service Worker，不存在“客户端继续跑旧代码” |
| 用户本地数据 | IndexedDB / localStorage 属于同源，回滚**不会**清掉，也不会自动迁移 |
| 新版本写入的进度格式 | 当前版本没有提升 `PROGRESS_SCHEMA_VERSION`，回滚安全；**若未来跨 schema 版本回滚，旧代码会丢弃新格式进度**——那时必须先评估数据损失 |
| 自定义域名 / DNS 问题 | 回滚应用版本不修 DNS；需单独恢复域名解析（本阶段未改过 DNS） |
| 平台侧故障 | Cloudflare 自身故障时回滚无效，属于平台事件，按平台状态页处理 |

## 4. 数据影响评估（当前版本）

### 4.0 当前生产（2026-10-29）

- 当前生产：`f3301897-095b-4223-8e84-220016c856b9`（`db8881c` / 0.5.0）。
- 上一部署：`bb679255…`（`1f60604`）→ `c299d837…`（`6616ebe`，首发）→ `07a264f2…`（`d20eca9`，0.4.0）。
- 0.5.0 与 0.4.0 均为 DB3；回滚不涉及降级打开。回滚到 0.3.0（DB2）前必须先导出自定义局面。
- 标签：`v0.5.0 → 6616ebe`；`v0.5.0+build.1 → 1f60604`；`v0.5.0+build.2 → db8881c`。



- 学习进度：`schemaVersion = 1`；棋谱：`schemaVersion = 1`；对局存档：`schemaVersion = 2`。
- Phase 09B 与 Phase 10F **都没有**改动这三个版本号，因此「回滚到上一版」不会触发任何丢弃路径。
- 历史 0.2.0 部署为 `d3f5f6cc…`（`b67ea93`）；上一部署 `e5a32d20…`（`2ec65fa`）。
- 进度写入是 latest-wins 串行队列；回滚只影响后续写入的格式，不影响已落盘数据。
- 升级方向（旧 → 新）已验证：v1 只有 progress 表的老库升级到 v2 后，旧进度原样读回；
  另注入 `schemaVersion = 1` 的旧棋谱，复盘页能正常列出。

## 5. 回滚演练（2026-10-21，已执行）

在隔离预览项目 `gomoku-lab-preview` 上真实执行，未触碰生产：

1. 部署 `0.2.0` 候选 → `b21394c5-5179-4053-b19f-455e06aaf213`。
2. 回滚到上一部署 `0954a194-18a1-465f-a186-c0f36523e4ef`（`2ec65fa`）：
   项目域入口从 `index-maCHdY9Y.js` 变回 `index-BZwilo3W.js`。
3. 再切回 `b21394c5`：入口恢复 `index-maCHdY9Y.js`，`build-commit` 回到 `b67ea93`。
4. 两次切换均在数秒内生效，无需重新构建；未观察到异常。

生产发布后保留了 `e5a32d20…` 作为上一部署，但**未回滚生产**。
命令行等价操作：用 Cloudflare API 的 deployment rollback 端点；
Dashboard 操作路径见 §2.1，两者切换的都是整套部署，不是重新构建。

## 6. 发布记录模板

| 项 | 内容 |
| --- | --- |
| 部署时间 | |
| 部署提交 | |
| 部署 ID / URL | |
| 验收人 | |
| 验收结果 | |
| 是否回滚 | 否 / 是（原因、回滚到的部署 ID、耗时） |
