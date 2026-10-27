# Phase 11E · 导入与分享安全报告

> 对象：Phase 11A 文件导入、Phase 11B 局面导入、Phase 11D 分享链接。
> 所有输入都按**不可信**处理；本报告记录实际对抗用例与修复后的边界。

## 1. 信任边界

| 入口 | 数据来源 | 处理 |
| --- | --- | --- |
| 棋谱/备份文件 | 用户选择的本地 JSON | 读前查大小 → 深度扫描 → `JSON.parse` → 严格结构/语义校验 → 预览 → 用户确认 → 事务写入 |
| 局面文件 | 用户选择的本地 JSON | 读前查大小（本轮修复）→ 同上 → 载入编辑器内存，不自动入库 |
| 分享链接 | URL Fragment | token 长度 → 版本/分段/base64url → FNV 校验 → JSON 外形/kind → 复用棋谱/局面严格校验 → 只读预览 |
| 分享预览保存 | 用户显式点击 | 整盘走 `importMany` 单事务去重；局面先查内容身份再写 `positions` |

**没有** `eval` / `Function` / 动态脚本 / 第三方请求 / 短链服务 / 云端上传。
URL Fragment 不随普通 HTTP 请求发送，但可能进入历史、复制文本、截图或扩展日志；
产品不承诺「绝对私密」。

## 2. 校验流水线

### 2.1 棋谱/备份

1. `MAX_IMPORT_BYTES = 10 MiB`；备份文件面板在 `file.text()` 前检查 `file.size`。
2. `MAX_JSON_DEPTH = 24`，在 `JSON.parse` 前做字符扫描（正确处理字符串/转义）。
3. 顶层必须是对象；`format` 白名单；`formatVersion` 必须是 1，过新明确拒绝。
4. 棋盘 15×15、规则 `freestyle`；坐标有限整数 0–14。
5. 手顺最多 225 手；逐手严格校验——**不接受 `replay()` 的截断结果**。
6. 结束方式与手顺一致：
   - 五连：赢家必须是手顺产生的赢家；
   - 和棋：必须下满且无人五连；
   - 认输：赢家必须是认输方对手，手顺在认输前不得已结束；零手认输合法。
7. 备份最多 2,000 局、总手数 100,000；进度 ID 最多 1,000、字符串 ≤200。
8. 未知字段只警告；可选段（progress/preferences/session）无效时跳过并警告；
   单条游戏无效不拖垮其余有效游戏。
9. 解析/校验/取消都在写入之前；写入是单事务，失败整笔回滚。

### 2.2 局面

在棋谱规则之外增加：

- `stones` 最多 225；同一交叉点不得重复；颜色 1/2；坐标有限整数 0–14。
- `title` ≤80 字符；`nextPlayer` 必填 1/2。
- `provenance` 必须是完整合法前缀：`ply === moves.length`，逐手 `applyMove`，
  重建盘面与 `nextPlayer` 必须与 `stones` 一致；否则整份拒绝。
- 没有 provenance 的自由摆盘允许保存/导入，UI 标「自由摆盘」。

### 2.3 分享外壳

`#share=<version>.<checksum>.<base64url(JSON)>`

- token 上限 12,000 字符；
- 版本只接受 1，过新返回 `unsupported_version`；
- base64url 解码失败、JSON 失败、分段数不对 → `malformed`；
- FNV-1a 32 位校验只防复制/截断损坏，**不是签名**；攻击者可以重算；
- 真正的接受条件是最后的 `parseImportText` / `parsePositionText`；
- `kind` 只接受 `game` / `position`；
- 外层 `try/catch` 保证任何未预料错误都变成错误页，不白屏。

## 3. 对抗输入结果

本次临时 Vitest 夹具（17 条）与既有测试共同覆盖：

