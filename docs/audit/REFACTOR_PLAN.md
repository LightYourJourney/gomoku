# 渐进治理计划（Phase F）

配套阅读：`FINDINGS.md`（发现与证据）、`TECH_DEBT.md`（债务与扩展性）、`TEST_GAPS.md`（测试缺口）。

**本计划的执行纪律**（沿用本项目的固定做法）：

1. 每个批次开工前，先把该批次要保护的行为写成测试；**写完把修复临时撤掉跑一次**，确认它真的会红。
2. 一次只做一个相对独立的问题，做完跑 `yarn lint && yarn typecheck && yarn test`。
3. 批次收尾跑 `yarn build && yarn e2e`；改了棋盘交互或布局再加目视复核。
4. **绝不为了消除代码味道而改变游戏行为。** 任何改变用户可见行为的条目一律进「批次 5 · 待授权」，不擅自做。
5. 每批结束后回填「修复前后」的对照（测试数、受影响文件、风险）。

---

## 批次总览

| 批次 | 内容 | 条数 | 风险 | 是否改变行为 | 状态 |
| --- | --- | --- | --- | --- | --- |
| **0** | 文档修正（矛盾 + 产物出处） | 3 | 零 | 否 | ✅ 已完成 |
| **1** | 零行为变更的机械对齐 | 7 | 极低 | 否 | ✅ 已完成 |
| **2** | 补测试，锁定既有行为 | **4**（原定 5，B2-4 已有覆盖） | 零（只加断言） | 否 | ✅ 已完成 |
| **3** | P2 修复（事务口径、设置校验） | 2 | 低—中 | **是**（仅在异常路径） | ✅ 已完成 |
| **4** | 无障碍：Modal 焦点管理 | 1 | 低 | **是**（键盘交互） | ✅ 已完成（焦点还原部分实测无效后撤掉） |
| **5** | **待用户授权** | 3 | — | 是 | **不执行** |

---

## 批次 0 · 文档矛盾修正

### D-0-1 · `ROADMAP.md` 与 `AI_ENGINE.md` 在同一事实上互相矛盾

- **位置**：`docs/ROADMAP.md:67` 写「**提示的棋型分析（`analyzePoint`）比搜索贵得多**，只在 `purpose: 'hint'` 时才付这份钱」；`docs/AI_ENGINE.md:281` 已经自我更正：「提示的棋型分析只值 0.56 ms。这一条原先写的是『比搜索贵得多』——那是错的，差了三四个数量级」。
- **改法**：把 `ROADMAP.md:67` 改成与 `AI_ENGINE.md` 一致的措辞（并注明实测值 0.53 ms / 5.98 µs）。
- **验证**：`grep -n "贵得多" docs/*.md` 只剩零处或只剩 `AI_ENGINE.md` 里那句**历史说明**。
- **风险**：零（纯文档）。

### D-0-2 · `threatPlies` 的偶数语义没有写进文档

- **位置**：`docs/AI_ENGINE.md` 的「难度参数」表（第 151-157 行）与「算杀」一节。
- **改法**：加一段说明「**`maxPlies` 是上界不是紧界：取胜链的最后一手必是攻方，所以可达手数只能是奇数——`6` 与 `5`、`10` 与 `9`、`14` 与 `13` 能搜到的杀完全相同**（实测：60 个随机局面 × 双方 × 3 组对照，逐组 `plies` 相等）」。
- **为什么值得写**：`ROADMAP.md:88` 已经为 `forcedWin` 的 `maxPlies` 写过一次同样的诚实说明（「上界不是紧界」），但难度参数表没有。不写的话，未来调参的人会以为把 6 改成 8 就多搜了两手。
- **风险**：零。**不修改 `difficulty.ts` 的数值**——改了会改变搜索预算消耗，属于行为变更。

### D-0-3 · 把性能表格的**产物出处**写成真的（F-24）

- **位置**：（「原始结果写在 」）、（单次评估 70–82 µs）、（0.56 ms）。
- **事实**：表格取自  时刻的 ；该文件已被  的复跑覆盖（ 23,939 → 23,272）。当前产物的  是 **96.7 µs**，落在文档声明的 70–82 µs **之外**。
- **改法（方案 B，只改文档，不动任何数字）**
  1. 把  的「原始结果写在 」改成**写明出处提交**：表格数字出自  时刻的产物，该文件已被  的复跑覆盖。
  2. 在搜索表的「读表要点」里补一条实测：** 判定的 12 行在两次运行之间 depth 与 nodes 逐字一致（只有  变）， 判定的 5 行 nodes 全变，最大差 33%** —— 这既如实说明差异，也**独立证实**了文档原有的「稳定的行逐字一致」这个说法。
  3. 把  的「0.56 ms」改成与产物一致的「约 0.53 ms（ 产物）/ 0.58 ms（ 产物）」，或直接引用  那张表的 0.53 ms。
