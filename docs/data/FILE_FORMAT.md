# 外部数据格式（v1）

> 这份文件定义**文件协议**，不是 IndexedDB 的内部形状。内部记录带自增 `seq` 与
> `schemaVersion`，它们只在当前浏览器/当前库里成立；文件只描述数据本身，换设备、
> 清库、再导入都成立。两者的版本号**分开维护**。

## 1. 通用约定

- UTF-8 JSON，缩进 2 空格，末尾一个换行。
- 顶层必须是对象；未知字段只警告并忽略，不按猜测解释。
- 不包含账号、IP、浏览器指纹、构建环境变量或内部临时分析缓存。
- 当前外部版本：`formatVersion = 1`。
- 未来版本（`formatVersion > 1`）**明确拒绝**，提示不支持；不会尝试向下兼容猜测。
- 单文件上限 10 MiB；JSON 嵌套上限 24 层；单次最多 2,000 局、100,000 手。
- 坐标是 0-based 的有限整数，范围 0–14；棋盘固定 15×15，规则固定 `freestyle`。

## 2. 单盘棋谱：`gomoku-lab.game`

```json
{
  "format": "gomoku-lab.game",
  "formatVersion": 1,
  "board": { "size": 15 },
  "rules": "freestyle",
  "firstPlayer": 1,
  "moves": [
    { "x": 3, "y": 7 },
    { "x": 3, "y": 9 }
  ],
  "mode": "pvp",
  "humanColor": 1,
  "difficulty": "easy",
  "ending": { "type": "five", "winner": 1 },
  "source": { "app": "gomoku-lab", "engineVersion": "search-1" }
}
```

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `format` | 是 | 固定 `gomoku-lab.game` |
| `formatVersion` | 是 | 当前 `1` |
| `board.size` | 是 | 固定 `15` |
| `rules` | 是 | 固定 `freestyle`（自由规则，长连有效、无禁手） |
| `firstPlayer` | 是 | `1` 黑 / `2` 白 |
| `moves` | 是 | 完整手顺，最多 225 手 |
| `mode` | 是 | `pve` / `pvp` |
| `humanColor` | 是 | `1` / `2`；双人局也保留，便于原样往返 |
| `difficulty` | 是 | `beginner` / `easy` / `medium` / `hard` / `expert` |
| `ending` | 是 | 结束方式，见下 |
| `source` | 否 | `{ app, engineVersion }`；不参与重复判断 |

### `ending`

| 类型 | 形状 | 校验 |
| --- | --- | --- |
| 五连 | `{ "type": "five", "winner": 1 }` | 完整手顺结束于 `won`，且赢家一致 |
| 和棋 | `{ "type": "draw", "winner": null }` | 完整手顺下满棋盘且无人成五 |
| 认输 | `{ "type": "resign", "winner": 1, "resignedBy": 2 }` | 赢家必须是认输方的对手；认输前手顺本身不能已经结束；**零手认输合法** |

`moves` 必须**全部**合法应用：越界、非整数、重复落子、终局后继续落子、胜负声明
不一致都会整条拒绝。**不会**把损坏的 80 手文件截成 35 手再报成功——那是
`replay()` 用于旧存档恢复的截断语义，不适用于导入。

## 3. 完整备份：`gomoku-lab.backup`

```json
{
  "format": "gomoku-lab.backup",
  "formatVersion": 1,
  "board": { "size": 15 },
  "rules": "freestyle",
  "games": [ { "firstPlayer": 1, "moves": [], "mode": "pvp", "humanColor": 1, "difficulty": "easy", "ending": { "type": "resign", "winner": 1, "resignedBy": 2 } } ],
  "progress": {
    "completedLessons": ["rules"],
    "solvedPuzzles": ["win-h"],
    "lastVisited": { "kind": "lesson", "id": "rules" },
    "lastView": "learn"
  },
  "preferences": { "theme": "dark", "showCoords": true, "soundEnabled": true },
  "session": {
    "moves": [{ "x": 7, "y": 7 }],
    "firstPlayer": 1,
    "mode": "pve",
    "humanColor": 2,
    "difficulty": "medium",
    "resignedBy": null
  },
  "source": { "app": "gomoku-lab", "engineVersion": "search-1" }
}
```

- `games`：内容与单盘相同，但**不重复** `format/formatVersion/board/rules` 外壳。
- `progress` / `preferences` / `session`：可选。**字段缺失表示这份文件不包含该段**，
  导入时绝不能把它当成空值去覆盖本地。
- `session` 可以是 `null`，表示导出时明确没有进行中的对局。
- `games` 中单条无效时，**其余有效棋谱仍可导入**；预览与结果会点名无效条数与索引。
  备份级结构（版本、棋盘、规则、数组类型）无效则整份拒绝。
- 只导出棋谱时（「导出全部棋谱」）使用同一个 `format`，省略 `progress` /
  `preferences` / `session`。

## 4. 重复判断

重复不是比较 `seq`，而是**规范化内容**：

```
[firstPlayer, mode, humanColor, difficulty, resignedBy, [[x,y], ...]]
```

同一局手顺、同样的模式/执子/难度/认输方，就是同一局；`source`、`seq`、文件外壳
不参与。导入时在**同一个 IndexedDB 事务**里对现有记录与同批输入一起去重，
重复导入不会制造无限记录。

## 5. 版本演进规则

- **外部版本**与内部 `DB_VERSION` / 各 `schemaVersion` 独立。
- 新增可选字段：不升版本，旧解析器按「未知字段」警告并忽略。
- 改变必填字段含义、结束语义或坐标含义：升 `formatVersion`，旧版本明确拒绝。
- 新增格式（例如单盘以外的容器）：新的 `format` 标识，不复用旧标识。
- 不为了「有迁移」而改内部字段；本阶段内部 schema 未变。
