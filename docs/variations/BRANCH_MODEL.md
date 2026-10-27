# 棋谱探索分支模型

## 1. 单层分支

Phase 11C 只实现**单层**：原棋谱在一次回放游标处创建一局新的探索对局。
完成后的探索局保存为一条普通棋谱；不建立变化树、不修改原棋谱。

```
原棋谱 GameRecord(seq=S)
        │  cursor=N
        ▼
buildBranchGame(record.moves.slice(0, N), firstPlayer)
        │
        ▼
探索对局 GameState（前缀 + 新落子）
        │ 终局
        ▼
独立 GameRecord(seq=T)，moves = 前缀 + 分支后的手顺
```

原棋谱与分支记录是两条独立内容；源棋谱被删除不影响分支记录的回放。

## 2. 分支来源元数据

`gameStore` 在内存中保存：

```ts
interface BranchOrigin {
  sourceSeq: number
  sourceContentKey: string // recordContentKey，不是 seq
  cursor: number           // 0 = 空盘，N = 第 N 手之后
  sourceMoves: number
}
```

- `sourceContentKey` 保留来源棋谱的规范化内容身份，不把自增 `seq` 当跨设备 ID。
  当前界面只展示 seq 与起点；内容身份暂未用于 UI 校验，保留给后续来源核验。
- **不复制原棋谱对象**；只保留回指与起点。
- 该元数据当前只存在于对局 store，随会话页面生命周期存在；不写入
  `PersistedSession`、备份或棋谱记录。刷新页面后对局可恢复，但分支横幅与来源元数据
  会丢失。这是第一版的明确限制，避免在未需要时扩展会话与备份 schema。
- 完成后保存的分支记录**不携带来源字段**，因此原棋谱删除后仍能独立重放。

## 3. 起点语义

`cursor` 与回放器完全一致：0 是空盘，N 是第 N 手之后。分支只使用
`record.moves.slice(0, cursor)`，绝不把后面的手顺带入新局。

`buildBranchGame`：

- 要求 `cursor` 是 0..moves.length 的整数；
- 用 `replay()` 重建前缀，并要求 `game.moves.length === prefix.length`；
  损坏/截断手顺直接拒绝；
- 五连终局、满盘和棋拒绝继续；
- 认输不是棋盘终局：只要前缀本身没有五连/和棋，允许从最后一手盘面继续，
  新局不携带 `resignedBy`；
- 自由摆盘没有完整合法手顺，不进入此流程。

## 4. 与 Phase 11A / 11B 的边界

- 不把自由摆盘包装成 `GameRecord`；继续使用 Phase 11B 的 `Position`/编辑器。
- 分支起点必须是已入库且通过存储层校验的 `GameRecord`。
- 分支完成后走既有 `onGameEnd → saveGameReplacing` 路径，按规范化内容身份去重；
  新内容得到新 `seq`，原记录不被替换。
