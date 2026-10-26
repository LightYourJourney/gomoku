# 探索分支的状态迁移

## 1. 从回放到分支

1. `ReplayBoard` 显示 `cursor`；「从这里继续对弈」使用当前游标。
2. `BranchDialog` 用 `buildBranchGame` 预检并展示：
   - 分支起点（第 N / 总手数）；
   - 下一手颜色；
   - 对弈模式、人类执子、AI 难度；
   - 原棋谱不会被修改。
3. 确认时调用 `gameStore.startBranch({source, cursor, mode, humanColor, difficulty})`。
4. 成功后 `ReviewScreen` 停止分析/回放并切到对战页。

## 2. gameStore 接管

`startBranch` 是唯一的受控入口：

- 只用 `source.moves` 的前缀经 `replay()` 构建 `GameState`，不手改棋盘字段；
- `notifier.reset()` 使旧局的异步入库结果不再写回新局状态；
- 显式清空 `pendingRequestId`、提示状态、AI 信息与保存状态；
- 写入 `branch` 来源元数据；
- 若新局轮到 AI（例如玩家执白且下一手是黑），立即 `requestAiMove()`，
  不让玩家先多点一步；
- 校验失败时**不修改**当前对局。

旧 Worker 响应仍由既有 `requestId + gameVersion` 双闸门丢弃；分支接管没有
重建 Worker，也没有引入第二套请求通道。

## 3. 终局与特殊局面

| 局面 | 行为 |
| --- | --- |
| 五连终局 | 拒绝，并提示回到终局之前 |
| 满盘和棋 | 拒绝，不能继续落子 |
| 认输终局 | 若棋盘本身仍在进行，可从最后一手盘面继续；新局不继承认输 |
| 第 0 手 | 空盘继续，与普通新局一致 |
| 非法/截断手顺 | 拒绝，不创建正式对局 |
| 自由摆盘 | 不走分支流程；使用 Phase 11B 编辑器 |

## 4. 完成后保存

探索局结束（五连/和棋/认输）仍走既有终局入库回调。`GameEndInput.moves` 是
「原棋谱前缀 + 分支新手顺」，`saveGameReplacing` 按内容身份判断：

- 内容不同 → 新 `GameRecord`，原棋谱保持原 `seq` 与手顺；
- 同一局在终局后悔棋再终局 → 仍由既有替换语义处理；
- 不把 `BranchOrigin` 写成棋谱字段，分支记录可在源棋谱删除后独立重放。

## 5. 不做

- 不维护多层变化树；
- 不把分支起点做成第二套 `GameState` 生成器；
- 不修改原棋谱；
- 不让 UI 直接改 Zustand 内部字段；
- 不通过重建 Worker 清除旧请求。