- **验证**：{
  "runs": 5,
  "search": [
    {
      "difficulty": "beginner",
      "position": "开局",
      "depth": 1,
      "nodes": 12,
      "elapsedMs": 1,
      "reason": "search"
    },
    {
      "difficulty": "beginner",
      "position": "中盘",
      "depth": 1,
      "nodes": 12,
      "elapsedMs": 1,
      "reason": "search"
    },
    {
      "difficulty": "beginner",
      "position": "四连威胁",
      "depth": 0,
      "nodes": 0,
      "elapsedMs": 0,
      "reason": "win"
    },
    {
      "difficulty": "beginner",
      "position": "双三",
      "depth": 1,
      "nodes": 12,
      "elapsedMs": 1,
      "reason": "search"
    },
    {
      "difficulty": "beginner",
      "position": "接近满盘",
      "depth": 1,
      "nodes": 12,
      "elapsedMs": 1,
      "reason": "search"
    },
    {
      "difficulty": "easy",
      "position": "开局",
      "depth": 2,
      "nodes": 59,
      "elapsedMs": 5,
      "reason": "search"
    },
    {
      "difficulty": "easy",
      "position": "中盘",
      "depth": 2,
      "nodes": 68,
      "elapsedMs": 7,
      "reason": "search"
    },
    {
      "difficulty": "easy",
      "position": "四连威胁",
      "depth": 0,
      "nodes": 0,
      "elapsedMs": 0,
      "reason": "win"
    },
    {
      "difficulty": "easy",
      "position": "双三",
      "depth": 2,
      "nodes": 71,
      "elapsedMs": 8,
      "reason": "search"
    },
    {
      "difficulty": "easy",
      "position": "接近满盘",
      "depth": 2,
      "nodes": 46,
      "elapsedMs": 3,
      "reason": "search"
    },
    {
      "difficulty": "medium",
      "position": "开局",
      "depth": 4,
      "nodes": 746,
      "elapsedMs": 78,
      "reason": "search"
    },
    {
      "difficulty": "medium",
      "position": "中盘",
      "depth": 4,
      "nodes": 596,
      "elapsedMs": 68,
      "reason": "search"
    },
    {
      "difficulty": "medium",
      "position": "四连威胁",
      "depth": 0,
      "nodes": 0,
      "elapsedMs": 0,
      "reason": "win"
    },
    {
      "difficulty": "medium",
      "position": "双三",
      "depth": 4,
      "nodes": 864,
      "elapsedMs": 123,
      "reason": "search"
    },
    {
      "difficulty": "medium",
      "position": "接近满盘",
      "depth": 4,
      "nodes": 265,
      "elapsedMs": 26,
      "reason": "search"
    },
    {
      "difficulty": "hard",
      "position": "开局",
      "depth": 6,
      "nodes": 10076,
      "elapsedMs": 1101,
      "reason": "search"
    },
    {
      "difficulty": "hard",
      "position": "中盘",
      "depth": 6,
      "nodes": 7202,
      "elapsedMs": 921,
      "reason": "search"
    },
    {
      "difficulty": "hard",
      "position": "四连威胁",
      "depth": 0,
      "nodes": 0,
      "elapsedMs": 0,
      "reason": "win"
    },
    {
      "difficulty": "hard",
      "position": "双三",
      "depth": 5,
      "nodes": 11568,
      "elapsedMs": 1601,
      "reason": "timeout"
    },
    {
      "difficulty": "hard",
      "position": "接近满盘",
      "depth": 6,
      "nodes": 808,
      "elapsedMs": 90,
      "reason": "search"
    },
    {
      "difficulty": "expert",
      "position": "开局",
      "depth": 6,
      "nodes": 23939,
      "elapsedMs": 2602,
      "reason": "timeout"
    },
    {
      "difficulty": "expert",
      "position": "中盘",
      "depth": 6,
      "nodes": 18308,
      "elapsedMs": 2601,
      "reason": "timeout"
    },
    {
      "difficulty": "expert",
      "position": "四连威胁",
      "depth": 0,
      "nodes": 0,
      "elapsedMs": 0,
      "reason": "win"
    },
    {
      "difficulty": "expert",
      "position": "双三",
      "depth": 5,
      "nodes": 18802,
      "elapsedMs": 2601,
      "reason": "timeout"
    },
    {
      "difficulty": "expert",
      "position": "接近满盘",
      "depth": 8,
      "nodes": 1738,
      "elapsedMs": 212,
      "reason": "search"
    }
  ],
  "evaluate": {
    "perCallUs": 76.33796687499998,
    "calls": 200000
  },
  "threat": [
    {
      "name": "活三（3 手胜）",
      "expected": "有杀（3 手）",
      "found": true,
      "plies": 3,
      "nodes": 4,
      "elapsedMs": 1,
      "mismatch": false
    },
    {
      "name": "已成四（1 手胜）",
      "expected": "有杀（1 手）",
      "found": true,
      "plies": 1,
      "nodes": 1,
      "elapsedMs": 0,
      "mismatch": false
    },
    {
      "name": "有活三但被反先（无杀）",
      "expected": "无杀",
      "found": false,
      "plies": 0,
      "nodes": 1,
      "elapsedMs": 1,
      "mismatch": false
    },
    {
      "name": "散子安静局面（无杀）",
      "expected": "无杀",
      "found": false,
      "plies": 0,
      "nodes": 1,
      "elapsedMs": 0,
      "mismatch": false
    }
  ],
  "vct": [
    {
      "name": "孤立活三",
      "vcfFound": true,
      "vcfPlies": 3,
      "vcfMs": 0.6520839999866439,
      "vctFound": true,
      "vctPlies": 3,
      "vctMs": 24.508874999999534,
      "ratio": 37.585456782410745,
      "gains": false
    },
    {
      "name": "两条活三",
      "vcfFound": true,
      "vcfPlies": 7,
      "vcfMs": 1.744250000003376,
      "vctFound": true,
      "vctPlies": 11,
      "vctMs": 81.65524999999616,
      "ratio": 46.81396015470151,
      "gains": false
    },
    {
      "name": "活三 + 远处活二",
      "vcfFound": true,
      "vcfPlies": 3,
      "vcfMs": 1.0122080000001006,
      "vctFound": true,
      "vctPlies": 3,
      "vctMs": 526.3923329999961,
      "ratio": 520.0436402398952,
      "gains": false
    }
  ],
  "analysis": {
    "fastUs": 1.7821875000002119,
    "pointUs": 5.975244318182046,
    "ratio": 3.352758516251144,
    "suggestionsMs": 0.5338897900000302,
    "points": 44
  }
} 与  的四张表逐项对照，全部一致或已显式说明差异。
- **不改**： 本身、任何源码、任何既有数字。**「要不要把产物文件从 git 里摘出去」列入批次 5 待授权。**
- **风险**：零（纯文档）。

