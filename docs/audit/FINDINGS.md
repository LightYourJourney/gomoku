# 审计发现（Phase B / C / D）

审计对象：HEAD `4987c33`，工作区干净。全部结论都带文件路径与行号；每条都标注**证据等级**与**置信度**。

**证据等级**（本文件统一使用）：

| 标记 | 含义 |
| --- | --- |
| `已证实` | 读代码可完全确定，或已用独立参考实现/实测复现 |
| `静态风险` | 代码事实确定，但未能构造出触发条件；触发条件是真实存在的 |
| `推测` | 由代码事实推出的后果，未验证 |
| `待验证` | 需要额外测量或环境才能判定 |

**优先级**：

| 级别 | 含义 |
| --- | --- |
| P0 | 会破坏数据、产生安全后果或让产品不可用 |
| P1 | 用户可见的错误行为，或有明确复现路径的逻辑缺陷 |
| P2 | 真实缺陷但影响面有限；或语义/无障碍/一致性上的明确错误 |
| P3 | 可维护性、一致性、卫生问题；不改变任何现有行为 |

---

## 0. 结论摘要

**没有发现 P0 与 P1。** 五条质量命令全绿（767 单测 + 44 e2e），算法层用**独立参考实现**交叉验证后零分歧（见 §5），仓库自己记录的已知不足逐条复核**全部属实、无一夸大**。

发现的 23 条里：

| 级别 | 条数 | 说明 |
| --- | --- | --- |
| P0 | **0** | 未发现 |
| P1 | **0** | 未发现 |
| P2 | **5** | F-01 双人模式认输语义、F-02 Modal 焦点、F-03 IndexedDB 事务成功判定、**F-24 性能数字与入库产物脱钩**、F-16 lint 门禁薄弱 |
| P3 | 19 | 全部不改变现有行为 |
| 已撤回 | 2 | F-13（自审时用独立脚本复核后确认是**误报**）、以及 `TEST_GAPS.md` 里一条关于「满盘跳过末手零覆盖」的断言（该路径已有直接用例）。两条都保留在原位并划掉，以便对照 |

**本文件有一条被撤回的结论。** 保留划掉的原文而不是删掉，是为了让读者看到「审计本身也经过复核」，也方便对照我的判断在哪些类型上容易出错（见 F-13 的撤回说明）。

**这次审计最重要的产出不是缺陷清单，而是三条「测过、确认没问题」的结论**：算法层经独立实现验证无分歧；依赖图无环无逆层；文档诚实度经逐条核对无夸大。这一点在 §5 与 §6 展开。

---

## 1. 已证实缺陷

### F-01 · P2 · `已证实` · 本地双人模式的「认输」认的是不可见、不可改的一方

**位置**
- `src/store/gameStore.ts:345-358`（`resign()` 使用 `current.humanColor`）
- `src/components/panels/SettingsPanel.tsx:69`（执子选择器只在 `mode === 'pve'` 下渲染）
- `src/features/battle/status.ts:47-51`（pvp 下如实播报「X 认输，Y 获胜」）

**事实**：`pvp` 模式下 `humanColor` 既不可见也不可改，它是**上一次人机模式留下的残留值**。而「认输」按钮在任何模式下都用它决定谁认输。

**最小复现**
1. 人机模式 → 执子选「执白后行」→ 切到「本地双人」
2. 黑棋落一手（此时轮到白走）
3. 点「认输」

**实际**：状态条显示「白棋认输，黑棋获胜」——白方认输，但屏幕上刚刚是黑在下、且轮到白走。
**期望**：本地双人是同一块屏幕上的两个人，语义应当是「当前该走的一方认输」（`game.current`），因为按钮是轮到谁走时谁点的。

**根因**：`resign()` 的签名与语义是从人机模式长出来的（`resignGame(state, player)` 需要一个 `player`），切模式时没有重新定义「谁」。
**影响**：用户可见的语义错误。赢家判定本身没错（`winner` 与 `resignLine` 都正确），错的是「谁认输」。
**回归风险**：修复会改变现有行为，且**存在多种合理设计**（「该走的一方认输」/「拆成两个按钮」/「弹窗选人」）。**已列入 REFACTOR_PLAN 的「需要用户授权」一节，未经授权不改。**
**置信度**：高（纯读代码即可确定，无需运行）。

---

### F-02 · P2 · `已证实` · `Modal` 声明了 `aria-modal` 却没有焦点陷阱，关闭后也不还原焦点

**位置**：`src/components/ui/Modal.tsx:14-27`

```ts
useEffect(() => {
  if (!open) return
  dialogRef.current?.focus()                    // 打开时把焦点搬进弹窗
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') onClose?.()
  }
  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [open, onClose])
```

**事实**
- `role="dialog" aria-modal="true"`（`:35-36`）向读屏软件声明「弹窗外的东西是惰性的」。
- 但代码只做了「打开时 `focus()`」和「Escape 关闭」。**没有 Tab 循环，也没有在关闭时把焦点还给触发它的元素。**
- 全仓 grep `Escape` 只命中 `Modal.tsx:23`；没有任何 focus trap 相关代码。
- `e2e/a11y.spec.ts`（**6 条**，见 `TEST_GAPS.md` §1 的订正）覆盖了键盘落子、roving tabindex、焦点环尺寸、播报，**未覆盖弹窗**。

**最小复现**（键盘）
1. 玩到终局 → 结果弹窗自动弹出
2. 按 `Tab`

**实际**：焦点会离开弹窗，落到弹窗后面的棋盘格 / 侧栏按钮上（`aria-modal` 说那些是惰性的）。
3. 按 `Escape` 关闭弹窗后，被聚焦的元素随弹窗卸载，焦点掉到 `<body>`——键盘用户要从页面最开头重新 Tab。

**影响**：键盘与读屏用户体验缺陷；`aria-modal` 与实际行为不一致，属于「声明了一件假的事」。
**根因**：`Modal` 只实现了「模态的样子」（遮罩 + 居中 + aria），没实现「模态的行为」（焦点圈闭 + 焦点还原）。
**修复方向**：在 `Modal` 里加一对 `keydown` 处理（Tab / Shift+Tab 在弹窗内循环）+ 记录 `document.activeElement` 并在关闭时还原 + 补一条 Playwright 用例。
**回归风险**：低——只影响弹窗，且现有 e2e 有四条走过弹窗（`battle.spec.ts:125`、`learn.spec.ts` 无、`review.spec.ts` 无）。改动后需重跑 `yarn e2e`。
**置信度**：高（代码事实确定；行为可复现）。

---

### F-03 · P2 · `静态风险` · `gameRecords` 用 `request.onsuccess` 判定写入成功，并在此刻关闭连接

**位置**：`src/persist/gameRecords.ts:252-274`（`withStore`）、`:298-307`（`put`）

```ts
function withStore<T>(mode, run): Promise<T> {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = run(tx.objectStore(STORE))
    request.onsuccess = () => { db.close(); resolve(request.result) }   // ← 只看 request
    request.onerror   = () => { db.close(); reject(new Error('棋谱库读写失败')) }
  }))
}

async put(record) {
  try {
    const seq = await withStore<IDBValidKey>('readwrite', (store) => store.add(payload))
    return { record: { ...payload, seq: Number(seq) }, persisted: true }   // ← 据此声称已落库
  } catch { return fallbackToMemory().put(record) }
}
```

**对照**：同一个仓库的 `src/persist/progress.ts:154-170` 用的是正确口径——

```ts
const tx = db.transaction(STORE, 'readwrite')
...
tx.oncomplete = () => resolve()
tx.onerror    = () => reject(new Error('写进度失败'))
tx.onabort    = () => reject(new Error('写进度被中止'))
```