| 攻击/畸形输入 | 结果 |
| --- | --- |
| 坏 JSON、顶层 null/数组/数字/字符串/布尔 | 拒绝，不抛 |
| 10 MiB + 字节文本 | `too_large`，在 `JSON.parse` 前/读前拒绝 |
| 嵌套 27 层 | `too_deep`，在 `JSON.parse` 前拒绝 |
| `format` 缺失/类型混淆 | `wrong_format` / `invalid_field` |
| 未来 `formatVersion` | `unsupported_version` |
| 坐标字符串/布尔/null/1.5/15/-1 | 拒绝 |
| 重复落子 | `duplicate_move`，不截断 |
| 五连后继续落子 | `move_after_end` |
| 和棋不满盘、五连赢家错误、认输赢家错误、认输前已终局 | `ending_conflict` / `bad_ending` |
| 225 手合法满盘和棋 | 通过 |
| 2000 局 × 225 手（6.83 MB） | 约 493 ms 后按总手数上限拒绝（旧实现 >15 s） |
| 2001 局 | 拒绝 |
| 局面：重复点/越界/非整数/坏颜色/坏 nextPlayer/坏版本/坏 provenance/226 stones | 拒绝 |
| 分享：超长、版本过新、坏编码、校验失败、未知 kind、重算校验后的非法棋谱 | 对应错误码；不抛 |
| 500 条随机 fuzz token | 全部返回结果，无异常 |
| 分享预览错误 Fragment | 错误页 + 返回应用；不白屏 |

## 4. 存储失败与事务

| 场景 | 行为 |
| --- | --- |
| IndexedDB 整体不可用 | 棋谱：内存兜底，`storage='memory'`；进度：内存兜底；局面：内存兜底 |
| 棋谱批量导入事务提交失败 | **不写内存**，整笔回滚，`storage='failed'`，UI 说「没有写入任何棋谱」 |
| 棋谱单条保存事务失败 | `persisted=false`，不删旧条，UI 说「没能保存这局」 |
| 局面保存事务失败 | `persisted=false`，退内存兜底（P2：列表仍读 IndexedDB，见主报告 A-11E-06） |
| 进度写入失败 | `saveProgress` 吞掉失败，内存态继续（P2：导入面板无失败信号） |
| localStorage 会话写入失败 | `saveSession` 返回 false；备份恢复路径会抛错，自动存档路径只尽力而为 |
| 解析/校验/取消 | 零写入 |

## 5. 「打开分享链接不自动写入」的真实浏览器证据

修复前（真实 Chrome，隔离 context）：

1. localStorage 存 1 手人机局，轮到 AI；打开 `/#share=…`，2.5 s 后 session 变成 2 手。
2. 存 8 手、AI 执黑可成的棋；打开分享链接，5 s 后 IndexedDB `records` 从 0 变 1。

修复后：

- 打开**有效**分享链接：session 仍 1 手，`indexedDB.databases()` 中没有 `gomoku-lab`；
- 点「返回应用」：AI 续走，session 变 2 手（用户已离开分享页）；
- 新增 E2E 固定这条行为（`e2e/sharing.spec.ts`）。

## 6. 修复清单

| ID | 修复 |
| --- | --- |
| A-11E-01 | 分享预览不续走 AI、不启动学习库；离开后才续走 |
| A-11E-03 | 严格手顺校验改为单次 `replay` + 单次 `validateMove`，消除 O(n²) |
| A-11E-04 | 局面文件在 `file.text()` 前检查 10 MiB |

## 7. 残余风险

- **校验码不是签名**：分享内容可被重算校验后篡改；安全边界是严格解析器。
- **P2**：局面/进度的存储失败提示不完整（见主报告）；不构成「接受恶意脚本」风险。
- **P3**：分享解码没有独立的 JSON 深度预扫描；12,000 字符上限和外层 catch 使其
  不白屏，最终内容仍由严格解析器拒绝。
- **P3**：分享链接可能出现在历史/截图/扩展日志；不宣称绝对隐私。
- **未覆盖**：恶意浏览器扩展、被篡改的浏览器存储、服务端（本项目无后端）。