---

## 批次 1 · 零行为变更的机械对齐

每一条都只做「换成已有的等价东西」或「删掉没有作用的中间层」，**输出逐位不变**。

| ID | 位置 | 改法 | 保护测试 |
| --- | --- | --- | --- |
| **B1-1**（F-04） | `src/learn/verify.ts:38` | `{ x: i % 15, y: Math.floor(i / 15) }` → `pointFromIdx(i)`（`src/core/board.ts:16`） | 已有的 `verify.test.ts:291-319`（`boardHasFive` 四方向 + 全盘扫描）**逐条锁住了行为**；改完必须全绿 |
| **B1-2**（F-05） | `src/persist/gameRecords.ts:72` | `resignedBy === BLACK ? WHITE : BLACK` → `opponentOf(resignedBy)` | `gameRecords.test.ts`（260 行）里有 `deriveWinner` 的用例；另外 `e2e/review.spec.ts:37` 会断言「黑方胜」文案 |
| **B1-3**（F-06） | `src/features/review/ReviewScreen.tsx:112-113` | 删掉局部 `budgetMs = 400`，改用 `ANALYSIS_BUDGET_MS`；`difficulty` 加注释说明为什么固定 `'easy'` | `review.test.tsx` 里断言「400ms」的用例；`e2e/review.spec.ts:104` 断言面板出现「400ms」 |
| **B1-4**（F-07） | `src/store/analysisStore.ts:179-182` | 那 4 行 → `pending.delete(index)` | `analysisStore.test.ts`（351 行）覆盖排队/串行/取消/缓存；**这是本批里风险最高的一条**（`pending` 是管线的核心状态），改完要跑全文件 |
| **B1-5**（F-08） | `src/store/analysisStore.ts:203-205`（定义）；调用点在 **`:184`、`:247`、`:338`**（共 3 处） | 删掉 `patch()`，3 处调用点直接用 `set()` | 同上 |
| **B1-6**（F-09） | `src/store/analysisStore.ts:51` | 把 `import { replay } from '../core/game'` 移到文件顶部与其余 import 合并 | `yarn typecheck` + 全文件测试 |
| **B1-7**（F-10） | `src/store/gameStore.ts:217-242` | 只重排缩进，不改任何 token | 无（纯格式）；`yarn lint` + `yarn typecheck` + 全文件测试 |

### 自我保护措施

- **B1-4 与 B1-5 一起做、单独提交**：它们都动 `analysisStore` 的写入路径，合起来改完只需跑一次全文件测试。
- **B1-7 单独提交**：它涉及 26 行，混进别的改动会让 diff 无法逐行核对「是不是只改了缩进」。改完用 `git diff -w`（忽略空白）确认输出为空。

---

## 批次 2 · 补测试，锁定既有行为

**这一批不改任何生产代码。** 目标是把 `TEST_GAPS.md` §5.1 里「只有出错时才走、而唯一价值就是出错时」的路径钉住。

| ID | 覆盖对象 | 测试写法 | 为什么先做 |
| --- | --- | --- | --- |
| **B2-1** | `src/store/gameStore.ts:415-421` AI 返回**非法着法** → `aiError: 'AI 返回了不合法的着法，已忽略'`，**棋局不变** | 用现成的 `FakeEngine`（`gameStore.test.ts:36-106`）直接兑现一个已占用的坐标 | 这是「引擎出错不能让对局卡死」这条约定的**最后一段**，今天零覆盖 |
| **B2-2** | `src/ai/engine.ts:58` `handleError('')` → `'AI 引擎异常'` | `engine.test.ts` 里加一条传空串 | `browserEngine.ts:21` 传的正是 `event.message`，而它在跨源/加载失败时**就是空串** |
| **B2-3** | `src/features/review/GameLibrary.tsx:35-37` `storage.list()` reject → `setRecords([])` | 注入一个 `list()` 会 reject 的假 `GameRecordsStorage` | 现有 `review.test.tsx` 全部注入 `memoryGameRecords()`，它的 `list()` 恒 resolve |
| **B2-4** | `src/store/analysisStore.ts:92-101` 满盘无棋可走 → 跳过末手并 `total -= 1`，**面板不停在 N-1 / N** | 构造一条满盘和棋的 `GameRecord` | 这条路径与界面文案耦合（`ReviewScreen.tsx:144,149`），却只有组合用例间接经过 |
| **B2-5** | `src/store/useGameStore.ts:35-51` `bootstrapStore()` 的自动存档订阅 | fake timers + 断言 `localStorage` 内容与手顺一致 | 全仓零引用；e2e 只覆盖了「恢复」，没覆盖「自动写入」 |

**注意 B2-5**：`bootstrapStore` 订阅的是模块级单例 `useGameStore`。测试需要 imports 到 `useGameStore` 与假 localStorage，并在结束时退订（把 `subscribe` 返回的 unsubscribe 存下来）。**必须避免污染其它用例**——`gameStore.test.ts` 已经证明「直接改单例」是可行但需要小心（`TEST_GAPS.md` §4.4）。