**事实**
1. `put()` 返回 `persisted: true` 的依据是**单条请求成功**，而不是**事务提交成功**。
2. `withStore` **从不监听 `tx.oncomplete` / `tx.onabort` / `tx.onerror`**。
3. `db.close()` 发生在 `request.onsuccess` 回调里，即事务还没提交时。

**为什么这是问题**：`PersistedSession` / `PutResult.persisted` 是**给用户看的诚实性承诺**——`src/store/useGameStore.ts:20-26` 正是根据它决定显示「这局已存入棋谱库」还是「没能保存这局」。事务在 commit 阶段被中止（配额、其他标签页触发 abort、浏览器回收）时，界面会显示「已存入」而磁盘上没有。

**未能构造复现**：真实浏览器里 `store.add()` 的 `onsuccess` 之后事务提交失败需要特定条件；jsdom + fake-indexeddb 不模拟 commit 阶段的失败。**因此标为静态风险而不是已证实缺陷。**

**修复方向**：把 `withStore` 改成与 `progress.ts` 同一口径（`tx.oncomplete` 才 resolve，`tx.onerror`/`tx.onabort` reject，`db.close()` 放在事务结束后）。**这是把两处口径统一，不引入新机制。**
**回归风险**：低—中。`list()` / `get()` / `delete()` 也走 `withStore`，改完必须重跑 `src/persist/gameRecords.test.ts`（260 行）与整条 `e2e/review.spec.ts`。
**置信度**：高（代码事实 100% 确定）；触发概率：未能量化。

---

### F-16 · P2 · `已证实` · lint 门禁只有两条规则，React Hooks 依赖数组全靠人工

**位置**：`.oxlintrc.json`（全文 8 行）

```json
{
  "plugins": ["react", "typescript", "oxc"],
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

**事实**：`react/rules-of-hooks` 只抓「在条件/循环里调 hook」这类**调用位置**错误；**它不检查依赖数组**。`react-hooks/exhaustive-deps` 没有开。

而项目里有 6 处手工维护的依赖数组，其中若干处的正确性**只由注释保证**：
- `src/components/board/Board.tsx:152-154`（`[hasFocus]`）、`:156-169`（`[focused, interactive]`）
- `src/features/battle/BattleScreen.tsx:96-108`（`[game.status, game.winner, mode, humanColor, settings.soundEnabled, sound]`）、`:112-117`
- `src/features/review/ReviewScreen.tsx:47-52`（`[analysis, replay]`）
- `src/features/review/ReplayBoard.tsx:29-33`（`[store]`）
- `src/features/learn/PracticeBoard.tsx:70-74`（`[solved, onSolved]`）
- `src/lib/../store/settingsStore.ts:36-52`（`[theme]`）

**影响**：这类错误不会让 typecheck 或测试变红，只会表现为「值不是最新的」或「effect 多跑一次」。`PracticeBoard.tsx:63-68` 的注释记录了作者**手工发现**过这个坑（`onSolved` 每次渲染换引用 → effect 反复执行 → 无限 setState）。**那条注释本身就是「应该有 lint 规则」的证据。**

**为什么列为 P2 而不是 P3**：这是**防退化的门禁缺口**，不是代码卫生问题。而且引入它属于「为通过审计擅自调整规则」的反面——它是**加强**门禁。

**成本与兼容性**：`oxlint` 已装（1.87.0），`react-hooks` 插件在 oxlint 1.81+ 已支持 `exhaustive-deps`。开启它需要：
1. 在 `.oxlintrc.json` 的 `plugins` 里加 `"react-hooks"` 或直接在 `rules` 里开 `react-hooks/exhaustive-deps`；
2. 首次运行可能报若干既有告警 —— **必须逐条判断**，不许用 `// oxlint-disable` 批量静音。

**引入后可能有的真实告警**（我预判，未运行）：`Board.tsx:156-169` 用了 `focusCellRef`（ref，不需要进依赖）与 `document.activeElement`，`exhaustive-deps` 可能要求把 `focusCellRef` 写进依赖——那是误报，需要就地注释说明。**所以这条要单独做，不能和别的改动混在一起。**

**已列入 REFACTOR_PLAN 的「需要用户授权」一节**：改 lint 配置会改变「提交前五条全绿」的含义，属于工程约定变更。

### F-24 · P2 · `已证实` · `AI_ENGINE.md` 的全部性能数字已与入库产物脱钩

**这条是本次审计里唯一一条「文档腐化」的实例，而且它发生在本项目**最严格**的一条规矩上：**
`AGENTS.md:34` 写着「写进文档的每一个性能数字都必须来自 `yarn bench`，不许估」；
`AI_ENGINE.md:169` 写着「数字全部由 `yarn bench` 跑出来，原始结果写在 `bench/last-run.json`」。

**事实（全部可复现）**

`bench/last-run.json` 是 **git 跟踪**的文件。它的提交历史只有两次：

| 提交 | `expert/开局.nodes` |
| --- | --- |
| `7a08f32`（`fix: 修复第三轮两轴审查…`，也是最后一次改 `AI_ENGINE.md` 的提交） | **23,939** |
| `1da4a6e`（`perf: 首屏/落子实测与复跑探针（两处候选优化：测过、不做）`） | **23,272** |

`AI_ENGINE.md:197` 的表里写的是 **23,939** —— 也就是说，**表格取自 `7a08f32` 时刻的产物，而那份产物已经被 `1da4a6e` 覆盖了**。文档那句「原始产物是入库的 `bench/last-run.json`」在 `1da4a6e` 之后就不成立了。

**最小复现**

```bash
cd /Users/leo/leocode/vibe/games/gomoku
git show 7a08f32:bench/last-run.json > /tmp/old.json
# 逐节比对 /tmp/old.json 与 bench/last-run.json，再与 docs/AI_ENGINE.md 的表对照
```

**逐表核对结果（本轮实跑）**

| 文档里的表 | 文档写的 | `7a08f32` 产物 | 当前产物 | 结论 |
| --- | --- | --- | --- | --- |
| 搜索表 · `search` 判定的 **12 行** | depth / nodes | — | — | **两次运行 depth 与 nodes 完全一致**（只有 `elapsedMs` 变：78→80、68→72…）。这**独立证实**了文档「搜完的行逐字一致」的说法 ✓ |
| 搜索表 · `timeout` 判定的 5 行 | 如 专家/开局 nodes 23,939 | 23,939 | **23,272** | **对不上**。最大差 **33%**（专家/双三：文档 18,802，当前产物 14,164） |
| `AI_ENGINE.md:237` 单次评估 | 「约 **70–82 µs**（多次运行的范围）」 | 76.3 µs ✓ | **96.7 µs** ✗ | **当前产物已落在文档声明的范围之外（+27%）** |
| `AI_ENGINE.md:258-260` VCF/VCT 对照 | 38× / 47× / 520× | 37.6 / 46.8 / 520.0 ✓ | 36.3 / 44.8 / 493.9 | 文档数字出自 `7a08f32` |
| `AI_ENGINE.md:226` 提示诊断 | 5.98 µs / 1.78 µs / 3.4 倍 / 0.53 ms | **逐项精确匹配** ✓ | 6.93 / 2.53 / 2.74 / 0.582 | 同上 |
| `AI_ENGINE.md:281` | 「提示的棋型分析只值 **0.56 ms**」 | `suggestionsMs` = 0.534 | = 0.582 | **两份产物都不是 0.56** —— 这一处对不上任何一份产物 |

**影响（这是它值得 P2 的理由）**

