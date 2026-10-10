# 架构

## 分层

```
components / features   ← 展示层，只做渲染与事件转发
        ↓
      store             ← Zustand：对局状态、设置、AI 请求编排
        ↓
   ai  →  core          ← 引擎与纯规则
        ↓
     browser APIs       ← Worker / localStorage / WebAudio（只在这三处出现）
```

**依赖方向严格单向**：`components → features → store → ai/core`，`ai → core`。`core` 不依赖任何其他层，也不碰 React、DOM、时间与随机数。这条约束让规则与引擎可以脱离浏览器直接单测。

## 各层职责

**`core/`** —— 纯逻辑。
`types.ts` 常量与类型；`board.ts` 索引换算、边界、读格；`rules.ts` 胜负判定与落子合法性；`game.ts` 对局状态机。全部是不可变纯函数。

**`ai/`** —— 引擎。
`patterns.ts` 单点棋型分析（窗口枚举，含隔子型）；`evaluate.ts` 整盘线段评估；`candidates.ts` 候选点生成；`difficulty.ts` 五档参数表；`transposition.ts` Zobrist 置换表；`threat.ts` 算杀搜索（VCF / VCT）；`search.ts` 搜索主体。`worker.ts` 是 Worker 外壳，`engine.ts` 是主线程侧的请求分发，`browserEngine.ts` 负责把两者接起来。

`search.ts` 内部分成两层，这个分工是刻意的：

- `chooseMove(request)` 是**协议层**——把难度换算成搜索选项、负责 `elapsedMs` 计时。
- `searchBoard(board, player, options, now)` 是**主体层**——不读时钟（`now` 注入）、不改传入的棋盘。

分开是为了可测：注入时钟让超时行为可以确定性复现，不必依赖真实时间，也不会因机器快慢而 flaky。

`threat.ts` 与 `searchBoard` 同样遵守「不改传入的棋盘」这条硬约定（内部先 `slice()` 一份）。

**`bench/`** —— 不与任何层耦合的一次性脚本，跑基准数字（`yarn bench`，独立于 `yarn test`）。

**`store/`** —— 状态编排。
`gameStore.ts` 是对局与 AI 请求的状态机（工厂函数 `createGameStore(engine)`，可注入假引擎测试）；`useGameStore.ts` 组装真实引擎与存档，是应用唯一的单例入口；`settingsStore.ts` 是主题、坐标、音效等偏好。

**`persist/`** —— 存档。
`storage.ts` 负责序列化与**结构校验**。任何一处不符合预期都返回 `null`，宁可当作没有存档重开一局，也不把损坏数据灌进状态机。

**`lib/`** —— 无状态工具：主题解析、WebAudio 音效合成、坐标格式化、类名拼接。

**`components/`** —— 展示。
`ui/` 是与业务无关的原子组件；`board/` 是棋盘；`panels/` 是业务面板。面板全部通过 props 接收数据与回调，不直接读 store。

**`features/`** —— 容器。`battle/` 负责把 store 与面板接起来，并承载 `status.ts` 这类纯推导逻辑。

## 关键数据流

```
点击交叉点
   ↓
Board.onPlay(point)
   ↓
GameStore.playHuman → core.applyMove → 新 GameState（version + 1）
   ↓
轮到 AI 时 requestAiMove：分配 requestId，记下当前 gameVersion
   ↓
AiEngine.search → postMessage → Worker.chooseMove（主线程不受影响）
   ↓
postMessage 回来 → engine 按 requestId 找到挂起的 promise
   ↓
GameStore.applyAiResponse：校验 requestId 与 gameVersion，两者都对上才落子
```

```
请求提示（与落子互不挤占）
   ↓
HintPanel.onAsk → GameStore.requestHint（purpose: 'hint'，固定 800 ms 短预算）
   ↓
AiEngine.search → Worker.chooseMove（走同一条引擎、同一套过期校验）
   ↓
GameStore.applyHintResponse：只写 hint / hintUrgency，**不调用 applyMove**
   ↓
Board.hints → 棋盘上按推荐顺序画编号 1/2/3 的标记
```

## 并发的五处关键约定

**过期响应必须丢弃。** 每个 AI 请求带 `requestId`（只增不减，跨对局也不重复）与 `gameVersion`（发起时的局面版本）。响应回来时两道闸门都要过：`requestId` 必须是当前在飞的那一个，`gameVersion` 必须等于当前棋局版本。悔棋、重新开始、切换执子都会把 `pendingRequestId` 置空，于是所有在飞的旧响应全部作废。这个判断位于 store 的纯函数 action 中，可以脱离浏览器直接单测。

**玩家点击必须被正确忽略。** `playHuman` 在三种情况下直接返回：对局已结束、不是玩家的回合、AI 正在思考。加上棋盘组件的 `interactive` 控制，不会出现同色连下两手或卡在「AI 思考中」。

**引擎失败不能让对局卡死。** Worker 报错时挂起的请求以错误结束，store 把 `aiThinking` 复位、记下错误，并**不动棋局**。AI 面板随即显示错误；只要还轮到 AI 走，面板就会给出「重试」入口，点击即用同一个局面重新发起请求。