---

## 批次 3 · P2 修复

### B3-1 · `gameRecords` 的事务口径与 `progress.ts` 对齐（F-03）

**目标行为**：`persisted: true` 只在**事务提交成功**时返回。事务 abort / error 时走内存兜底并返回 `persisted: false`。

**改法**（`src/persist/gameRecords.ts:252-274`）：

```ts
// 现在
request.onsuccess = () => { db.close(); resolve(request.result) }
request.onerror   = () => { db.close(); reject(new Error('棋谱库读写失败')) }

// 改成（与 progress.ts:154-170 同一口径）
// 1. request.onsuccess 只记住 result，不 resolve
// 2. tx.oncomplete 才 resolve；tx.onerror / tx.onabort 都 reject
// 3. db.close() 放在事务结束后（resolve/reject 之前）
```

**保护测试（先写，且必须先红）**：注入一个**手写的假 `IDBFactory`**，它的 transaction 在 `request.onsuccess` 之后触发 `onabort`。断言：
- 改之前：`put()` 返回 `persisted: true`（**这就是缺陷**）；
- 改之后：`put()` 返回 `persisted: false`，且 `useGameStore` 的 `onGameEnd` 会抛错 → 界面显示「没能保存这局」。

**回归面**：`list()` / `get()` / `delete()` 也走 `withStore`。改完必跑 `src/persist/gameRecords.test.ts`（260 行）+ `src/store/gameStore.test.ts` 的入库用例 + `yarn e2e`（`review.spec.ts` 三条涉及 IndexedDB）。

**风险**：低—中。**这是本计划里唯一动持久化写入路径的改动。**

### B3-2 · `settingsStore` 的 `persist` 加**校验**（F-12）

> **本节在独立终审后重写过。** 初稿的方案（「加 `version: 1` + 一个 `merge`」）有**两处硬伤**，终审逐条指出并已被我核实：
> 1. **加 `version` 而不给 `migrate` 会让所有现有用户的设置被重置。** zustand 的 `persist` 在版本不匹配且无 `migrate` 时走 `console.error` 分支**并丢弃整份持久化状态**（`node_modules/zustand/esm/middleware.mjs:392-409`：该分支没有 `return`，落到 `return [false, void 0]`，于是 `migratedState === undefined`）。现有用户的 localStorage 里存的是 `version: 0`，一升到 1 就全部回落默认值——初稿写的「正常用户的设置不受影响」**不成立**。
> 2. **初稿设计的保护测试跑不出红灯。** 它预置 `version: 0` 的坏数据，而版本不匹配本身就会让断言变绿，**校验逻辑一行都没被走到**。这样的测试等于没测。

**目标行为**：localStorage 里形状不对的设置不再直接进 store。

**改法（修正后，最小且不触发上面的坑）**：**不加 `version`，只加 `merge`。**

```ts
persist(
  (set) => ({ ...默认值, setTheme, ... }),
  {
    name: 'gomoku-lab:settings',
    // 只加 merge：校验每一个字段，不合格的回落到默认值。
    // **故意不动 version**——版本不匹配会让 zustand 丢弃整份状态（见上），
    // 那是「改坏数据」而不是「修坏数据」。
    merge: (persisted, current) => ({
      ...current,
      ...sanitizeSettings(persisted),
    }),
  },
)
```

`sanitizeSettings` 用 `isThemePreference`（`src/lib/theme.ts:12`）校验 `theme`、对 `showCoords` / `soundEnabled` 做 `typeof === 'boolean'` 校验，不合法的字段不写进结果。

**顺带的好处**：`isThemePreference` 从**死导出**（生产零引用、零测试）变成真正被使用。

**保护测试（必须先红）**：预置 **`version` 与当前一致（即 `0`）**、但字段值坏掉的 localStorage：

```ts
localStorage.setItem('gomoku-lab:settings',
  JSON.stringify({ state: { theme: 'foo', showCoords: 'yes', soundEnabled: true }, version: 0 }))
```
断言 store 拿到的是 `theme: 'system'`、`showCoords: true`（默认值）而不是 `'foo'` / `'yes'`。
**确认红灯的关键**：这个用例在改之前必须**失败**（因为 `merge` 还没加，坏值会直接进 store）。改之前先跑一次，看到红再动手。

**行为变更声明**：这一条**改变行为**——今天 `theme: "foo"` 会进 store（表现为主题按钮 title 出现 `undefined`），改后回落成 `system`。变更**只影响损坏数据这一条路径**；`version` 不变，所以任何现有用户的正常设置都不会被重置。**理由**：今天的表现是 bug，不是特性。**不列入批次 5。**

---

## 批次 4 · 无障碍：`Modal` 的焦点管理（F-02）

**目标行为**
1. `Tab` / `Shift+Tab` 在弹窗内循环，不逃到 `aria-modal="true"` 声明为惰性的背景内容上。
2. 关闭时把焦点还给**打开弹窗时持有焦点的那个元素**。

**改法**（`src/components/ui/Modal.tsx:14-27`）：在现有的 `useEffect` 里
- 打开时记录 `document.activeElement`；
- `keydown` 里除 `Escape` 外处理 `Tab`：查弹窗内可聚焦元素，首尾回环；
- cleanup 里 `(previouslyFocused as HTMLElement | null)?.focus()`。

**保护测试**
- 单测（`Modal` 目前无独立测试文件）：Escape 调 `onClose`；打开时焦点进弹窗；关闭后焦点回到原处。
- **Playwright**（必须）：终局弹窗弹出后连按 Tab，断言焦点始终在弹窗内；按 Escape 后断言焦点回到触发元素。**jsdom 不做真实的 Tab 顺序**，这条只能在真实浏览器里验——与 `AGENTS.md:31` 的要求一致。