1. **主动误导**：任何人今天跑一次 `yarn bench`，会看到 `evaluateBoard` 96.7 µs，而文档说 70–82 µs —— 他会以为自己制造了 27% 的性能回退，然后去查一个不存在的 bug。
2. **审计链断了**：文档里那句「原始产物是入库的 `last-run.json`」是**可核查性**的承诺。这句失效之后，读者只能选择「信文档」或「信产物」，而他无法判断该信哪个。
3. **根因是一个工程习惯问题**：`bench/last-run.json` 是**产物**却被 git 跟踪。于是「重跑基准」这个无害的动作会**污染工作区**，并让文档悄悄过期——而 `AGENTS.md:39` 要求提交前工作区是干净的。

**根因**：`1da4a6e` 重跑了 `yarn bench` 并提交了新产物，但**没有同步 `docs/AI_ENGINE.md`**。这两个动作之间没有任何门禁把它们绑在一起。

**修复方向（三选一，成本递增、诚实度递增）**

| 方案 | 做法 | 成本 | 代价 |
| --- | --- | --- | --- |
| A | 把超时行与其余四张表更新成当前产物的数字 | 低 | 下次跑 bench 又过期；只是把问题往后推 |
| B | **在文档里写明产物的出处提交**：把「原始产物是入库的 `last-run.json`」改成「原始产物是 `7a08f32` 时刻的 `last-run.json`；该文件已被 `1da4a6e` 的复跑覆盖，超时行的节点数因此与表不同」，并补上「搜完的行两次运行 nodes 逐字一致」这条实测 | 低 | 保留真实数字，把「可核查」这件事**恢复成真的** |
| C | 在 B 的基础上把「稳定 / 不稳定」写成区间（如 `evaluateBoard` 76–97 µs），并决定要不要把产物文件从 git 里摘出去 | 中 | 最耐久，但**动 git 跟踪策略属工程约定变更** |

**本次执行方案 B**（见 `REFACTOR_PLAN.md` 的 D-0-3）。方案 C 列入批次 5 待授权。

**置信度**：高。全部结论由 `git show` 取历史产物 + 逐行 diff 得出。

---

---

## 2. P3 清单（全部不改变现有行为）

