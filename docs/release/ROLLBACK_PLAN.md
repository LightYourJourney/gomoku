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

### 2.2 Git revert + 重新部署（需要保留提交历史时）

```bash
git revert --no-edit <bad-commit>
git push origin main        # 触发自动构建
```

构建约几分钟。适合“问题明确、回滚后还要继续修”的场景。
**注意**：这会新增一个提交；不要用 `git reset --hard` 改写已发布的历史。

### 2.3 紧急直传（Git 集成不可用时）

```bash
git checkout <last-good-commit>
yarn install --frozen-lockfile
yarn build
npx wrangler pages deploy dist --project-name gomoku-lab
```

仅在前两条都不可用时使用；执行前必须确认 `git status` 干净、提交号正确。

## 3. 回滚不会修好什么

| 项 | 说明 |
| --- | --- |
| 已缓存的入口页 | 入口 `max-age=0, must-revalidate`，下一次加载会回源；没有 Service Worker，不存在“客户端继续跑旧代码” |
| 用户本地数据 | IndexedDB / localStorage 属于同源，回滚**不会**清掉，也不会自动迁移 |
| 新版本写入的进度格式 | 当前版本没有提升 `PROGRESS_SCHEMA_VERSION`，回滚安全；**若未来跨 schema 版本回滚，旧代码会丢弃新格式进度**——那时必须先评估数据损失 |
| 自定义域名 / DNS 问题 | 回滚应用版本不修 DNS；需单独恢复域名解析（本阶段未改过 DNS） |
| 平台侧故障 | Cloudflare 自身故障时回滚无效，属于平台事件，按平台状态页处理 |

## 4. 数据影响评估（当前版本）

- 学习进度：`schemaVersion = 1`；棋谱：`schemaVersion = 1`；对局存档：`schemaVersion = 2`。
- 本次发布**没有**改动这三个版本号，因此「回滚到上一版」不会触发任何丢弃路径。
- 进度写入是 latest-wins 串行队列；回滚只影响后续写入的格式，不影响已落盘数据。
- 升级方向（旧 → 新）已验证：v1 只有 progress 表的老库升级到 v2 后，旧进度原样读回。

## 5. 回滚演练

**公开发布前必须演练一次**（本阶段未执行，因为没有真实项目）：

1. 在 preview / staging 上部署新版本。
2. 按 2.1 回滚到上一部署，确认入口哈希变化、页面可用。
3. 再切回新版本，确认数据仍在、进度可续。
4. 记录实际耗时与任何异常到发布记录里。

## 6. 发布记录模板

| 项 | 内容 |
| --- | --- |
| 部署时间 | |
| 部署提交 | |
| 部署 ID / URL | |
| 验收人 | |
| 验收结果 | |
| 是否回滚 | 否 / 是（原因、回滚到的部署 ID、耗时） |