**风险**：低。但 `Modal` 被 `ResultDialog` 唯一使用，而 `ResultDialog` 在 `BattleScreen` 的渲染路径上，**改完必须跑全量 `yarn e2e`**。

---

## 批次 5 · 待用户授权（**本计划不执行**）

| ID | 事项 | 为什么需要授权 |
| --- | --- | --- |
| **B5-1**（F-01） | 本地双人模式的「认输」应该认谁 | **这是产品决策，不是 bug 修复。** 现状是认 `humanColor`（在 pvp 下不可见、是上一次人机模式的残留）。三种合理设计：①认 `game.current`（轮到谁走谁认输）；②拆成「黑方认输 / 白方认输」两个按钮；③弹窗选人。选哪个取决于本地双人的实际使用场景，我没有依据替你定 |
| **B5-2**（F-16） | 在 `.oxlintrc.json` 里开启 `react-hooks/exhaustive-deps` | **会改变「提交前五条全绿」的含义**，属于工程约定变更。而且项目有多处 ref / DOM 读取会被误报（`Board.tsx:156-169`），需要逐条判断而不是批量 disable。**建议单独一轮做**，不与其他改动混合 |
| **B5-3** | 引入 CI / 给基准设阈值 | 属于工程流程决策。当前验收方式是手工跑五条命令，`AGENTS.md:36-52` 写得很明确 |
| **B5-4** | 增量局面评估（`evaluate.ts` 的 O(整盘) 扫描） | 这是**棋力问题不是正确性问题**，且 `ROADMAP.md:153` 已经把它列为「长期待办」。改动会同时影响正确性与性能，且必须能用 `yarn bench` 复现结论——**远超本次审计的范围** |

**B5-4 特别说明**：它是仓库自己识别出的最大性能杠杆，也是「专家档深度上限从未达到」的根因。**但它不是架构腐化**——`evaluate.ts` 只有 185 行、职责单一、有独立测试。要做它需要的是**性能工程**（写基准、做增量、验证棋力不变），不是重构。

---

## 自审记录

按本项目固定做法，本计划先做 3 轮自审，再送独立终审。每轮只列**发现并改掉**的问题。

### 第 1 轮 · 逐条回查「这条真的成立吗」

| 发现 | 处置 |
| --- | --- |
| **F-13 是误报。** `MoveList.buildRows` 的 `Math.floor(index/2)+1` 与 `moverAt(index, firstPlayer)` 在 `firstPlayer` 为 1 **或** 2 时都对——一「回合」永远是相邻两个索引，与谁先手无关。我用了独立脚本（`/tmp/check-movelist.mjs`）实跑两种先手方确认 | **撤回 F-13**，在 `FINDINGS.md` 里划掉原文并写明误报原因。同时**从批次 1 里删掉 B1-8** |
| 批次 1 原本还列了一条「`analysisStore.ts` 的 `record`/`engine` 在 `stop()` 后不释放」（F-22） | **移出批次 1**。它需要给 `stop()` 加清理，是**行为变更**（虽然无观测差异），不符合批次 1「输出逐位不变」的自定标准，降级为不处理 |
| 批次 3 原本把 B3-2（settings 校验）标成「零行为变更」 | **改正**。它**确实改变行为**（损坏数据从「进 store」变成「回落默认值」）。已在条目里显式声明 |

### 第 2 轮 · 逐条追问「改了会不会把别的东西弄坏」

| 发现 | 处置 |
| --- | --- |
| B1-3 改 `ReviewScreen` 用 `ANALYSIS_BUDGET_MS` 之后，`analysisStore.ts:61` 的闭包初值就成了**唯一消费者**。而 `start()` 在 `:270-274` 无条件用调用方传入的 `budgetMs` 覆盖它——**修改后这个初值仍然是死值** | 保留 `ANALYSIS_BUDGET_MS` 作为「默认预算」的单一出处（`ReviewScreen` 的显示文案与传参都读它）。**同时确认：不删 `analysisStore.ts:61` 的初值**，因为 `start()` 的类型要求 `budgetMs` 必填、初值只是防御 |
| B1-2 把 `resignedBy === BLACK ? WHITE : BLACK` 换成 `opponentOf(resignedBy)` 后，`gameRecords.ts` 需要 import `opponentOf` | **已核对**：该文件第 2 行已经从 `../core/board` 导入 `inBounds`，加一个名字即可，不新增依赖边 |
| B1-1 把 `verify.ts:38` 换成 `pointFromIdx` 后，`boardHasFive` 的循环边界是 `i < board.length`（225），`pointFromIdx(224)` = `{x:14,y:14}` ✓ | 无需额外处理。**同时确认 `pointFromIdx` 从「生产零引用」变成「生产被引用」**，这会让 `ARCHITECTURE.md` 里「死导出」的统计变化——**改完必须同步更新该文档的 §2.2B** |
| B3-1 改动 `withStore` 会让 `list()` / `get()` 也变成「事务提交后才 resolve」。只读事务的 `oncomplete` 在 `onsuccess` 之后立即触发，**语义等价** | 确认。但要在计划里写明「三个方法都要走同一条路径」，避免实现时只改 `put` |
| B2-5 要测 `bootstrapStore`，而它订阅的是模块级单例 | **补一条约束**：测试必须在 `finally` 里调用 `subscribe` 返回的 unsubscribe，并且**不能**在断言前留下未清理的 localStorage key（用 `afterEach` 清 `gomoku-lab:session`） |
| B4 的 `Modal` 焦点还原依赖 `document.activeElement`。如果弹窗是**自动弹出**的（终局弹窗就是），打开时焦点可能在 `<body>` | **补充**：焦点还原要在 `activeElement` 是 `body`/`documentElement` 时**跳过**（还原到 body 没有意义，反而会把焦点从棋盘上拽走）。这条与 `Board.tsx:161-167` 的 `unclaimed` 判断是同一类问题，**实现时要用同一套判据** |