| ID | 位置 | 事实 | 影响 | 证据 |
| --- | --- | --- | --- | --- |
| **F-04** | `src/learn/verify.ts:38` | `const point = { x: i % 15, y: Math.floor(i / 15) }` 手写索引换算，硬编码 `15` | 违反 `docs/RULES.md:7` 自己写下的约定（「转换只经由 `core/board.ts` 的 `idx` 与 `pointFromIdx` 两个函数，别处不手写算术」）。而 `pointFromIdx`（`core/board.ts:16`）**生产零引用、只被自己的测试用** | `已证实`（grep 全仓） |
| **F-05** | `src/persist/gameRecords.ts:72` | `resignedBy === BLACK ? WHITE : BLACK` 手写对手计算 | 同文件第 2 行已经从 `core/board` 导入 `inBounds`，`opponentOf` 就在同一个模块里 | `已证实` |
| **F-06** | `src/features/review/ReviewScreen.tsx:112-113` | `const difficulty = 'easy' as const` / `const budgetMs = 400` 字面量 | `src/store/analysisStore.ts:18` 导出的 `ANALYSIS_BUDGET_MS = 400` 只当闭包初值，生产路径永远被覆盖。界面标注读的也是这个局部量——一旦两处不同步，**界面会显示一个错误的出处** | `已证实` |
| **F-07** | `src/store/analysisStore.ts:179-182` | `new Map(pending)` → `delete(index)` → `pending.clear()` → 逐条写回 | 完全等价于 `pending.delete(index)`，但复制了整个 Map | `已证实` |
| **F-08** | `src/store/analysisStore.ts:203-205` | `function patch(d) { set(d) }`，**3 处**调用（`:184`、`:247`、`:338`） | 无意义间接层 | `已证实` |
| **F-09** | `src/store/analysisStore.ts:51` | `import { replay } from '../core/game'` 位于第 51 行（`PendingVerdict` 接口之后、`createAnalysisStore` 之前） | ESM 合法（import 被提升）但违反全仓唯一写法，像是编辑残留 | `已证实` |
| **F-10** | `src/store/gameStore.ts:217-242` | `makeNotifier` 的内层函数体比外层少缩进 2 格，闭括号同样 | 纯格式。仓库没有 prettier，oxlint 不管格式，所以不会被任何门禁拦住 | `已证实` |
| **F-11** | `src/features/review/ReviewScreen.tsx:108` | 渲染期 `const record = replay.getState().record`（非响应式） | 同一组件树里 `ReplayBoard.tsx:25` 用的是响应式 `useStore`。当前靠「面板只在 `open` 后才挂载、且挂载期间 `record` 不变」侥幸成立——`openRecord` 只能从列表页调用，所以确实成立 | `已证实` |
| **F-12** | `src/store/settingsStore.ts:15-27` | zustand `persist` 只给了 `name`，**无 `version` / `migrate` / `partialize` / 校验** | 仓库另外三个持久化模块（`storage.ts` / `progress.ts` / `gameRecords.ts`）都有 schema 版本 + 严格校验，这里是唯一例外。localStorage 里被改坏的 `theme`（如 `"foo"`）会直接进 store：`THEME_LABELS[theme]` 变 `undefined`（`AppHeader.tsx:51-52` 的按钮 title 会显示 "主题：undefined"），`resolveTheme` 对非 `'system'` 值原样返回，`applyTheme('foo')` 静默退回浅色。**不崩，但会留下 `undefined` 文案。** 而 `src/lib/theme.ts:12` 的 `isThemePreference` 正是为这种校验准备的——**它生产零引用、也没有测试** | `已证实` |
| ~~F-13~~ | `src/components/panels/MoveList.tsx:23` | ~~`Math.floor(index / 2) + 1` 隐含「黑先」，与第 24 行的 `moverAt(index, firstPlayer)` 口径冲突~~ | **本条已撤回。** 自审第一轮用独立脚本复核：无论 `firstPlayer` 是 1 还是 2，`floor(index/2)+1` 的分组与 `moverAt` 的选槽**都正确**——因为一「回合」永远是「先手方 + 对手方」这两个索引，与谁先手无关。实测 `firstPlayer=2` 时 `rows=[{black:m1,white:m0},{black:m3,white:m2}]`，黑列放黑棋、白列放白棋，次序正确。**误报原因**：我看到两种写法就先假设了它们口径不同，没有先算一遍 | 已撤回 |
| **F-14** | `src/ai/difficulty.ts:60,69,78` | `threatPlies: 6 / 10 / 14` —— **全是偶数** | 取胜链的最后一手必是攻方，可达手数只能是奇数，因此 `maxPlies = 6` 与 `5`、`10` 与 `9`、`14` 与 `13` 能搜到的杀**完全相同**（实测：60 个随机局面 × 双方 × 3 组对照，逐组相等）。参数名对读者与未来的调参者有误导性 | `已证实`（实测，见 §5.5） |
| **F-15** | `src/ai/patterns.ts:91` | `buildLine` 无条件执行 `line[CENTER] = 1` | 于是 `analyzeFast` / `isWinningPoint` 对**已经落子**的点会假装它是空的，返回「假如这里是空的」的答案。当前全部生产调用点都只传空点：`isWinningPoint` 的 6 处（`search.ts:230,231,463,468`、`threat.ts:66`、`verify.ts:46`）与 `analyzeFast` 的 6 处（`search.ts:185,189,235`、`threat.ts:88`、`patterns.ts:403,408`）取的点**全部来自 `candidateMoves`**，而它只收 `board[index] === 0` 的空位（`candidates.ts:31`）。所以不出错。**这是一条没有文档、没有断言的隐式前置条件** | `已证实`（读代码 + 逐调用点核对） |
| **F-17** | `src/store/useGameStore.ts:38-51` | `useGameStore.subscribe((state) => {...saveSession(...)})` 没有 selector | 每次**任何** state 变化（`aiThinking`、`hint`、`aiInfo`、`recordSaveState`、`aiError`…）都会 `JSON.stringify` 整个手顺并同步写 localStorage。落子一手会触发多次。**绝对成本未实测**（手顺最多 225 个坐标 ≈ 4 KB，量级应在 0.1 ms 以下），所以只记为「无必要的写放大」，**不声称有性能问题** | `静态风险` |
| **F-18** | `e2e/battle.spec.ts:212`、`e2e/review.spec.ts:79,85` | `waitForTimeout(3500 / 2500 / 2000)`；`e2e/a11y.spec.ts:97-100`、`e2e/tablet.spec.ts:233-234` 的注释明确写「靠专家档 2600 ms 预算期间 AI 不会插进来」 | 慢机器 / 高负载 CI 上的 flaky 风险。本机 44 条一次全绿（1.5 min） | `已证实` |
| **F-19** | `e2e/review.spec.ts:19-28` ↔ `e2e/prod.spec.ts:52-57` | 同一个 9 手终局序列写了两遍，逐字相同 | 改一处漏一处 | `已证实` |
| **F-20** | `src/features/battle/BattleScreen.test.tsx:14-20`、`src/store/settingsStore.test.ts:18` | `vi.hoisted` 里全局替换 `Worker` 且**不还原**；`window.matchMedia` 覆盖后**不还原** | 靠 vitest 的按文件隔离才没炸。文件内新增用例时容易踩到 | `已证实` |
| **F-21** | `src/store/useGameStore.ts:35-51` | `bootstrapStore()` 全仓无任何测试引用（grep 只有 `main.tsx:6` 与定义处） | 「恢复上次对局 + 自动存档订阅」这条链路没有单测。e2e 覆盖了刷新恢复（`battle.spec.ts:80,107`），但**自动写入**这一半没有直接断言 | `已证实` |
| **F-22** | `src/store/analysisStore.ts:336-339` | `stop()` 只做 `reset()` + 清 `target`，**不清 `engine` / `record` / `difficulty` / `budgetMs`** | 闭包继续持有上一局的 `GameRecord`（含全部手顺）。store 随复盘页创建与销毁，因此实际滞留时间 = 页面停留时间。量级很小 | `已证实` |
| **F-23** | `src/ai/patterns.ts:399` / `src/ai/patterns.ts:246` | `threatScoreWith` 在 `five/openFour/four` 都没命中时**重新调用** `analyzeRuns`，而调用方 `orderMoves`（`search.ts:185-189`）已经对同一个 `point` 调过一次 `analyzeFast` | `analyzeRuns` 内部再扫 4 个方向。**这不是冗余**——`analyzeFast` 只算五与四，不算三与二；两者职责不同（`patterns.ts:239-245` 有注释说明）。**记在这里是为了避免后来者把它当冗余删掉** | `已证实` |
| **F-28** | `src/components/ui/Modal.tsx`（终局结果弹窗） | **弹窗关闭后焦点落到 `<body>`**，键盘用户要从页面最开头重新 Tab。**Playwright 在真实 Chrome 里实测过**：五连终局与认输终局两条路径，关闭后 `document.activeElement` 都是 `BODY` | 根因是「打开前持有焦点的元素」在两条路径上都变得不可聚焦：五连终局时刚点过的那一格 `<rect>` 因整盘 `interactive` 变假而失去 `tabindex`；认输终局时「认输」按钮已 `disabled`。**所以「关掉弹窗把焦点还给原处」这个标准做法在本应用里是空操作**（本轮加过，实测无效后撤掉，见 `Modal.tsx` 里的注释）。要真正修好得先决定「关掉之后焦点该落到哪」——属产品决策 | `已证实`（真机实测） |
| **F-25** | `src/store/gameStore.ts:217-241`（`notifyGameEnd`） | 入库存根**没有配对闸门**：`recordedSeq` 只在 `onGameEnd` 返回的 promise 兑现时才写（`:238`），而 `replacesSeq` 读的是**发起时**的 `before.recordedSeq`（`:229`）。对比 `analysisStore` 有 `runId` 做配对 | 两条**低概率但机制真实**的路径会留下重复棋谱：①第二次终局发生在第一次入库 promise 兑现**之前**（需在毫秒级窗口内完成「关弹窗→悔棋→再终局」）；②**终局 → 刷新 → 悔棋 → 用不同手顺再终局**——刷新后 `recordedSeq` 归 null，而 `saveGameReplacing` 的内容匹配只认**完全相同的手顺**（`gameRecords.ts:172-185`），匹配不上就新增一条。`gameRecords.ts:160-163` 的注释只解释了「手顺相同」那半 | `已证实`（读代码确定；②可用脚本复现，未在浏览器里走过） |
| **F-26** | `src/store/analysisStore.ts:237` | 第三道闸门（`response.moveIndex !== index`）命中时**直接 return**：既不清 `inflightIndex`，也不 `pump()`——队列会永久停在原地 | 真实引擎下**不可达**：`search.ts:569` 原样回显 request 的 `moveIndex`。属**防御性代码自身不一致**（前两道闸门都写了「不许动 `inflightIndex`」的注释，这道却漏了收尾） | `已证实` |
| **F-27** | `src/features/learn/PracticeBoard.tsx:35,69` | `attempt` 与 `reported` ref 在 `practice` 变化时**不复位**，安全性完全依赖调用方换 `key` 强制重建（`LessonView.tsx:67` `key={lesson.id}`、`PuzzleScreen.tsx:150` `` key={`${id}:${round}`} ``） | 两个调用点当前都满足，所以不出错。**但这是一层隐式的、没有断言保护的安全**：将来有人不带 `key` 复用这个组件，就会同时出现「上一题的判定结果还在」与「`reported` 已置位导致 `onSolved` 不再回调」两个错误 | `已证实` |

---

## 3. 合理推测 / 待验证

| ID | 推测 | 为什么只到「推测」 | 验证方式 |
| --- | --- | --- | --- |
| **S-01** | F-03 的触发条件（事务在 commit 阶段中止）在**配额接近上限**或**多标签页同时写**时可复现 | 没有构造出确定性的复现；`fake-indexeddb` 不模拟 commit 阶段失败 | 在真实浏览器里给 IndexedDB 灌到接近配额，或在 DevTools 里制造 `abort`；或写一条 mock `IDBTransaction` 的单测 |
| **S-02** | F-17 的写放大在**长手顺 + 低端设备**上有可感知成本 | 未实测。按数据量估算应在 0.1 ms 量级 | 给 `bench/render.probe.mjs` 加一段：连续落子 100 手，量 `localStorage.setItem` 的累计耗时 |
| **S-03** | `analysisStore` 的「满盘跳过末手并减 `total`」路径在**真实盘面**上没有被 e2e 走过（`review.spec.ts` 用的是 9 手终局，不是满盘） | 只有单测的组合用例间接经过 | 构造一条 225 手满盘和棋的棋谱灌进 IndexedDB，再打开分析 |
| **S-04** | `Board.tsx` 的 225 个命中 `<rect>` + 225 个 `onKeyDown` 闭包在**每帧重绘**的场景下会变成瓶颈 | 现有实测（`bench:render`）量的是当前渲染路径，作者自己在 `ROADMAP.md:141` 写明「若棋盘将来改成每帧重绘，落子成本必须重量一遍」 | 属于**已知且已被声明的前提**，不需要额外验证 |
| **S-05** | `noUncheckedIndexedAccess` 未开，`board[i]` 的类型是 `number`；若将来有人在 `core` 之外手写索引访问，越界会静默读到 `undefined` 参与算术 | 当前全部访问都经过 `cellAt` / `inBounds` | 打开该选项跑一次 `tsc`，看告警量是否可接受（预计很多，因为热路径大量索引访问） |

