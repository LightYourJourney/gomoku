# 局面模型：Game 与 Position 是两种数据

## 1. 为什么不能复用 GameState

`GameState`（`core/game.ts`）由 `replay(moves, firstPlayer)` 重建，**手顺是唯一真相**。
局面编辑器直接摆放棋子，不一定存在一条合法历史；如果造一条假的 `moves` 去满足
`GameState`，就会得到两种谎：

- 界面/导出声称这局「有过这些手」，但实际只是摆盘；
- `replay` 会在非法处截断，看起来「能重建」，其实丢掉了用户摆的棋子。

因此 Phase 11B 引入独立的 `Position`：

```ts
interface Position {
  board: Uint8Array(225) // 0 空 / 1 黑 / 2 白
  nextPlayer: 1 | 2
}
```

没有 moves、没有 winner、没有 status。AI 只接收 `board + nextPlayer`，并在调用前
过静态检查；编辑历史由编辑器自己的快照栈管理，不碰 `gameStore.undo()`。

## 2. 三级合法性

| 级别 | 判据 | 能证明什么 |
| --- | --- | --- |
| 结构合法 | 225 个格、值只能是 0/1/2、坐标在 0–14 | 数据能被棋盘安全渲染 |
| 静态规则一致 | 黑白数量与 `nextPlayer` 符合「黑先、轮流落子」的必要条件；没有已存在的五连（或明确指出双方同时五连） | 只是**必要条件**，不能证明存在合法历史 |
| 已知手顺可重放 | 保存了完整的合法前缀 `provenance`，且 `replay()` 逐手重建出的盘面、下一手与当前快照一致 | 这一份快照确实来自那条手顺 |

**静态检查不能证明可重放。** UI 对没有 provenance 的局面统一标「自由摆盘」；
有 provenance 但编辑过（盘面/下一手变了）会自动降级为自由摆盘，不再声称可重放。

## 3. `analyzePosition` 的输出

`core/position.ts` 返回：

- `black` / `white` 棋子数；
- `wins`：全盘扫描出的五连（长连也算）；
- `blackWin` / `whiteWin` / `bothWin`；
- `full`：225 格已满；
- `parity: 'ok' | 'mismatch'`：黑先轮流落子的必要条件；
- `ended`：已有五连或满盘；
- `searchable`：结构合法、未结束、奇偶一致，**只有这时才允许调用 AI**；
- `issues`：给用户看的具体原因（双方五连、已结束、手数不符……）。

双方同时五连是异常快照，会明确标出且不可搜索；它仍可保存为研究局面。

## 4. 已知手顺（provenance）

```ts
interface PositionProvenance {
  kind: 'replay'
  moves: Point[]      // 完整合法前缀
  firstPlayer: 1 | 2
  ply: number         // == moves.length
}
```

- 只有「从合法棋谱载入第 N 手」才生成；
- 保存/导入时校验 `replay` 重建结果与盘面、`nextPlayer` 一致；
- 任何编辑（放子、擦除、清空、改下一手）都会清除 provenance；
- 存储层读到不一致的 provenance 时**降级为自由摆盘**，保留盘面，不丢用户内容。

## 5. AI 输入约束

调用 `engine.search` 前必须满足：

- `structural`；
- 没有五连（`ended=false`）；
- 未满盘；
- 黑白数量与 `nextPlayer` 一致（`parity='ok'`）。

不满足时编辑器不调用 Worker，直接显示原因；满足时使用固定「中级 · 800ms ·
purpose='hint'」的只读请求，响应带 `gameVersion = 编辑器 version`。任何编辑递增
version，旧响应被丢弃。分析结果只写 `editorStore`，永不写 `gameStore`。

## 6. 持久化边界

- IndexedDB `DB_VERSION` 从 2 升到 3，新增 `positions` 表；`progress`/`records`
  不动，旧数据原样可读（见 `docs/data/SCHEMA_MIGRATION.md`）。
- 外部文件格式：`gomoku-lab.position`（见 `docs/data/FILE_FORMAT.md`）。
- 自由摆盘保存为 Position，不塞进 `GameRecord`；只有已知手顺才带 provenance。