### 第 3 轮 · 逐条追问「这条不做会怎样」

| 发现 | 处置 |
| --- | --- |
| 批次 2 的 B2-1~B2-5 **全部是「只加测试、不改代码」**。如果测试写出来就绿，说明行为本来是对的——那这一批的价值只是**防退化**，不是修 bug | **明确写进批次 2 的目标**：「本批不声称修了任何缺陷，只声称把 5 条出错路径钉住了」。避免把「补了测试」说成「修了问题」 |
| 如果 B3-1 的保护测试**写出来就绿**（即假 `IDBFactory` 的 abort 也被当成功），说明我对 `withStore` 的读法有误 | **加一条硬门禁**：B3-1 必须先跑出**红灯**再改。红灯跑不出来就不改，并如实记录「未能复现，本条降级为静态风险，不修」 |
| 批次 1 的 7 条**全都不影响任何用户可见行为**。做它们唯一的收益是「后来者不会照着错的写法抄」 | 接受这个收益，但**明确优先级低于批次 2**：先钉住出错路径，再做卫生。**执行顺序调整为 0 → 2 → 1 → 3 → 4** |
| 我一度想把「补 5 条 e2e」也放进计划 | **否掉**。`TEST_GAPS.md` §5.4 已经判过：除了 `Modal` 之外，其余组件要么是纯展示、要么已被 e2e 从真实用户路径覆盖。**加 e2e 会让每次提交慢 1.5 分钟，换来的边际覆盖很低** |

**第 3 轮带来的最重要改动：执行顺序从「0→1→2→3→4」改成「0→2→1→3→4」。** 理由：批次 2 的 5 条测试同时也是批次 3 的**前置保护**——B3-1 要动持久化写入路径，而 B2-3 刚好把 `GameLibrary` 的失败降级钉住了。

---

## 独立终审记录

两轴并行、独立上下文，审查对象为本计划与全部审计文档。**两轴都查出了真问题**，逐条处置如下。

### 标准轴查出的 9 条（全部已处置）

| # | 终审指出 | 我的核实 | 处置 |
| --- | --- | --- | --- |
| 1 | `difficulty.ts:59,68,77` 引错（那是 `defense`） | grep 确认：`threatThrees` 在 **43/52/61/70/79**（五处，不是三处） | 已改 `FINDINGS.md` |
| 2 | `difficulty.ts:73` 不是 `depth: 8`（那是 `width: 14`） | 确认：`depth: 8` 在 **74**、`budgetMs` 在 75 | 已改 `FINDINGS.md` 与 `TECH_DEBT.md` |
| 3 | B1-5 的行号表 `:176` 是无关代码；F-08 的「4 处调用」应为 3 处 | 确认：调用点在 **184 / 247 / 338** | 已改本计划与 `FINDINGS.md` |
| 4 | F-15 的「全部 6 个调用点」只数了 `isWinningPoint` | 确认：`analyzeFast` 另有 6 处（含 `bench`）。**结论（无人传已占用的点）仍成立** | 已改成完整枚举 |
| 5 | `ARCHITECTURE.md` 的「非空断言 8 处」不实 | 确认：`src/` 非测试代码只有 **3 处**（`threat.ts:177`、`analysisStore.ts:213,311`）；`bench/` 另 5 处 | 已改 |
| 6 | **F-03 的两处机制描述夸大了**：①跨标签页只产生 `blocked`/`versionchange`，**不会**中止已在跑的事务；②`db.close()` 放在 success 回调里**无害**（规范：close() 只置 pending 标志，等事务全结束才真关） | 复核后**接受**。真正剩下的触发面只是「事务在 commit 阶段失败（典型是配额）」 | 已重写 F-03 的机制段，并在 `FINDINGS.md` 里显式标注这两处是订正 |
| 7 | **漏了一处真问题**：`notifyGameEnd` / `recordedSeq` 没有配对闸门 | 复核后**接受**，且终审给出的第二条复现路径（终局→刷新→悔棋→换手顺再终局）我独立推演成立 | 新增 **F-25** |
| 8 | `analysisStore.ts:237` 第三道闸门命中时不清 `inflightIndex` 也不 `pump()` | 复核成立（真实引擎下不可达，属防御性代码不一致） | 新增 **F-26** |
| 9 | `PracticeBoard` 的 `reported`/`attempt` 不复位，安全性靠调用方的 `key` | 复核成立 | 新增 **F-27** |

标准轴同时确认：`F-01`/`F-02`/`F-04`~`F-12`/`F-14`/`F-16`~`F-22` 的**行号全部准确**；`ARCHITECTURE.md` §3.1 的十二个行数**逐一精确匹配**；四条否定性结论（无环、无逆层、零 `vi.mock`/`skip`/`only`/`Math.random`/`any`/`ts-ignore`/`enum`）**复算属实**；**F-14 由终审独立推导了一遍递归，结论与我一致**。

标准轴还独立复核了 `REFACTOR_PLAN` 批次 1 的 7 条「零行为变更」（逐条判等价成立）、批次 2 的「只加测试」（成立），并**推翻了初稿的 B3-2**（见该节的订正说明）。