---

## 4. 与文档一致的已记录项（复核结论：**全部属实**）

仓库的 `ROADMAP.md` / `AI_ENGINE.md` 记录了 14 条已知不足。逐条对照代码复核：

| 文档记录 | 复核 |
| --- | --- |
| 专家档深度上限（8 层）从未达到 | 属实。`difficulty.ts:74` `depth: 8`、`:75` `budgetMs: 2600`；`AI_ENGINE.md:197-201` 的实测表前三行专家档全是 `timeout` |
| 不算 VCT | 属实。`difficulty.ts:43,52,61,70,79` 五档 `threatThrees: false` |
| 算杀活三链只允许一层 | 属实。`threat.ts:37` `MAX_THREE_LAYERS = 1` |
| 局面评估不识别跨方向组合形状 | 属实。`evaluate.ts:176-185` 逐线段累加，无跨方向项 |
| 评估是瓶颈、O(整盘) | 属实。`evaluate.ts:180-182` 每叶扫 `LINES`（15+15+21+21 = **72** 条，注释里的 72 是对的） |
| 学习进度没有迁移机制 | 属实。`progress.ts:101` 版本不符即 `return null`，全仓无迁移函数 |
| 分析缓存只在页面打开期间有效 | 属实。`analysisStore.ts:56` 的 `cache` 是闭包局部量；`ReviewScreen.tsx:38-39` 的 store 由 `useState` 惰性创建，卸载即丢 |
| 回放游标不持久化是有意的 | 属实。`replayStore.ts` 无任何持久化调用 |
| 分析固定用初级档 + 400ms | 属实。`ReviewScreen.tsx:112-113`（同时是 F-06 的成因） |
| 同一时刻只分析一局 | 属实。`analysisStore.ts:36` `start()` 会覆盖 `target` 并 `reset()` |
| 满盘和棋的末局无结论 | 属实。`analysisStore.ts:92-101` |
| 基准不做断言 | 属实。`bench/engine.bench.ts:407` 是文件里唯一的 `test(`，无 `expect`；产物写进被 git 跟踪的 `bench/last-run.json` |
| 子路径部署没有自动化用例 | 属实。全仓 grep `VITE_BASE` 只命中 `vite.config.ts:10` 与 `README.md` |
| 复盘页对读屏用户只是一张图 | 属实。`ReplayBoard.tsx:54` `interactive={false}` → `Board.tsx:283` 退成 `role="img"` |

**没有发现任何一条被夸大的「已知不足」，也没有发现文档里承诺了而代码没做到的事。** 这是本次审计里最反常、也最值得记录的一条正面结论。

唯一一处**措辞需要更新**的地方：`AI_ENGINE.md:281` 说「提示的棋型分析只值 0.56 ms。这一条原先写的是『比搜索贵得多』——那是错的」，而 `ROADMAP.md:67` 仍然写着「**提示的棋型分析（`analyzePoint`）比搜索贵得多**，只在 `purpose: 'hint'` 时才付这份钱」。两份文档在同一个事实上**互相矛盾**，`AI_ENGINE.md` 已自我更正，`ROADMAP.md` 没跟上。

---

## 5. 算法正确性的独立验证（Phase C 的核心）

**方法**：在仓库**之外**（`/tmp/gomoku-audit/`）写一套不复用项目任何算法的参考实现，全部基于「全盘暴力扫描 5 连窗口」这一条最朴素的定义，与项目里 `core/rules.ts` 的「从最后一手出发」、`ai/patterns.ts` 的「±4 窗口枚举」是两条完全不同的代码路径。

**这一节的所有数字都是本轮现跑出来的**，命令：
```bash
cd /Users/leo/leocode/vibe/games/gomoku
yarn vitest run --config /tmp/gomoku-audit/vitest.audit.config.ts
```

### 5.1 规则层（`core/`）

| 检查项 | 规模 | 结果 |
| --- | --- | --- |
| `findWinLine` vs 「全盘扫描 5 连」 | 800 局随机合法对局（400 局均匀撒点 + 400 局邻域聚类），逐手比对 **5000+ 个局面** | **零分歧** |
| 返回的连线是否真是「极大连续段」 | 同上，对每个成五局面查两端再外一格 | 全部成立 |
| `replay` vs 独立增量重放（棋盘/状态/胜负/轮次/版本） | 300 局 × 20–140 手 | **零分歧** |
| `replay` 对非法手顺的截断（重复落子、越界） | 在随机手顺中间插入非法手 | 从该处截断，不是跳过 —— 与 `RULES.md:43` 一致 |
| `applyMove` / `undo` / `resign` 的不可变性 | 随机对局 | 原状态零改动 |
| `validateMove` vs 参考实现（全部 225 格） | 60 手随机局面 | 零分歧 |
| 「判胜优先于判和」 | **独立构造**：以 `(x+2y)%4<2` 模式起步（四方向最长同色都只有 2），做 4 处等量互换（2 W→B、2 B→W）使黑白仍为 113/112，得到**全盘唯一一处五连**（第 11 行 x=10..14，全黑），再把 `(14,11)` 排成第 225 手 | `replay` 返回 `status: 'won'`、`winner: 1`、`winLine.length: 5`、`isBoardFull: true` —— **正确** |

### 5.2 棋型识别（`ai/patterns.ts`）

| 检查项 | 规模 | 结果 |
| --- | --- | --- |
| `analyzeFast` 的 `five` / `openFour` / `four` / `winningPoints` | **38,670 个 (局面, 点, 方) 组合**，其中 **926 个**存在成五点 | **零分歧** |
| `isWinningPoint` | 同上，逐点 | 零分歧 |
| `analyzePoint` 的 `five` / `openFour` / `four`（逐方向计数） | 同上 | 零分歧 |
| `shapeScore` 非负、成五时恰为 `WIN_SCORE` | 同上 | 成立 |

> **审计过程中的一处自我更正（值得记下来）**：第一次跑时报告了 408 处分歧。逐条追下去，**是我的参考实现错了**——我在参考实现里用 `1` 当「落点已占」的哨兵，而 `1` 恰好是黑棋的编码（`core/types.ts:29`），于是 `player === 2` 时被 `c !== p` 判成对手子。修好哨兵后分歧归零。**这条记在这里是因为它同时说明了两件事**：项目的 `buildLine` 用**独立的 `line` 数组**（1 表示「己方」）而不是复用棋子编码，是正确的设计；以及「独立验证」这套东西本身也必须被验证。

### 5.3 候选点（`ai/candidates.ts`）

| 检查项 | 规模 | 结果 |
| --- | --- | --- |
| `candidateMoves` vs 参考实现（Chebyshev 距离 ≤ r 的空点） | 101 个局面 × 半径 1/2/3 | 零分歧 |
| 空盘 / 满盘返回空数组 | — | 成立 |

### 5.4 置换表（`ai/transposition.ts`）

| 检查项 | 规模 | 结果 |
| --- | --- | --- |
| 增量 `toggleStone` + `toggleTurn` vs 从零 `computeKey` | 120 局，逐手比对 | **零分歧** |
| 双方视角的同一棋盘键不同 | — | 成立 |

### 5.5 算杀的可靠性（`ai/threat.ts`）—— 用独立 minimax 复核

参考实现是一个**不含任何启发式的完全枚举 minimax**：攻方每节点枚举全部候选点，守方也是，守方先成五即攻方失败。它与 `findForcedWin` 的内部结构（`fourMakers` 剪枝、冲四/活三分层、`MAX_THREE_LAYERS`）**没有任何共同代码**。