这里不能省掉重试：如果只给一句「知道了」，AI 欠着的那一手永远补不上（`playHuman` 被 `canHumanPlay` 挡住），玩家执白时更是连悔棋都没有（盘上只有 AI 的着手，`canUndo` 为假），只剩重开或认输两条路。

**存档必须能还原「结果」。** 手顺能还原出胜负与和棋——最后一手就在手顺里。唯独认输还原不出来，所以 `PersistedSession` 单独存一个 `resignedBy`（由 `winner` 反推）。少了它，认输后刷新页面会让这局复活成进行中，AI 还会接着往下走。

**提示请求与落子请求必须彻底隔离。** 两者走同一条引擎、同一套过期校验，但分别记在 `pendingHintRequestId` 与 `pendingRequestId` 上，**互不挤占**：提示在飞时玩家照常落子，反之亦然。（请求号仍来自同一个只增不减的计数器——分成两个计数器迟早会撞号，撞号意味着迟到的提示响应会去兑现落子请求。）

隔离的目的是**提示绝不能改变棋局**。三条硬约束：

1. `applyHintResponse` 里**没有 `applyMove`**。引擎返回的提示响应其实带得有着法（`chooseMove` 不区分用途），所以「提示被误当成落子处理」这类错误会直接在棋盘上留下棋子——`gameStore.test.ts` 里那条测试特意用带真实着法的响应来钉住这一点，而不是靠 `move === null` 顺手挡掉。
2. 提示用固定的短预算（`HINT_BUDGET_MS = 800`）单独算一遍，不占 AI 正式走子的预算。
3. 局面一变（落子 / 悔棋 / 重开 / 认输 / 恢复存档）就整体清空提示。高亮必须跟着局面失效，否则玩家会对着一个已经不存在的局面做决定。玩家落子时 `pendingHintRequestId` 一并清空，于是在飞的提示响应回来时自然对不上号，被丢弃。

`Board` 还有一层兜底：渲染提示标记时会跳过**已占用**的交叉点。提示是按旧局面算的，算完之后局面可能已经变了，这条兜底放在渲染层，调用方就不必自己保证一致性。

## 棋盘渲染

整张棋盘是一张 SVG，`viewBox` 覆盖棋盘本体加一圈留白。交叉点在 SVG 用户坐标里就是整数 `(x, y)`，不需要任何百分比换算，坐标标签、星位、棋子、连线全部共用同一套坐标。

棋子用径向渐变加一枚椭圆高光，配一个偏移的暗色圆作假投影——比 `filter: drop-shadow` 便宜得多，棋子多了也不会掉帧。

**命中区是按格铺开的正方形**，边长一整格，相邻格子严丝合缝。用圆形热区会在相邻交叉点之间留下死区。这里有个容易踩的坑：`pointer-events: all` 的命中范围是「内部 + 周界」，而未指定 `stroke` 时 `stroke-width` 的初始值是 1，每个格子会向外多出半格，导致点在交叉点正中反而落到右下相邻那一格——所以必须同时把 `strokeWidth` 置 0。

**自适应尺寸**用 CSS 容器查询：容器声明 `container-type: size`，棋盘取 `width: min(100cqw, 100cqh)` 配 `aspect-ratio: 1`，即「能容纳的最大正方形」，不需要 JS 测量。

## 主题

浅色与深色两套 CSS 变量分别挂在 `:root` 与 `.dark` 上，经 Tailwind v4 的 `@theme inline` 暴露成语义色（`bg-surface`、`text-muted`、`border-border`）。组件里不写 `dark:` 前缀，切主题只改 `<html>` 上的一个类。棋盘木纹、棋子渐变同样走 CSS 变量，所以两套主题共用同一份 SVG。

## 测试策略

| 层 | 工具 | 覆盖重点 |
| --- | --- | --- |
| `core` | Vitest | 五连全方向、边缘、长连、重复落子、终局后落子、满盘和棋、悔棋 |
| `ai` | Vitest | 立即取胜、必防对手、活三应对、候选生成、超时回退、评估函数单调性、棋型识别（含隔子型）、置换表与注入时钟、算杀不误报、自对弈可复现 |
| `store` | Vitest | 过期响应丢弃、人机悔棋撤销一轮、终局拒收落子、存档恢复后续走、提示请求不落子且互不挤占 |
| `persist` | Vitest | 序列化往返、各类损坏数据的降级 |
| `components` | Vitest + Testing Library | 225 个交叉点、点击落子、终局禁点、最后一步与胜利标记、坐标开关、提示标记的编号与跳过已占用点 |
| 端到端 | Playwright（本机 Chrome） | 完整对局流、命中位置正确性、悔棋、重开、刷新恢复、认输、提示标记的出现与消失 |

`core` 与 `ai` 的测试全部针对纯函数，不 mock 任何东西。`store` 的测试注入一个可以精确控制应答时机的假引擎，用来构造各种「响应迟到」的时序。