### 规格轴查出的 6 条（5 条已处置，1 条为流程项）

| # | 终审指出 | 处置 |
| --- | --- | --- |
| 1 | **e2e 用例数全部高报**（初稿 13/13/9/7/8/12/5 合计 67） | **确认是错的，且根因是方法问题**：我照抄了一份子代理报告，自己没有数。已用 `npx playwright test --list` 重数并重写 `TEST_GAPS.md` §2 的表：**`chrome` 30 + `mobile` 7 + `tablet` 7 = 44**（与实跑一致），`prod` 5 条另计 |
| 2 | 阶段 B 的「无用依赖」**完全没做** | 已补 `ARCHITECTURE.md` §2.3：**`@testing-library/user-event` 全仓零引用**（唯一真无用依赖）；`@testing-library/dom` 是 `@testing-library/react` v16 的对等依赖，保留并注明理由 |
| 3 | 阶段 D 的「依赖倒置」**完全没做** | 已补 `TECH_DEBT.md` D-3 的「依赖倒置」小节：注入点找得准，**真正的缺口只有 `persist/storage.ts` 未接口化**一处 |
| 4 | 「复杂分支」只有定性判断，无量化 | **部分接受**。已在 `BASELINE.md` §3 显式声明「未做圈复杂度量化，这一维置信度明显更低」——**不假装做了**（装 SonarQube 属于「为了通过审计擅自安装工具」） |
| 5 | 「工具的取舍说明」不足 | 已补 `BASELINE.md` §3 的取舍表：逐项写明「常规工具 → 本轮替代做法 → 置信度差异」，包括 `jscpd` 与 `SonarQube` **没做**这件事 |
| 6 | `ARCHITECTURE.md` §4.2 有一句坏句（两侧括号内容相同） | 已改写成有意义的对照 |
| 7 | 十维评分 / top-10 风险 / 完成条件 7 **缺失** | 十维评分与 top-10 已在终审期间补进 `FINDINGS.md` §7/§8；**完成条件 7（已完成修复及验证）属 Phase F 的产出**，将在执行后回填到本文件与 `TEST_REPORT.md` |

规格轴也**确认了独立验证不是同源验证**：`/tmp/gomoku-audit/ref.ts` 零 import 项目代码，`b-ai.test.ts` 的期望值取自参考实现而非项目函数；并确认 `FINDINGS.md` §5.7 对「未覆盖的算法部分」的声明是**如实**的（`negamax` 剪枝语义、`evaluateBoard` 数值语义、`MAX_THREE_LAYERS` 漏杀范围都没验，且都写明了）。

### 两条终审带来的方法结论

1. **两轴都查出了单轴查不出的东西**：标准轴抓到 5 处行号错误 + 1 处真漏（F-25）+ 推翻了一个批次方案；规格轴抓到 2 处整节缺失 + 1 处**数据高报**。**只跑一轴会漏掉一半。**
2. **规格轴抓到的那条数据高报，根因是我照抄了子代理的数字。** 这条纪律写进本计划的执行要求：**任何进入交付物的量化结论，必须由我自己跑命令数一遍**，子代理的报告只当线索。


---

## 执行记录（Phase F · 已完成）

**执行顺序按自审第 3 轮定的：0 → 2 → 1 → 3 → 4。全部完成，批次 5 未动。**

### 逐批结果

| 批次 | 改动文件 | 新增/修改测试 | 反向验证（撤掉修复确认变红） |
| --- | --- | --- | --- |
| **0 · 文档** | `docs/ROADMAP.md`、`docs/AI_ENGINE.md` | — | — |
| **2 · 补测试** | 无生产代码改动 | `gameStore.test.ts` +2、`engine.test.ts` +1、`review.test.tsx` +1、**新增** `bootstrapStore.test.ts`（3） | ✅ 4 处修复全撤掉 → **6 条用例全红** |
| **1 · 机械对齐** | `learn/verify.ts`、`persist/gameRecords.ts`、`features/review/ReviewScreen.tsx`、`store/analysisStore.ts`、`store/gameStore.ts` | 无 | `git diff -w` 对 B1-7 输出为空（确认只动了空白） |
| **3 · P2 修复** | `persist/gameRecords.ts`（事务口径）、`store/settingsStore.ts`（加 `merge`） | `gameRecords.test.ts` +2、`settingsStore.test.ts` +3 | ✅ 两条都在**改之前跑出红灯**（见下） |
| **4 · Modal** | `components/ui/Modal.tsx` | **新增** `Modal.test.tsx`（6）、`e2e/a11y.spec.ts` +1 | ✅ 撤掉圈闭 → 单测 3 条 + e2e 1 条全红 |

### 五条命令（全部在改动后的工作区上实跑）

| 命令 | 结果 |
| --- | --- |
| `yarn lint` | ✅ 0 告警 |
| `yarn typecheck` | ✅ |
| `yarn test` | ✅ **45 个文件 / 785 个用例**（基线 43 / 767 → **+2 文件 +18 用例**） |
| `yarn build` | ✅ 341 ms / 182 ms |
| `yarn e2e` | ✅ **45 条通过**（1.4 min）。chrome 31 + mobile 7 + tablet 7 |

### e2e 的两条 flaky 与一次实证

最终冻结状态上 `yarn e2e` = **45 passed**。过程中有一条值得记下来的观察：

中途有一次在**高负载**下跑（机器上同时有 48 个 playwright 进程，我还在并行跑诊断用例与文档编辑），`tablet.spec.ts` 的两条失败：