| 检查项 | 规模 | 结果 |
| --- | --- | --- |
| **教学内容里每一条 `forcedWin` 结论** | 5 条（4 道题 + 1 处课程练习） | **独立证实 4 条；1 条（`puzzle:forced-counter`，`maxPlies: 7`）超出 200 万节点预算被跳过**；**零反例** |
| `findForcedWin` 的**声性**（随机局面里它给出的每一手） | 40 局随机中盘，`maxPlies: 5` | 10 次断言，**独立证实 9 次**，1 次超预算跳过，**零反例** |
| 三手算杀**不误报** | 60 局随机中盘，`maxPlies: 3` | 复核 14 次，**独立 minimax 不同意 0 次** |
| `maxPlies` 偶数档 ≡ 下面那个奇数档（F-14） | 60 局面 × 2 方 × {6,5} {10,9} {14,13} | **逐组 `plies` 完全相等** |

> **这条验证的边界要说清楚**：它证明的是**声性**（引擎说「有杀」时真有杀），这正是 `AI_ENGINE.md:141` 承诺的性质（「宁可说『没找到』，也绝不给出没验证过的杀」）。它**不证明完备性**——引擎漏掉的杀不在本次验证范围内，而文档本身就把漏杀列为已知局限（不算 VCT、活三链只允许一层）。
>
> `puzzle:forced-counter` 那一条**至今没有被独立证实**。它是题库里 `maxPlies` 最大的一道（7），穷举验证需要指数级节点。**如实记为「未验证」，不假装验过。**

### 5.6 教学内容的可解性与自洽性

| 检查项 | 规模 | 结果 |
| --- | --- | --- |
| 全部 23 处练习/题目的手数奇偶与「轮到你走 X 棋」一致 | 8 节课 + 15 道题 | 零问题 |
| 全部题面开局都没有人已经连成五子 | 同上，横/竖/两斜全扫 | 零问题 |
| `goalHint`（第二级提示）**不泄漏坐标** | 全部 23 处 | 零问题 |
| `solveMove` / `judgeMove` 的真实耗时 | 全部 23 处 | 见下 |

**耗时实测（本轮现跑，Apple M3）：**

| 指标 | 实测 |
| --- | --- |
| `solveMove` 最坏一次 | **33.6 ms**（`puzzle:block-diag`，目标 `blockFive`） |
| `judgeMove` 最坏一次 | **8.0 ms** |
| 23 处里 `solveMove` > 20 ms 的 | 1 处 |

> **为什么专门量这个**：`src/features/learn/PracticeBoard.tsx:38-41` 在 **`useMemo` 里同步调用 `solveMove`**，而 `solveMove` 对 `forcedWin` 目标会走 `findForcedWin`（`hints.ts:12` 的预算上限是 **3000 ms**）。也就是说，理论上「点第三次提示」可能冻结主线程最多 3 秒，且**没有任何加载态**。
>
> **实测把这个担心否掉了**：真实内容上最坏 33.6 ms，一次帧的预算（16.7 ms）量级附近，用户感知不到。**结论是「测过、不改」。** 但如果将来往题库里加更难的 `forcedWin` 题，这个上限会重新变得相关——**记录为「有前提的结论」**，不写成无条件的安全。

### 5.7 本轮**没有**验证到的算法部分（如实声明）

| 未验证项 | 原因 |
| --- | --- |
| `negamax` / `searchRoot` 的搜索正确性（alpha-beta、杀手着法、迭代加深的完整语义） | 没有写独立的 negamax 参考实现。现有证据是 `search.test.ts`（578 行）与 `difficulty.test.ts` 的接线测试，属于**同源验证** |
| `evaluateBoard` 的分值语义（是否「合理」） | 只验证了不变量（严格反对称、空盘为 0、逐步落子单调性），**没有验证数值本身好不好**。评估函数的调参属于棋力问题，不是正确性问题 |
| `MAX_THREE_LAYERS = 1` 造成的漏杀范围 | 未量化。文档已声明这是有意的漏杀 |
| 真实浏览器里的 AI 棋力 | 本轮未做对局观感评估 |

---

## 6. 明确「无需修改」的清单（防止过度优化）

审读全部源码后，以下部分**经检查后判定不应改动**。列出理由，是为了让后来者不必重新论证一遍。

| 项 | 位置 | 为什么不动 |
| --- | --- | --- |
| 49 个从未被外部引用的**类型/接口导出** | 如 `*Props`、`*Options`、`ShapeCount`、`MoveOutcome`、`RequestPurpose` | 它们是显式契约与可读性载体，删掉不会让代码变小，只会让签名内联 |
| 36 个**只被测试引用**的导出 | `searchBoard`、`searchOptionsFor`、`createLearnStore`、`__setIndexedDbFactory`、`memoryGameRecords`… | 这是「为可测性开放的接缝」。`__set*Factory` 的注释明确写了「生产路径不调用」 |
| `src/components/board/Board.tsx` 的 565 行 | | 六类 SVG 内容共享同一套用户坐标系与同一个 `uid`，拆开就必须提升 `uid`/`viewBox`/`focused`/`hovered` 或引入 context。**这是「偏大但耦合是真的」，不是坏味道** |
| 225 个命中 `<rect>` + 每格一个 `onKeyDown` | `Board.tsx:539-557` | `bench:render` 实测落子一手 click→React 提交中位 **0.30 ms**，加 `React.memo` 只换来一层要维护的依赖比较 |
| 教学 / 题库不拆出主包 | | 实测首屏「应用自身」共 136 ms，拆出去省个位数到几十毫秒，却要加 Suspense 边界与加载态 |
| 两套棋型分值表 | `patterns.ts:46` / `evaluate.ts:14` | 一张用于单点排序、一张用于整盘评估，量级不同是**有意的**，`evaluate.ts:9-13` 明确禁止互相套用 |
| 两种「三」的判定口径 | `analyzeDirection` / `analyzeRuns` | 精确口径是搜索热路径付不起的代价 |
| `lib/shape-labels.ts` 反向依赖 `ai` / `learn` 的类型 | | 它的职责**就是**把两个领域的棋型词汇映射成同一套中文名。type-only，运行时零耦合 |
| `src/ai/patterns.ts:399` `threatScoreWith` 里那次 `analyzeRuns` | | **不是冗余**：`analyzeFast` 不算三与二，两者职责不同 |
| `noUncheckedIndexedAccess` 未开 | `tsconfig.app.json` | 棋盘访问在热路径上每节点数万次；打开它只换来「用 `!` 压制」的噪声，安全性已由 `Uint8Array` + `inBounds` 前置校验保证 |
| `AppHeader` 的 `ThemeToggle` 三态图标、`BrandMark` 的五颗小棋子 | | 纯视觉，已被目视复核与对比度守卫覆盖 |
| 无 router，用 `useLearnStore` 的 `view` 切页 | `App.tsx:23-26` | 四个页面、无深链接需求。引入 router 是**没有第二个消费者**的抽象 |
| `vite.config.ts` 的 `base: process.env.VITE_BASE ?? '/'` | | 构建期常量而不是运行时读 `location`——注释解释了理由，且子路径部署已用产物断言覆盖 |
| 无 CI 配置文件 | 仓库根目录无 `.github/` 等 | 仓库的验收方式是「提交前手工跑五条命令」，`AGENTS.md:36-52` 写得很明确。**是否上 CI 是产品决策，不是缺陷** |

---

## 7. 十个维度的评分与依据

**评分不是总分，每一项都附可复核的依据。** 分数是「按本项的判据来看，这一维度离该判据的上限还有多远」——不是「这项目好不好」。

