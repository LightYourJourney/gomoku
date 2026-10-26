# Phase 11C · 棋谱变化分支与从任意局面继续对弈

**日期**：2026-10-26
**状态**：功能完成并通过本地质量门禁与真实浏览器验收；**尚未发布**。
**生产版本**：仍为 `0.4.0`（提交 `d20eca9`、部署 `07a264f2…`）。

## 1. 实现

- `src/core/branch.ts`：`buildBranchGame` 只使用合法前缀重建局面；
  五连/和棋拒绝，认输局的可继续性由棋盘状态决定。
- `src/store/gameStore.ts`：新增 `branch` 与 `startBranch`；受控接管局面，
  清空旧 AI/提示/保存状态，AI 回合立即续走；`newGame` / `restore` 清除分支身份。
- `src/features/review/BranchDialog.tsx`：分支确认、模式/执子/难度、终局阻止。
- `src/features/review/ReplayBoard.tsx`：回放时间轴附近「从这里继续对弈」。
- `src/features/review/ReviewScreen.tsx`：停止旧分析/回放，提交分支配置并切页；
  连点锁防止重复接管。
- `src/features/battle/BattleScreen.tsx`：显示「棋谱探索 · 从第 N 手继续」与来源信息。

## 2. 测试

### 单元 / 组件

| 文件 | 内容 |
| --- | --- |
| `src/core/branch.test.ts` | 0/1/中盘/最后一手前、五连、和棋、非法手顺、越界 |
| `src/store/gameStore.test.ts` | 接管、原棋谱不变、AI 自动续走、旧响应/旧提示作废、认输局、独立保存、源删除、清空分支 |
| `src/features/review/BranchDialog.test.tsx` | 分支点/下一手、模式/执子/难度、终局禁用、取消、错误 |
| `src/features/review/review.test.tsx` | 回放页创建分支、配置回传、连点只接管一次 |

### 浏览器

- `e2e/variations.spec.ts`：**47 手原棋谱 → 第 26 手 → 创建分支 → AI 继续
  → 认输入库 → 原 47 手仍存在 → 刷新后两条记录仍在**。
- `e2e/mobile.spec.ts`：390 移动端确认框不横向溢出，可进入探索对战。
- 主套件：1353 单测 / 179 E2E；Firefox/WebKit 编辑器专项 18 条。
- UI 探针、覆盖棘轮、生产构建冒烟在收尾门禁中执行。

截图：[分支确认](screenshots/branch-dialog.png)、[探索对战横幅](screenshots/branch-battle.png)。

## 3. 完整实测流程

受控 47 手棋谱 → 回放时间轴定位第 26 手 → 「从这里继续对弈」→ 人机、玩家执白
→ AI 自动落子（第 27 手）→ 认输 → 保存为独立棋谱 → 原 47 手棋谱仍存在
→ 刷新后 27 手分支与 47 手原谱都在。该流程由 `e2e/variations.spec.ts` 在真实
Chrome 中执行；测试数据只存在于测试文件，生产逻辑没有写死 47/26。

## 4. 数据兼容

- 未改 `DB_VERSION`、`PersistedSession`、`GameRecord` 或外部文件格式。
- 分支来源元数据只在 `gameStore` 内存中；刷新后对局恢复但不保留分支横幅。
- 完成后保存为普通棋谱，原棋谱不会被修改或覆盖。

## 5. 已知限制

- 单层分支；不提供变化树浏览。
- 分支横幅与来源元数据不持久化到会话/备份；刷新或导出会话后丢失来源信息。
- 未提供「一键返回来源棋谱」入口；对战页展示来源 seq 与起点。
- 自由摆盘不进入合法棋谱分支流程。
- 尚未发布；不覆盖生产站。