```
✘ 平板竖屏（768×1024） › 退化为纵向堆叠，棋盘仍完整可见
✘ 触屏命中与误触 › 快速连点同一交叉点两次只落一子
```

**单独复跑这 7 条 tablet 用例 → 全过**；清掉我自己留下的孤儿浏览器与 vite 实例后重跑全量 → **45 passed**。
所以这两条是**负载导致的 flaky**，不是我改坏的。

**这是 `F-18` 的第一次实测证据。** 审计时那条只是「读代码预判的风险」（`battle.spec.ts:212` 的 `waitForTimeout(3500)`、`a11y.spec.ts:97-100` 靠 2600 ms 预算的竞态窗口），现在有了真实的失败样本。它没有改变 F-18 的优先级，但把它从「推测」变成了「已观察」。

### 两条修复的红灯记录（这是它们「有独立证据」的凭据）

**B3-1（事务口径）** —— 改之前先写保护测试，跑出：
```
× 请求成功但事务被中止时，如实报成没落库
× 同一情形下 saveGameReplacing 也不假装成功
AssertionError: expected true to be false
```
**这条把 F-03 从「静态风险」升级成了「已证实缺陷」**——原来它在人工构造的「请求成功、事务随后中止」下**确实**会报 `persisted: true`。审计初稿只把它列为静态风险，是因为当时没有可确定复现的构造。

**B3-2（设置校验）** —— 改之前：
```
× 版本相同但字段值非法时，逐字段回落到默认值
AssertionError: expected 'foo' to be 'system'
```

### 批次 4 的一处「加了又撤」——如实记录

按计划给 `Modal` 加了**焦点还原**（关闭时把焦点还给打开前的元素）。加完之后在真实 Chrome 里量了一遍：

```
[diag] Escape 关闭后 activeElement = BODY      （五连终局路径）
[diag] 认输弹窗关闭后 activeElement = BODY      （认输路径）
[diag] 认输按钮 disabled? = true
```

**两条路径都还原不成功**，因为「打开前持有焦点的元素」在对局结束时必然变得不可聚焦：
五连终局时那一格 `<rect>` 因整盘 `interactive` 变假而失去 `tabindex`；认输终局时按钮已 `disabled`。

**处置：把那段代码撤掉了。** 它在本应用里永远不会生效、也无法被验证——留着就是「用没验证的复杂度制造虚假质量」。
底层问题（关掉弹窗后焦点落回 `<body>`，键盘用户要从头 Tab）是真的，记为 **F-28**，修复需要先决定「关掉之后焦点该落到哪」，列入批次 5。

**保留了的部分**：`Tab` / `Shift+Tab` 的**焦点圈闭**。它才是 `aria-modal="true"` 真正承诺的东西，而且两条路径下都可验证（单测 3 条 + e2e 1 条，撤掉即红）。

### 与计划的偏差（3 处，全部如实记录）

| 偏差 | 原因 |
| --- | --- |
| 批次 2 从 5 条减为 4 条 | **B2-4（满盘跳过末手）已有直接用例**（`analysisStore.test.ts:325`）。我在 `TEST_GAPS.md` 里报「零覆盖」是**误报**，已划掉并写明原因（没有先扫一遍已存在的 describe 名称） |
| 批次 4 少做了「焦点还原」 | 见上。实测无效 → 撤掉，改为记录 F-28 |
| 批次 3 的 B3-2 方案与初稿不同 | 初稿的「加 `version: 1`」被独立终审推翻（会让所有现有用户设置重置），改成就加 `merge` |

### 修复前后对照

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| 单测文件 / 用例 | 43 / 767 | **45 / 785** |
| e2e 用例 | 44 | **45** |
| 生产代码改动行数 | — | 5 个文件、净增约 60 行（含注释）、净删约 20 行 |
| 依赖图 | 无环、无逆层 | **不变**（未新增任何依赖边；`pointFromIdx` 与 `opponentOf` 都是从既有模块引入） |
| 公开行为变化 | — | 只有两处，且都在**异常路径**：①棋谱事务中止时如实报「没能保存」（原来会谎报「已存入」）；②localStorage 里的坏设置回落到默认值（原来会带着 `undefined` 文案进 store） |
| 游戏行为变化 | — | **零**。棋盘、规则、AI、教学、复盘的对局行为一行未动 |

### 剩余事项

- **批次 5 全部未动**（4 项，见下节）——需要用户授权
- ✅ 文档计数已同步：`docs/TEST_REPORT.md`（767→785 / 43→45；e2e 44→45）、`README.md`、`docs/ROADMAP.md`（加了「全仓工程审计」一节）

### 一处**无法归属**的工作区改动，如实报告

`bench/last-run.json` 在工作区里是**已修改**状态（`git status` 显示 ` M`），内容是一次基准复跑的结果（`search` 判定的 12 行 depth/nodes 与入库版本**完全一致**，只有 `elapsedMs` 与 `timeout` 行变了）。

**我没有跑过 `yarn bench`**（审计从一开始就决定「本轮没有需要新性能数字的结论」，`BASELINE.md` §4 写明了）。修改时间是 `12:48:11`，落在我这一轮的某个区间内，但我无法把它归到任何一条我执行的命令上——可能是同机其它会话，也可能是某个我没意识到的触发。

**处置：没有动它。** 理由：它是个可再生的产物文件，恢复它有可能覆盖别人的工作；而它是否该被 git 跟踪本身就是批次 5 里待决的一项（F-24 方案 C）。
**顺带说明**：这次意外**恰好现场演示了 F-24 的机制**——产物文件被任何一次复跑覆盖，而文档表格不会跟着变。
