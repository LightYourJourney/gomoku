# AI 引擎版本发布准备（Phase 10E）

**评估日期**：2026-10-21
**候选版本**：Phase 10E 提交（审计基线 `8160d92`；构建产物见下）
**生产版本**：Phase 09B（`index-BZwilo3W.js` / `worker-N-PbjJma.js`）
**结论**：**有条件可以发布**。技术门禁全部通过；条件见 §8。
**本次未部署任何环境**，生产、预览、域名、环境变量、数据策略均未改动。

## 1. 候选与生产差异

| 资源 | 生产 | 候选 | 变化 |
| --- | --- | --- | --- |
| 入口 | `index.html` | `index.html` | 无结构变化 |
| 主 JS | `assets/index-BZwilo3W.js`（342,495 B） | `assets/index-maCHdY9Y.js`（343,278 B） | +783 B（+0.23%） |
| Worker | `assets/worker-N-PbjJma.js`（11,771 B） | `assets/worker-B6Ge9L6W.js`（13,994 B） | +2,223 B（+18.9%） |
| CSS | `assets/index-DcvwGzkf.css` | 同名同内容 | 0 |
| gzip 主 JS | 106,843 B | 107,191 B | +348 B |
| gzip Worker | 4,449 B | 5,394 B | +945 B |

SHA-256：

- 候选主 JS：`e2fce81d690cdd81d4fcc0c0dfdf41d2e84cd2cd0dbd05d351f0cd81bb44366e`
- 候选 Worker：`696a075240aa0f825239004f3ba70d7e6f085bb9d22ebfeb3e32c238c59aa79b`
- 生产主 JS：`5d7c966c18440aee3705e1df0933d11efbd8524d7d91e46720a6d5046b3a39e6`
- 生产 Worker：`32d0674594c728c40508bb818ba9fe478b19d3fc4444c9463ecba62467d4eecd`

主包只增加 0.8 KB；Worker 的增量来自增量评估，绝对值仍只有 14 KB。

## 2. 构建与门禁

| 项 | 结果 |
| --- | --- |
| `yarn build` | ✅ 确定性输出（重复构建哈希一致） |
| `yarn lint` / `typecheck` | ✅ |
| `yarn test` | ✅ 1,215 / 1,215（75 文件） |
| `yarn e2e` | ✅ 162 / 162 |
| `yarn e2e:prod`（本机 dist） | ✅ 5 / 5 |
| `yarn gates` | ✅ 环 / 死代码 / 重复 / 测试棘轮 |
| `yarn bench:check` | ✅ 19/19 + 29 不变量 |
| CI `quality` @ `8160d92` | ✅ 7 分 3 秒，四个 job 全绿，无 `continue-on-error` |
| `yarn e2e:remote`（线上旧构建） | ✅ 162 / 162 |

## 3. Worker 与浏览器

- `e2e:prod` 第 36 行起的用例验证了**生产产物里 Worker 的加载路径**，
  并完整走完一局；不是只验 dev server。
- 独立浏览器验收（生产构建 + 真实 Chrome）：
  - 五档 AI 正常应手，深度/节点显示与响应一致；
  - 专家档超时回退：2.66 s、深度 6/7、标「启发式」并显示警示；
  - 思考中悔棋 / 重新开始：迟到的响应不落子；
  - 提示连点：只发一次请求，盘面不变；
  - 复盘分析中换棋谱：不串台，重新分析可跑完；
  - 每页 1 个 Worker，25 轮长跑不增长；控制台错误 0。

限制：只测 Chrome/Chromium；没有 Safari/Firefox 与低端真机数据。

## 4. 性能影响

- 引擎固定深度 2.28×；真实 hard 预算 1.93–2.46×；相同棋谱对局 1.52–1.64×。
- 决策语义未变（16 局面 + 107 配对手 + 4 局棋谱逐手一致）。
- 用户可见延迟：入门/初级/中级 < 1 s；高级约 1 s；专家经常 2.6 s。
  优化不会缩短专家等待，因为专家本来就会把预算用满。
- 首屏应用自身 51 ms；落子提交中位 0.10 ms；200 手回放拖动 1.70 ms。

## 5. 数据兼容

| 数据 | schema | 本次是否改动 |
| --- | --- | --- |
| 学习进度 | 1 | 否 |
| 棋谱库 | 1 | 否 |
| 对局存档 | 2 | 否 |

旧版本写入的数据可被候选版本读回；回滚到旧版本也不会触发丢弃路径。
学习与残局逻辑的 e2e（完成、刷新、判错、下一题）全部通过。

## 6. Cloudflare Pages 配置

- 项目：`gomoku-lab`，生产地址 <https://gomoku-lab.pages.dev>。
- 预览项目：`gomoku-lab-preview`（同一账号；本次未部署）。
- 部署方式：手动 `wrangler pages deploy dist --project-name gomoku-lab --branch main`；
  未启用 Git 自动部署。
- `_headers` 未变：CSP 含 `worker-src 'self'`；`/assets/*` 一年 immutable；
  入口 `max-age=0, must-revalidate`；安全头与线上实测一致。
- 404 页、robots、favicon 未变。

## 7. 回滚

- 首选：Cloudflare Dashboard → Deployments → 上一部署 → Rollback（秒级，不重建）。
- 备选：重新构建旧提交并 `wrangler pages deploy`。
- 数据：三个 schema 版本都未变，回滚不会丢进度/棋谱。
- **注意**：项目目前只有一次生产部署，没有「上一版」可回；这次发布会成为第一次可回滚的基线。
  回滚演练（部署预览 → 回滚 → 再切回）尚未执行，建议在预览环境完成一次。

## 8. 发布条件

1. **用户明确批准后**，先把候选 `dist/` 部署到 `gomoku-lab-preview`。
2. 对预览地址跑 `REMOTE_BASE=<预览地址> yarn e2e:remote`，要求 162/162；
   同时核对 Worker 加载、`_headers`、入口缓存。
3. 预览通过后再手动发布生产；发布后对生产跑 `e2e:remote` 并复验资源哈希。
4. 发布说明保留已知限制：专家 2.6 s/43% 超时、战术题集饱和、仅 Chrome、
   无低端真机数据、A/B 复现文档的 P2 待修。
5. 不修改域名、环境变量、数据策略或权限。

## 9. 发布判断

**有条件可以发布。**

理由：候选构建通过全部技术门禁与真实浏览器验收；没有 P0/P1；
Worker 在生产路径可加载；存档 schema 未变；回滚路径明确。
条件都是发布流程与已知限制的告知，不是运行时代码缺陷。

**不要**在没有预览验收的情况下直接覆盖生产；也不要因为「本地全绿」跳过线上复验。
