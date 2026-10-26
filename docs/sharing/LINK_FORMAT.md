# 分享链接格式

## 1. URL 外观

```
https://<host>/#share=<version>.<checksum>.<base64url(JSON)>
```

- 只使用 URL Fragment：普通页面请求不会把 fragment 发给服务器。
- `version` 是**分享外壳**版本，与棋谱/局面文件版本独立。
- `checksum` 是 FNV-1a 32 位十六进制的完整性校验码；它只能发现复制/截断造成的
  损坏，**不是数字签名，也不是防篡改承诺**。
- 内容使用 base64url（`+`→`-`、`/`→`_`、去掉 `=`），避免 fragment 中的特殊字符。

当前 `version = 1`。未来版本过新时明确拒绝，不猜测字段含义。

## 2. 外壳与内容

base64url 解码后的 JSON：

```json
{
  "v": 1,
  "kind": "game",
  "data": { ... }
}
```

`kind`：

- `game`：`data` 是 Phase 11A 的 `gomoku-lab.game` v1 单盘文件；
- `position`：`data` 是 Phase 11B 的 `gomoku-lab.position` v1 局面文件。

没有第二套棋谱/局面结构；接收端直接复用现有严格校验器：

- `game` → `parseImportText`
- `position` → `parsePositionText`

因此坐标、重复落子、终局后落子、规则/版本/未知字段等校验与文件导入同源。

## 3. 三种分享内容

| 用户选择 | kind | data |
| --- | --- | --- |
| 分享整盘 | `game` | `toGameFile(record)`，必须是已结束棋谱 |
| 分享当前回放回合 | `position` | `toPositionFile(snapshot, title, provenance)`；`provenance` 保存合法前缀 |
| 分享自由摆盘 | `position` | `toPositionFile(position, title, null)`；无 provenance，预览标“自由摆盘” |

中途回合不会伪造完整 `GameRecord`；它是一张带已知手顺的 `Position`，接收端保存到
局面库，而不是塞进棋谱库。整盘才保存到棋谱库。

## 4. 长度与编码取舍

- token 上限 **12,000 字符**；超过时生成失败并提示使用 Phase 11A 文件导出。
- 225 手以内的整盘、满盘自由局面均在 12,000 以内；`link.test.ts` 钉住长度。
- 采用 **JSON + base64url**，没有引入压缩库或第三方短链。对 225 手规模，
  压缩收益不足以抵消异步压缩 API、兼容性与错误处理的复杂度；若未来内容
  显著变大，应先测量再决定。
- 不声称所有浏览器支持无限 URL；上限是产品约束，不是浏览器事实。

## 5. 错误分类

| code | 含义 |
| --- | --- |
| `too_long` | token 超长 |
| `unsupported_version` | 外壳版本过新 |
| `malformed` | 分段/编码/JSON 结构损坏 |
| `checksum` | 校验码不匹配 |
| `unsupported_type` | `kind` 不在白名单 |
| `invalid_data` | 棋谱/局面未通过现有严格校验 |

错误只影响分享预览；返回应用后四个模块照常工作。

## 6. 隐私边界

链接只包含用户明确选择的单盘棋谱或局面：

- 整盘棋谱不含 `seq`、学习进度、偏好、会话、账号、IP；
- 局面只含 `stones/title/nextPlayer/可选 provenance`；
- 不会自动把本地全部棋谱打包进链接。

URL fragment 不随普通 HTTP 请求发送，但仍可能进入浏览器历史、用户复制内容、
截图、扩展或本地日志；文档不宣称链接“绝对私密”。