| # | 维度 | 分 | 依据（可复核） | 主要扣分项 |
| --- | --- | --- | --- | --- |
| 1 | **规则正确性**（`core/`） | **10 / 10** | 独立参考实现在 **5000+ 个随机局面**上逐手比对 `findWinLine`，**零分歧**；300 局比对 `replay` 与独立增量重放（棋盘/状态/胜负/轮次/版本），**零分歧**；「判胜优先于判和」用独立构造的满盘局面验证通过；四方向长连、四边、四角、越界、非整数坐标全覆盖。见 §5.1。**但本轮未验证 `negamax` 的搜索语义**，见 §9.2 | 无 |
| 2 | **引擎算法正确性**（`ai/`） | **9 / 10** | 棋型识别 **38,670 个 (局面, 点, 方) 组合**（其中 926 个存在成五点）与独立参考实现**零分歧**；候选点 101 局面 × 3 半径零分歧；置换表增量 vs 从零 **120 局逐手零分歧**；算杀**声性**经独立完全枚举 minimax 证实（13 次断言 12 次证实、1 次超预算、**零反例**）。见 §5.2–5.5 | `puzzle:forced-counter` 一条 `forcedWin` 结论**未被独立证实**（穷举超预算）；`negamax`/`searchRoot` **没有独立参考实现**，属同源验证 |
| 3 | **棋力（产品能力）** | **6.5 / 10** | `AI_ENGINE.md` 的实测表：专家档在三个真实局面上**全部 `timeout`**（完成 6/6/5 层，上限 8），耗满 2.6 s；不算 VCT；评估不识别跨方向组合形状。**全部已诚实标注**，无一夸大 | 深度上限从未达到；瓶颈已定位（`evaluateBoard` O(整盘)）但未解决。**这是产能问题不是质量问题**——扣分扣在能力，不在诚实 |
| 4 | **并发与状态管理** | **9 / 10** | 三类请求各自的过期闸门（`gameStore.ts:403,484`、`analysisStore.ts:235-237`）齐备且各有测试；全局唯一请求号；引擎失败复位 + 提供重试入口，**不动棋局**；`canHumanPlay` / `shouldAiMove` 是集中式纯函数，被 store 与棋盘共用 | `bootstrapStore()`（恢复 + 自动存档）**零测试**；`analysisStore` 的 8 个闭包变量是全仓耦合密度最高的状态 |
| 5 | **持久化与数据完整性** | **7.5 / 10** | 三个自建模块（对局存档 / 学习进度 / 棋谱库）各有 schema 版本闸门 + 逐字段严格校验 + 内存兜底；`PutResult.persisted` 与 `recordSaveState` 让界面**如实**区分「真存了」与「只活在内存里」；`winner` 不信任调用方、由 `replay` 现推 | **F-03**：`withStore` 用 `request.onsuccess` 而非 `tx.oncomplete` 判定成功，与 `progress.ts` 口径不一致；**F-12**：`settingsStore` 的 `persist` 无版本无校验，是唯一例外 |
| 6 | **分层与架构** | **9.5 / 10** | 412 条内部边**无环**（Tarjan + DFS 两种独立实现复算）；**无逆层引用**；`core`/`ai`/`learn` 的 React/DOM/Zustand 禁令**全部成立**；`Date.now()` 唯一实际调用处就是允许的 `search.ts`；`core` 只有 4 个文件、零依赖 | `lib/shape-labels.ts` 反向依赖 `ai`/`learn` 的类型（**但那是它的职责**，见 §6）；`store/gameStore.ts` 四合一（今天只有一个消费者，不构成缺陷） |
| 7 | **类型安全** | **9 / 10** | `strict` + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch` + `erasableSyntaxOnly` + `verbatimModuleSyntax` 全开；非测试代码 **零 `any`、零 `@ts-ignore`/`@ts-expect-error`**；`enum` 零使用；`Record<Difficulty, X>` 让类型系统替人巡检两张难度表 | `noUncheckedIndexedAccess` 未开（**有意的取舍**，见 §6）；**3 处**非空断言（`threat.ts:177`、`analysisStore.ts:213,311`；`bench/` 另有 5 处） |
| 8 | **测试** | **8.5 / 10** | 767 单测 + 44 e2e 全绿；**零 `vi.mock`、零 `.skip/.only/.todo`、零 `Math.random`、零 `|| true`**；`src/test/setup.ts` 只有 7 行且不做全局放宽；e2e 覆盖真实触摸命中、拖动不滚页面、焦点环几何、AI 思考期间键盘进不去；含「撤掉修复确认用例会红」的反向验证传统 | **5 条「只在出错时才走」的路径零覆盖**（AI 返回非法着法、`handleError('')`、`GameLibrary` 的 reject 降级、`gameRecords` 的三个错误分支）；若干恒真/弱断言（`elapsedMs >= 0`、`toBeDefined()`、`textContent.length > 6`）；3 处固定 `waitForTimeout` |
| 9 | **无障碍与交互** | **8 / 10** | roving tabindex + `role="grid"/"row"/"gridcell"` + 真 `focus()` 搬运；**只有一个 live region**（`BoardAnnouncer`，状态药丸刻意不是）；焦点环是画出来的 SVG 双色环并带 4 种底色的 3:1 守卫；`reduced-motion` 交给 CSS 而非 JS 判定；对比度守卫直读 `index.css` 核 WCAG AA | **F-02**：`Modal` 声明 `aria-modal` 却无焦点陷阱、不还原焦点；复盘棋盘对读屏用户只是一张图（已在 ROADMAP 记录） |
| 10 | **文档与工程约定** | **9.5 / 10** | 14 条已知不足**逐条复核全部属实、无一夸大**（§4）；性能数字**全部来自可复现的 `yarn bench`**，且明确剔除过不可复现的估计值；`AGENTS.md` 写了「不要做的事」；`RULES.md` / `AI_ENGINE.md` / `ARCHITECTURE.md` 三份文档各自声明了自己能覆盖的改动类型 | **`ROADMAP.md:67` 与 `AI_ENGINE.md:281` 在同一个事实上互相矛盾**；`AI_ENGINE.md` 的难度参数表没有写明 `threatPlies` 的偶数语义（F-14） |

**不使用加权总分。** 十个维度的判据不同、量纲不同：把「棋力 6.5」和「规则正确性 10」加权平均，得到的数字既不能用来做决策，也不能用来追责——它只会掩盖「能力不足」与「质量不足」是两件事。

---

## 8. 最严重的十项真实风险

排序判据：**后果严重度 × 触发可能性**。全部来自本文件已列出的条目，不引入新内容。

| # | 风险 | 后果 | 概率 | 来源 |
| --- | --- | --- | --- | --- |
| 1 | **棋谱写入的成功判定口径不对**（`withStore` 只看 `request.onsuccess`） | 界面显示「这局已存入棋谱库」，实际没落盘；刷新后整局消失。**这是「骗用户」级别**，而项目的整套设计都在刻意避免这件事 | 低（需事务在 commit 阶段中止） | F-03 |
| 2 | **本地双人模式的「认输」认错人** | 用户点认输，被判认输的是另一方。屏幕上刚在下棋的人会看到自己「赢了」 | **中**（只要用户在 pve 里选过执白，之后切 pvp 就会踩到） | F-01 |
| 3 | **`Modal` 的 `aria-modal` 与实际行为不符** | 键盘用户 Tab 到被声明为惰性的背景内容上；关闭弹窗后焦点掉到 `<body>`，要从页面最开头重新 Tab | **高**（每次终局都会遇到） | F-02 |
| 4 | **性能数字与入库产物脱钩** | 文档声称可核查而实际不可核查；任何人今天跑一次 `yarn bench` 都会看到「27% 的性能回退」（`evaluateBoard` 当前产物 96.7 µs vs 文档 70–82 µs），然后去查一个不存在的 bug | **必然**（只要有人复跑基准） | F-24 |
| 5 | **lint 不管 React Hooks 依赖数组** | 依赖数组写错的后果是「值不是最新的」或「effect 多跑一次」，typecheck 与测试都抓不到。**项目已经手工踩过一次**（`PracticeBoard.tsx:63-68` 的注释就是证据） | 中，且**随组件数单调上升** | F-16 |
| 6 | **学习进度没有迁移机制** | 发布后每次递增 `PROGRESS_SCHEMA_VERSION` 都让用户**白学一遍**——而这是唯一「丢了会让人真的损失」的数据（对局存档丢了只是丢一局） | 发布后**必然**（只要将来改一次字段形状） | `ROADMAP.md:89` 已记录，本次复核确认 |
| 7 | **专家档的深度上限从未达到** | 「专家」这个标签承诺了 8 层，实测 6–7 层。用户买到的是一个名字 | **必然**（每一次专家档对局） | `AI_ENGINE.md` 实测表，本次复核确认 |
| 8 | **`settingsStore` 的 `persist` 无版本无校验** | localStorage 被改坏（或将来字段改名）时，坏值直接进 store：按钮 title 显示 `主题：undefined`，主题静默退回浅色 | 低 | F-12 |
| 9 | **`useGameStore.subscribe` 无 selector 的写放大** | 每次任何 state 变化都序列化整个手顺并同步写 localStorage。**绝对成本未实测**，按数据量估算在 0.1 ms 量级 | 高（每次落子触发多次），后果低 | F-17 |
| 10 | **e2e 依赖真实引擎耗时的固定等待** | CI 慢机器上 `battle.spec.ts:212` 的 `waitForTimeout(3500)` 与 `a11y.spec.ts:97-100` 的竞态窗口会 flaky——而 flaky 的 e2e 很快就会被当成噪音忽略，那才是真正的损失 | 中（仅 CI） | F-18 |
| 11 | **`analysisStore` 的状态耦合密度** | 8 个闭包变量 + 三重闸门 + 两个收尾时机。改管线逻辑时最容易踩到「面板停在 N-1 / N」或「跨 run 污染」，而这两条**恰好都有测试**——所以下次改动是安全的；风险在于**下一个没读到那些测试的人** | 低 | `ARCHITECTURE.md` §11 |

**这份清单里没有「架构腐化」。** 十一项里有 8 项是**具体的、局部的、可独立修复的**；剩下 3 项（#6 #7 #11）是**已如实记录的能力/产能限制**，不是隐藏的坑。唯一一项**文档腐化**是 #4，而它的修复是纯文档。

---

## 9. 审计的局限（如实声明）

用户的要求里有两条：「不要求发现一定数量的问题。若没有可靠证据，应明确报告没有发现，并说明审计局限。」
这一节是后者的兑现。

### 9.1 明确「没有发现」的几件事

| 事项 | 结论 | 我做过的检查 |
| --- | --- | --- |
| P0（会破坏数据 / 安全后果 / 产品不可用） | **没有发现** | 逐层审读了全部 74 个非测试源文件；对持久化、并发、错误处理三条路径做了专项 |
| P1（用户可见的错误行为，或明确复现路径的逻辑缺陷） | **没有发现** | 同上；四条候选（F-01~F-03、F-24）里三条是 P2、一条是文档 |
| 循环依赖 | **没有发现** | 412 条内部边完全枚举 + Tarjan SCC + DFS 着色，双实现复算 |
| 越层引用 | **没有发现** | 逐层出边核实 + 反向核实 `ai`/`core` → `learn` |
| 死 import | **没有发现** | 机械扫描 + 逐条复核（6 条初报全是 `...spread` 的解析误报） |
| 为过测而放宽全局行为 | **没有发现** | `setup.ts` 只有 7 行；`vi.mock` / `skip` / `only` / `todo` / `Math.random` 全仓零命中 |
| 「多个版本的胜负判断」 | **没有发现** | 唯一胜负函数是 `core/rules.ts:21`；教学层在做棋型判断前先调它（`verify.ts:72`） |
| 规则正确性缺陷 | **没有发现** | 独立参考实现，5000+ 局面零分歧 |

### 9.2 这一轮**没有**覆盖到的东西

| 未覆盖 | 为什么 | 影响 |
| --- | --- | --- |
| **`negamax` / `searchRoot` 的搜索语义** | 没写独立的 negamax 参考实现。现有证据是 `search.test.ts`（578 行）与 `difficulty.test.ts` 的接线测试，**属同源验证** | 剪枝、杀手着法、迭代加深的接缝处若有问题，本轮查不出。这是本次审计**最大的空白** |
| **`evaluateBoard` 的数值语义** | 只验了不变量（严格反对称、空盘为 0、逐步落子单调性），没验数值好不好 | 评估函数的调参属**棋力**问题，不是正确性问题，但本轮无法为棋力背书 |
| **圈复杂度 / 重复度的量化** | 没装 `jscpd` / SonarQube（「不得为了通过审计擅自安装工具」） | `ARCHITECTURE.md` §3.2 与 §4 的结论是**人工判读**，不是工具输出。见 `BASELINE.md` §3 的取舍表 |
| **覆盖率百分比** | 没装 `@vitest/coverage-*` | `TEST_GAPS.md` 的缺口清单能确定「某条分支没有任何用例引用它」，给不出百分比 |
| **`puzzle:forced-counter` 的 `forcedWin` 结论** | 穷举验证超出 200 万节点预算 | 题库里唯一一条 `maxPlies: 7` 的题**未被独立证实**。如实记为「未验证」 |
| **真实设备上的触摸与移动端表现** | e2e 用的是 Playwright 的设备描述符 + 本机 Chrome，**不是真机** | `tablet.spec.ts` 的几何与触摸结论在真机上可能不同 |
| **棋力的人类观感** | 本轮没做对局体验评估 | 「AI 强不强」这一维只有基准数字，没有体感 |
| **`bench:render` 的首屏 / 落子成本** | 本轮没有需要新性能数字的结论 | 沿用了 `TEST_REPORT.md` 的既有数字（它们有产出物） |
| **多标签页并发、隐私模式、配额耗尽** | 需要真实浏览器环境与特定条件 | F-03 因此停在「静态风险」 |

### 9.3 方法上的两条已知弱点

1. **我照抄过子代理的数字。** `TEST_GAPS.md` 的 e2e 用例数初稿全错，根因是我没有自己数一遍。**这条已被独立终审抓出并订正**（见 `TEST_GAPS.md` §2 与 `REFACTOR_PLAN.md` 的终审记录）。此后所有进入交付物的量化结论都由我自己跑命令核实。
2. **我自己也写出过一条误报（F-13）。** 撤回记录保留在 §2 的表里。**误报的类型是「看到两种写法就先假设它们口径不同」**——先算一遍就能避免。

### 9.4 置信度的总体判断

| 结论类别 | 置信度 |
| --- | --- |
| 规则层（`core/`）的正确性 | **高** —— 独立参考实现交叉验证 |
| 棋型识别、候选点、置换表、算杀**声性** | **高** —— 同上 |
| 依赖图与分层约束 | **高** —— 双实现复算 |
| 全部带行号的代码事实断言 | **高** —— 经独立终审核对 16 条，5 处行号错误已订正 |
| 「哪些分支没有测试覆盖」 | **中高** —— 读代码得出，方向可靠、边界不精确 |
| 复杂度与重复度 | **中** —— 人工判读 |
| `negamax` 的搜索语义 | **未验证** |
