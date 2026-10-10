# Gomoku Lab Phase 3 实施计划：互动教学与残局挑战

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Gomoku Lab 从「一个能下棋的引擎」变成「一个能教会人下棋的产品」——8 节可交互的课程 + 15 道答案经搜索验证的残局题。

**Architecture:** 内容与判定彻底分离。内容（`learn/lessons.ts`、`learn/puzzles.ts`）只声明局面与**目标谓词**，判定（`learn/verify.ts`）用引擎自己的棋型分析与算杀去证明这一手是否达成目标。答案不写坐标，因此天然支持多解，也天然无法写错——一道题是否可解由一条跨全部内容的测试跑出来。

**Tech Stack:** 沿用 Phase 1/2 全部技术栈（React 19 / TS 6 / Vite 8 / Tailwind 4 / Zustand 5 / Vitest 5 / Playwright）。**新增一个开发依赖** `fake-indexeddb`，用来在 jsdom 里测试 IndexedDB 存取——不引入的话，整个进度存储层就是一片没有测试覆盖的代码。

**Spec:** `docs/ROADMAP.md` 的「Phase 3 · 教学与残局」一节，加上用户最初的原始需求（离线、无后端、界面精致、不得用占位内容冒充功能）。

---

## 全局约束

- **完全离线**：无后端、无账号、无云 DB、无第三方 LLM API。课程内容与题库全部是仓库里的静态数据。
- **不使用 `enum`**（`erasableSyntaxOnly`），一律 `as const` + 联合类型；类型导入用 `import type`（`verbatimModuleSyntax`）。
- **`core` 与 `ai` 的算法部分不得引入 React / DOM / Zustand / localStorage / Worker。** `learn/` 是新层：它的**判定与求解**部分（`verify.ts`、`hints.ts`）只允许依赖 `core` 与 `ai`，必须是能脱离浏览器直接单测的纯逻辑；**内容数据**（`lessons.ts`、`puzzles.ts`）同理。`learn/` 不得反向被 `ai`/`core` 依赖。
- **界面文案一律简体中文。包管理器固定 yarn。**
- **提交前五条全绿**：`yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e`。
- **写进文档的每一个性能数字都必须来自 `yarn bench`**，不许估。
- **不许用占位内容冒充功能**：课程讲解、题目、提示、解法说明都必须是真写出来的内容，不许出现「TODO」「示例文本」。
- 文档同步（见 `AGENTS.md` 的表）：新增分层要更新 `ARCHITECTURE.md`，阶段进度更新 `ROADMAP.md`，测试结果更新 `TEST_REPORT.md`。

## Review Focus

规格隐含、但各任务自身的测试不会覆盖、且最容易伤到真实用户的情形。每一条都绑到具体任务上：

1. **题目无解或多解被误判** —— 一道题如果没有任何着法能满足目标，玩家会卡死在一个不可能完成的任务上；如果某个同样正确的着法被判错，玩家会被教错。第 6 节的「内容自检」逐个题目跑一遍求解器；第 2 节用**谓词判定**而不是坐标表，从机制上保证多解都通过。
2. **错误的着法必须给出人话解释** —— 只说「不对」等于没教。第 2 节要求每种目标都有专门的理由文案，第 7 节的 UI 测试逐条断言。
3. **进度存储不可用时不能白屏** —— 隐私模式、IndexedDB 被禁、配额满，都可能让存储层抛错。第 6 节要求全部降级为内存态且照常可用，第 8 节的测试在「IDB 打不开」的前提下断言学习流程仍然走得通。
4. **学习界面在窄屏上必须能操作** —— 学习页是新的一处棋盘实例，移动端的命中与滚动问题（Phase 1 踩过：命中区多出半格、拖动滚页面）会原样复现。第 11 节补移动端端到端用例。
5. **刷新后不能丢失进度，也不能回到一个错的位置** —— 做完的课、做对的题刷新后应当还在；停在一半的课程应当能回到原处而不是从第一页开始。第 7、8 节各有一条持久化用例，第 11 节有一条端到端。

---

## 文件结构

```
src/
├─ lib/
│  └─ board-lines.ts          字符画 ↔ 棋盘。内容与测试共用（从 src/test/ 上移）
├─ learn/                     新增：教学内容层（纯逻辑，不碰 React）
│  ├─ types.ts                课程 / 步骤 / 残局 / 目标的数据形状
│  ├─ verify.ts               判定这一手是否达成目标，并给出没达成的理由
│  ├─ hints.ts                求解 + 三级渐进提示（全部由引擎算出）
│  ├─ lessons.ts              8 节课的内容
│  └─ puzzles.ts              15 道残局题的内容
├─ persist/
│  └─ progress.ts             新增：学习进度（IndexedDB，带内存降级）
├─ store/
│  ├─ learnStore.ts           新增：进度状态与三个动作
│  └─ navStore.ts             新增：当前视图（对战 / 课程 / 残局）
├─ components/
│  ├─ board/BoardStage.tsx    新增：棋盘容器（三处界面共用）
│  └─ panels/FeedbackBanner.tsx  新增：答对 / 答错的反馈条
└─ features/
   ├─ learn/                  新增：课程列表 + 课程运行器
   └─ puzzles/                新增：残局列表 + 残局面板
```

**为什么 `learn/` 要独立成一层**：它的判定逻辑依赖 `ai`（棋型、算杀），但它的用途是教学，跟对局引擎是两件事。塞进 `ai/` 会让「引擎」这个包混进教学概念；塞进 `features/` 又会让它依赖不了 React 之外的纯逻辑约定。独立一层，依赖方向 `features → store → learn → ai → core`，单向。

---

## Task 1：内容基础设施

把三件小事一次做完：字符画解析上移到 `lib`、棋盘标记泛化、棋盘容器提取。它们都是后续任务的地基，单独任何一个都不值得开一个任务。

**Files:**
- Create: `src/lib/board-lines.ts`（从 `src/test/board-fixtures.ts` 迁移 `boardFromLines` / `linesFromBoard`）
- Modify: `src/test/board-fixtures.ts`（改为 re-export + 保留 `nearlyFullBoard`）
- Modify: `src/components/board/Board.tsx`（`hints?: readonly Point[]` → `marks?: readonly BoardMark[]`）
- Create: `src/components/board/BoardStage.tsx`
- Modify: `src/features/battle/BattleScreen.tsx`（用 `BoardStage`，把 `hints` 映射成 `marks`）
- Test: `src/components/board/Board.test.tsx`、`src/lib/board-lines.test.ts`

**Interfaces:**
- Consumes: `core/board` 的 `createBoard`/`idx`、`core/types` 的 `BOARD_SIZE`
- Produces:
  ```ts
  // lib/board-lines.ts
  export function parseBoardLines(rows: readonly string[]): Board   // 超界抛错，不静默截断
  export function formatBoardLines(board: Board): string[]

  // components/board/Board.tsx
  export type MarkTone = 'accent' | 'good' | 'bad'
  export interface BoardMark {
    readonly point: Point
    /** 标记上的文字。省略时按数组下标显示 1/2/3… */
    readonly label?: string
    readonly tone?: MarkTone
  }
  export interface BoardProps { /* …既有字段… */ marks?: readonly BoardMark[] }

  // components/board/BoardStage.tsx
  export function BoardStage(props: { children: ReactNode }): JSX.Element
  ```

- [ ] **Step 1：写 `lib/board-lines.ts` 的失败测试**

```ts
// src/lib/board-lines.test.ts
import { describe, expect, it } from 'vitest'
import { idx } from '../core/board'
import { BOARD_SIZE } from '../core/types'
import { formatBoardLines, parseBoardLines } from './board-lines'

describe('parseBoardLines', () => {
  it('B 是黑、W 是白、其余字符是空', () => {
    const board = parseBoardLines(['.B.', 'W..'])

    expect(board[idx(1, 0)]).toBe(1)
    expect(board[idx(0, 1)]).toBe(2)
    expect(board[idx(0, 0)]).toBe(0)
  })

  it('行数不足时按空补齐', () => {
    expect(parseBoardLines(['B'])).toHaveLength(BOARD_SIZE * BOARD_SIZE)
  })

  it('超过 15 行直接报错，不静默截断', () => {
    const rows = Array.from({ length: BOARD_SIZE + 1 }, () => '')

    expect(() => parseBoardLines(rows)).toThrow(/行/)
  })

  it('某一行超过 15 列直接报错', () => {
    expect(() => parseBoardLines(['.'.repeat(BOARD_SIZE + 1)])).toThrow(/列/)
  })
})

describe('formatBoardLines', () => {
  it('与 parseBoardLines 互为逆运算', () => {
    const lines = ['...B...', '..W....']

    expect(formatBoardLines(parseBoardLines(lines))).toEqual([
      '...B...' + '.'.repeat(BOARD_SIZE - 7),
      '..W....' + '.'.repeat(BOARD_SIZE - 7),
      ...Array.from({ length: BOARD_SIZE - 2 }, () => '.'.repeat(BOARD_SIZE)),
    ])
  })
})
```

- [ ] **Step 2：跑测试确认失败**

Run: `yarn vitest run src/lib/board-lines.test.ts`
Expected: FAIL——`Failed to resolve import "./board-lines"`

- [ ] **Step 3：把实现从 `src/test/board-fixtures.ts` 搬过去**

`src/lib/board-lines.ts` 的内容就是把 `boardFromLines` / `linesFromBoard` 原样搬过来并改名，**保留那两处越界校验**（测试数据写错一个点会整体错位，静默截断只会让断言在错误前提下通过）。`src/test/board-fixtures.ts` 改成：

```ts
export { formatBoardLines as linesFromBoard, parseBoardLines as boardFromLines } from '../lib/board-lines'
// …nearlyFullBoard 原样保留…
```

保留旧名是为了不动那十来个测试文件的 import——**这层转发是暂时的**，Task 4/5 写内容时统一用新名，后续谁改到哪个文件顺手把 import 换掉。

- [ ] **Step 4：跑测试确认通过，并跑全量确认没有回归**

Run: `yarn vitest run src/lib/board-lines.test.ts && yarn test`
Expected: 全绿

- [ ] **Step 5：写棋盘标记泛化的失败测试**

把 `Board.test.tsx` 的「提示标记」一节改名为「标记」，并补三条：

```tsx
it('自定义 label 会按原样显示，而不是序号', () => {
  setup({ marks: [{ point: { x: 7, y: 7 }, label: '两端' }] })

  expect(screen.getByTestId('board-mark-7-7')).toHaveTextContent('两端')
})

it('good / bad 色调与默认强调色区分开', () => {
  setup({
    marks: [
      { point: { x: 1, y: 1 }, tone: 'good' },
      { point: { x: 2, y: 2 }, tone: 'bad' },
      { point: { x: 3, y: 3 } },
    ],
  })

  expect(screen.getByTestId('board-mark-1-1')).toHaveAttribute('data-tone', 'good')
  expect(screen.getByTestId('board-mark-2-2')).toHaveAttribute('data-tone', 'bad')
  expect(screen.getByTestId('board-mark-3-3')).toHaveAttribute('data-tone', 'accent')
})

it('标记仍然跳过已占用的交叉点', () => {
  // …用只占 (7,7) 的局面，marks 给三个点，断言只剩两个…
})
```

- [ ] **Step 6：跑测试确认失败**

Run: `yarn vitest run src/components/board/Board.test.tsx`
Expected: FAIL——`marks` 不是已知属性 / 找不到 `board-mark-*`

- [ ] **Step 7：实现 `marks`**

把 `Board.tsx` 里 `hints` 那段渲染改成通用标记：`data-testid` 从 `hint-marker-x-y` 改为 `board-mark-x-y`，文字取 `mark.label ?? String(index + 1)`，`data-tone` 取 `mark.tone ?? 'accent'`，颜色按 tone 从 `--c-accent` / 一个表示「对」的绿 / `--c-danger` 里选。**跳过已占用点这条兜底必须保留**（内容是按局面写死的，渲染层不该假设两者永远一致）。

同时给 `index.css` 补一个 `--c-good` / `--c-good-soft` 令牌（浅深两套），别在组件里硬编码绿色。

- [ ] **Step 8：提取 `BoardStage` 并改 `BattleScreen`**

```tsx
/** 棋盘容器：容器查询 + 正方形约束。对战、课程、残局三处共用。 */
export function BoardStage({ children }: { children: ReactNode }) {
  return (
    <section
      className="order-1 flex h-[min(calc(100vw-1.5rem),56dvh)] items-center justify-center px-3 py-3 lg:order-2 lg:h-auto lg:min-h-0 lg:px-6 lg:py-6"
      style={{ containerType: 'size' }}
    >
      <div className="aspect-square w-[min(100cqw,100cqh)] overflow-hidden rounded-2xl border border-board-edge/40 shadow-panel">
        {children}
      </div>
    </section>
  )
}
```

`BattleScreen` 里 `hint?.map((s) => ({ point: s.move }))` 传给 `marks`。

- [ ] **Step 9：跑全量五连**

Run: `yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e`
Expected: 全绿。**端到端那 4 条提示用例必须仍然通过**——它们断言的是 `hint-marker-*`，改名后要么跟着改成 `board-mark-*`，要么在 `Board` 上保留旧 testid。**选择改测试**：`data-testid` 应当反映它现在的语义，留一个名不副实的 id 只会让后来人困惑。

- [ ] **Step 10：提交**

```bash
git add -A && git commit -m "refactor(board): 标记泛化、棋盘容器提取、字符画解析上移到 lib"
```

---

## Task 2：判定引擎

**Files:**
- Modify: `src/ai/patterns.ts`（把双威胁谓词抽出来，与 `shapeScore` 共用）
- Modify: `src/ai/threat.ts`（新增 `isForcedWinStart`）
- Create: `src/learn/types.ts`、`src/learn/verify.ts`
- Test: `src/ai/patterns.test.ts`、`src/ai/threat.test.ts`、`src/learn/verify.test.ts`

**Interfaces:**
- Consumes: `ai/patterns` 的 `analyzePoint` / `isWinningPoint` / `dominantThreat`、`ai/candidates` 的 `candidateMoves`、`ai/threat` 的 `findForcedWin`、`core/rules` 的 `validateMove` / `findWinLine`
- Produces:
  ```ts
  // ai/patterns.ts 新增
  export interface DoubleThreat {
    readonly doubleFour: boolean
    readonly fourThree: boolean
    readonly doubleThree: boolean
  }
  export function doubleThreat(counts: ShapeCount): DoubleThreat
  export function hasDoubleThreat(counts: ShapeCount): boolean

  // learn/types.ts
  export interface BoardSpec { readonly lines: readonly string[] }
  export type MarkTone = 'accent' | 'good' | 'bad'
  export interface MarkSpec { readonly point: Point; readonly label?: string; readonly tone?: MarkTone }
  export type PuzzleGoal =
    | { readonly kind: 'win' }
    | { readonly kind: 'blockFive' }
    | { readonly kind: 'makeShape'; readonly shape: 'openFour' | 'four' | 'openThree' | 'openTwo' | 'two' }
    | { readonly kind: 'doubleThreat' }
    | { readonly kind: 'forcedWin'; readonly maxPlies: number }

  // learn/verify.ts
  export type Verdict = { readonly ok: true } | { readonly ok: false; readonly reason: string }
  export function applyToBoard(board: Board, move: Point, player: Player): Board
  export function judgeMove(board: Board, player: Player, move: Point, goal: PuzzleGoal, now: () => number): Verdict
  /** 这道题在这个局面上成不成立（与「玩家走没走对」是两件事）。 */
  export function checkPrecondition(board: Board, player: Player, goal: PuzzleGoal): Verdict
  export function boardHasFive(board: Board): boolean

  // ai/threat.ts 新增
  /**
   * `move` 是不是某条强制取胜路线的**第一步**。
   *
   * `findForcedWin` 只回答「有没有取胜路线、第一步是什么」；判题要问的是
   * 「玩家走的这一手，是不是某条路线的第一步」——两者不是一回事，因为可能
   * 有多条路线、多个可取的起点。
   */
  export function isForcedWinStart(
    board: Board, player: Player, move: Point, options: ThreatSearchOptions,
  ): boolean
  ```

- [ ] **Step 1：先写双威胁谓词的失败测试**

`analyzePoint(board, point, player)` 的语义是**假定 `player` 已经落在 `point` 上**再分析，所以夹具里那个点必须是空的。

```ts
// src/ai/patterns.test.ts 追加
describe('doubleThreat', () => {
  /** (7,7) 空着；在这一手落下后横向成一个冲四、纵向成一个冲四。 */
  const DOUBLE_FOUR = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '.......B.......',
    '.......B.......',
    '.......B.......',
    '....BBB.W......',
    '.......W.......',
  ])

  /** (7,7) 落下后横向成冲四（(8,7) 被白堵）、纵向成活三。 */
  const FOUR_THREE = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '.......B.......',
    '.......B.......',
    '...............',
    '....BBB.W......',
  ])

  /** (7,7) 落下后横纵各成一个活三。 */
  const DOUBLE_THREE = boardFromLines([
    '...............',
    '...............',
    '...............',
    '...............',
    '.......B.......',
    '.......B.......',
    '...............',
    '....BB.........',
  ])

  it('两个方向各一个冲四就是双四', () => {
    expect(doubleThreat(analyzePoint(DOUBLE_FOUR, { x: 7, y: 7 }, BLACK))).toEqual({
      doubleFour: true, fourThree: false, doubleThree: false,
    })
  })

  it('一个冲四配一个活三算四三', () => {
    expect(doubleThreat(analyzePoint(FOUR_THREE, { x: 7, y: 7 }, BLACK))).toEqual({
      doubleFour: false, fourThree: true, doubleThree: false,
    })
  })

  it('两个活三算双三', () => {
    expect(doubleThreat(analyzePoint(DOUBLE_THREE, { x: 7, y: 7 }, BLACK))).toEqual({
      doubleFour: false, fourThree: false, doubleThree: true,
    })
  })

  it('只有一个冲四时三条全为假', () => {
    const single = boardFromLines([
      '...............', '...............', '...............', '...............',
      '...............', '...............', '...............', '....BBB.W......',
    ])
    expect(hasDoubleThreat(analyzePoint(single, { x: 7, y: 7 }, BLACK))).toBe(false)
  })

  it('shapeScore 的组合加成与谓词同进同出', () => {
    // 三个夹具逐一代进去：谓词为真的，分值必须高于同规模但无组合的局面。
    // 这条钉住「两处对双重威胁的理解不许分叉」。
  })
})
```

**这四个夹具已经实跑验证过**，实测结果是：

```
DOUBLE_FOUR : openFour=0 four=2 openThree=0
FOUR_THREE  : openFour=0 four=1 openThree=1
DOUBLE_THREE: openFour=0 four=0 openThree=2
SINGLE_FOUR : openFour=0 four=1 openThree=0
```

可以直接抄进测试。**但改夹具之后必须重跑一遍**——凭推理写出来的棋型夹具，本项目已经错过不止一次。

- [ ] **Step 2：把 `doubleThreat` 抽出来，让 `shapeScore` 调它**

`shapeScore` 现在是三行独立的 `if`，各自加一个魔数。改成先算 `doubleThreat(counts)`，再按三个布尔加同样的分值——**分值一个都不许变**，现有的 `shapeScore` 测试必须原样通过。

- [ ] **Step 3：写判定引擎的失败测试**

```ts
// src/learn/verify.test.ts
describe('judgeMove —— 一手取胜', () => {
  it('补成五连判对', () => {})
  it('没有连成五判错，并说明这一手没成五', () => {})
  it('落在已占用的点上报非法，而不是静默判错', () => {})
  it('两端都能成五时，两边都判对（多解）', () => {})
})

describe('judgeMove —— 挡住对手的成五点', () => {
  it('堵住唯一的成五点判对', () => {})
  it('没堵住时，理由里点名对手的成五点坐标', () => {})
  it('自己这一手就能赢时，不堵也算对', () => {})
})

describe('judgeMove —— 做出指定棋型', () => {
  it('做出活四判对', () => {})
  it('只做出冲四时判错，理由里写清「做出的是冲四」', () => {})
  it('目标活三时，做出更高级的冲四也算对', () => {})
})

describe('judgeMove —— 双重威胁', () => {
  it('双四判对', () => {})
  it('四三判对', () => {})
  it('只有一个冲四判错', () => {})
})

describe('judgeMove —— 强制取胜', () => {
  it('走出算杀证明得了的那一手判对', () => {})
  it('走出没有后续的一手判错，理由是引擎找不到强制路线', () => {})
})
```

- [ ] **Step 4：跑测试确认失败**

Run: `yarn vitest run src/learn/verify.test.ts`
Expected: FAIL——`Failed to resolve import "./verify"`

- [ ] **Step 4b：给 `threat.ts` 加 `isForcedWinStart`，先写失败测试**

```ts
describe('isForcedWinStart', () => {
  const START = boardFromLines([
    '...............', '...............', '...............', '...............',
    '...............', '...............', '...............', '....BBB.W......',
  ])

  it('给出取胜链的首着时为真', () => {
    expect(isForcedWinStart(START, BLACK, { x: 3, y: 7 }, options({ maxPlies: 5 }))).toBe(true)
  })

  it('走出一个冲四、但对手堵掉就没事了，为假', () => {
    // 实跑过：黑 (7,7) 只做成一个冲四，白堵 (3,7) 之后黑棋 9 手内都没有杀。
    // 这条正是「走子后再调 findForcedWin」那个错法的照妖镜。
    expect(isForcedWinStart(START, BLACK, { x: 7, y: 7 }, options({ maxPlies: 5 }))).toBe(false)
  })

  it('不是取胜链首着的普通着法为假', () => {
    expect(isForcedWinStart(START, BLACK, { x: 0, y: 0 }, options({ maxPlies: 5 }))).toBe(false)
  })

  it('已经有多个可取起点时，每一个都为真（多解）', () => {
    // 用「已成四」的局面：两端都能成五，两端都该判真
  })

  it('不改传入的棋盘', () => {})
})
```

实现方式：给内部递归 `attack` 增加一个**只作用于根节点**的 `requiredFirst` 参数——命中即返回，不命中直接跳过该分支；递归下去时传 `null`。`findForcedWin` 本身不动，`isForcedWinStart` 是它的一个受限调用。

- [ ] **Step 5：实现 `verify.ts`**

要点，逐条都要落实：

- **`judgeMove` 先做合法性校验**：`validateMove(board, move) !== null` 时返回 `{ ok: false, reason: '这里不能落子。' }`。不校验的话，一个落在已有棋子上的点会走进 `applyToBoard` 得到一张被悄悄改过的棋盘。
- **`applyToBoard` 内部 `slice()`**，与 `searchBoard` / `findForcedWin` 同一条硬约定：不改传入的棋盘。
- **`win`**：落子后 `findWinLine(after, move) !== null`。
- **`blockFive`**：落子后对手的成五点数为 0**或**自己已经成五。理由文案要点名坐标：`白棋下一手就能在 H8 连成五子，你没有堵住。`
- **`makeShape`**：**精确匹配，外加成五与活四一律判对**——

  ```ts
  const counts = analyzePoint(after, move, player)
  const ok = counts.five > 0 || counts.openFour > 0 || counts[goal.shape] > 0
  ```

  `shape` 覆盖 `openFour / four / openThree / openTwo / two` 五档——**第 2 节课「活二与眠二」的练习只能落在 `openTwo` / `two` 上**，`ShapeCount` 里本来就有这两个字段，不收进来那一节就没有目标类型可用。

  一处必须知道的口径差异：`analyzePoint` 的**三与四**走的是窗口枚举（看得见隔子型 `mm.mm`），而**二**沿用的是便宜口径 `analyzeRuns`（只数连续同色 + 两端可延展）。所以一道「做出活二」的题里不能出现跳二，否则判定与肉眼看到的对不上。

  这里**不用档位比较**：引擎的 `SHAPE_VALUE` 把冲四（14,000）排在活三（10,000）之上，但那是给搜索排序用的排序权重，不是教学上的包含关系——冲四与活三是两种互不包含的棋型，用档位比较会让「要求活三、做出冲四」判对，而玩家其实没做出题目要的那个东西。反过来，成五和活四是**任何目标下都该判对**的，因为那已经是胜势，为它判错只会让学习者困惑。
- **`doubleThreat`**：`hasDoubleThreat(analyzePoint(after, move, player))`。
- **`forcedWin`**：**必须在落子前的盘面上判，并要求玩家这一手就是那条取胜链的第一步。**

  ```ts
  case 'forcedWin':
    return isForcedWinStart(board, player, move, {
      maxPlies: goal.maxPlies, allowThrees: false, deadline: now() + 2000, now,
    }) ? OK : { ok: false, reason: '这一手之后引擎找不到强制取胜的路线——对手有办法防住。' }
  ```

  **不能在落子后的盘面上调 `findForcedWin`**，这一点已经实跑证实：`findForcedWin` 假定「传进来的盘面轮到攻方走」，而玩家落子之后轮到的是**对手**。那样判定等于白送攻方一手，会把输棋判成赢棋。实测：

  ```
  局面：黑 (4,7)(5,7)(6,7)，白 (8,7)
  走子前 findForcedWin(黑, maxPlies=5) → move=(3,7), plies=3     // 黑确实 3 手胜
  黑走 (7,7)（只做成一个冲四）后再调    → move=(3,7), plies=1     // 但它以为轮到黑走
  白在 (3,7) 堵掉之后                  → move=null               // 黑其实什么都没有
  ```

  用 2 秒硬上限——这是判题不是对局，不能让玩家等算杀跑满。

  这条同时让**求解器与判定器回到同一把尺子**：`solveMove` 本来就是在落子前的盘面上调 `findForcedWin`，此前两者口径不一致。
- **`checkPrecondition`** 判的是「这道题在这个局面上成不成立」，与「玩家走没走对」是两件事，所以**不能**写成「目标是否已经达成」——那个说法与可解性自检直接打架（题目可解 ⟺ 存在一手能达成目标，那它到底算不算「已达成」？）。按目标逐条定义：

  ```ts
  switch (goal.kind) {
    case 'blockFive': {
      // 对手本来就没有成五点，那就没什么可挡的，这题不成立
      const threats = candidateMoves(board, 1).filter((p) => isWinningPoint(board, p, opponentOf(player)))
      return threats.length > 0 ? OK : { ok: false, reason: '这个局面里对手没有成五点，题目不成立' }
    }
    case 'forcedWin':
      // 一手取胜用 win 表达，硬凑成 forcedWin 会让判定走空
      return goal.maxPlies >= 3 ? OK : { ok: false, reason: 'forcedWin 的 maxPlies 至少要 3，一手取胜请用 win' }
    default:
      return OK
  }
  ```

- [ ] **Step 6：跑测试确认通过**

Run: `yarn vitest run src/learn/verify.test.ts src/ai/patterns.test.ts`

- [ ] **Step 7：反向验证**

挑三条关键断言做「把实现改坏看它会不会红」的对照：把 `blockFive` 的对手成五点检查去掉、把 `makeShape` 的档位比较改成相等、把 `forcedWin` 的 `maxPlies - 1` 改成 `maxPlies`。三条都必须让对应用例变红。**做完把实现改回来。**

- [ ] **Step 8：提交**

```bash
git add -A && git commit -m "feat(learn): 判定引擎——用棋型与算杀证明一手是否达成目标"
```

---

## Task 3：求解与渐进式提示

**Files:**
- Create: `src/learn/hints.ts`
- Test: `src/learn/hints.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `judgeMove` / `PuzzleGoal`、`ai/candidates` 的 `candidateMoves`、`ai/threat` 的 `findForcedWin`
- Produces:
  ```ts
  /** 三级提示：1 是文字点拨，2 是目标复述，3 是具体点位。 */
  export const HINT_LEVELS = 3
  export function solveMove(board: Board, player: Player, goal: PuzzleGoal, now: () => number): Point | null
  export function goalHint(goal: PuzzleGoal): string
  ```

- [ ] **Step 1：写失败测试**

```ts
describe('solveMove', () => {
  it('能解出「一手取胜」的题', () => {})
  it('两端都能成五时，返回的是其中任意一个合法解', () => {})
  it('无解的局面返回 null', () => {})
  it('解出来的着法一定通过 judgeMove', () => {
    // 这条是「答案经过验证」的最小保证：求解器与判定器不能各说各话
  })
  it('强制取胜的题必须用算杀解，而且解出来的着法判定器也认', () => {
    // 原先这里写的是「预算极紧时也能返回」——那句自相矛盾：预算紧就是超时，
    // 超时就返回 null。改成正面比对：solveMove 走的是 findForcedWin（首着即解），
    // 且结果满足 judgeMove。这条同时钉住求解器与判定器口径一致。
  })
})

describe('goalHint', () => {
  it('每种目标都有一句中文说明', () => {
    for (const goal of ALL_GOALS) expect(goalHint(goal)).not.toBe('')
  })
  it('揭示的是目标，不是坐标', () => {
    // 文案里不许出现 A1..O15 这类坐标记号
  })
})
```

- [ ] **Step 2：跑测试确认失败** → `yarn vitest run src/learn/hints.test.ts`

- [ ] **Step 3：实现**

`solveMove` 的两种走法：

```ts
export function solveMove(board, player, goal, now): Point | null {
  // 算杀题的候选空间要靠搜索收窄：逐个试的话每个候选都要跑一遍 VCF，
  // 一道题能卡上好几秒。findForcedWin 直接给出第一步。
  if (goal.kind === 'forcedWin') {
    return findForcedWin(board, player, {
      maxPlies: goal.maxPlies,
      allowThrees: false,
      deadline: now() + 3000,
      now,
    }).move
  }

  // 其余目标的判定本身很便宜（一次棋型分析或一次五连扫描），逐个试即可。
  for (const move of candidateMoves(board)) {
    if (judgeMove(board, player, move, goal, now).ok) return move
  }
  return null
}
```

**求解器必须建立在判定器之上**——这样「题目可解」与「玩家做对」用的是同一把尺子，不可能出现「提示指的那一手被判错」。

`goalHint` 按 goal 返回一句中文，例如 `win` → 「找一个能立刻连成五子的点」，`blockFive` → 「对手下一手就能成五，先把那个点占住」，`forcedWin` → 「这一手之后，无论对手怎么应，你都能在 N 手内连成五子」。**文案里不许出现坐标**——有测试钉住。

- [ ] **Step 4：跑测试确认通过**

- [ ] **Step 5：提交**

---

## Task 4：8 节课程

**Files:**
- Create: `src/learn/lessons.ts`
- Test: `src/learn/lessons.test.ts`（结构与内容完整性）

**Interfaces:**
- Consumes: Task 2 的 `BoardSpec` / `PuzzleGoal` / `MarkSpec`
- Produces:
  ```ts
  export interface LessonStep {
    readonly title: string
    readonly body: string
    readonly board?: BoardSpec
    readonly marks?: readonly MarkSpec[]
    /**
     * 棋盘演示：一串按顺序摆出来的手顺，读者可以一步一步看。
     *
     * ROADMAP 明写课程要「讲解 + 棋盘演示」，一张静态图配几个标记不算演示——
     * 「黑棋活三、白棋堵一端、黑棋成活四」这种**次序**正是要教的东西，
     * 静态图恰恰把它丢了。手顺交给 `core/game.ts` 的 `replay()` 还原，
     * 不另写一套摆子逻辑。
     */
    readonly sequence?: {
      readonly moves: readonly Point[]
      readonly firstPlayer: Player
    }
  }
  export interface Practice {
    readonly prompt: string
    readonly board: BoardSpec
    readonly player: Player
    readonly goal: PuzzleGoal
    readonly hints: readonly string[]    // 至少 2 条，给提示 1、2 用
    readonly solution: string
  }
  export interface Lesson {
    readonly id: string
    readonly title: string
    readonly summary: string
    readonly steps: readonly LessonStep[]
    readonly practice: Practice
  }
  export const LESSONS: readonly Lesson[]
  ```

- [ ] **Step 1：先定数据形状与结构测试**

```ts
describe('课程结构', () => {
  it('正好 8 节', () => expect(LESSONS).toHaveLength(8))
  it('id 唯一且非空', () => {})
  it('每节课至少有 2 个讲解步骤', () => {})
  it('讲解文案不是占位符', () => {
    // 逐条断言不含 TODO / 占位 / lorem / 「示例」这类词，且长度下限合理
  })
  it('每节课都有练习，且练习文案齐备', () => {})
  it('带棋盘的步骤，棋盘都能解析', () => { parseBoardLines(step.board.lines) })
})
```

- [ ] **Step 2：跑测试确认失败**

- [ ] **Step 3：写 8 节课的内容**

必须真写，每节课都是「讲解步骤（含棋盘图解）→ 练习」。八节依次是：

1. `rules` **基本规则** —— 15×15、黑先、任意方向连成五子或更多即胜（长连有效）、无禁手、下满判和
2. `two` **活二与眠二** —— 两端都能延展的是活二，一端被堵的是眠二；活二才有发展
3. `three` **活三与眠三** —— 活三下一手能变成活四；眠三只能变冲四
4. `four` **冲四与活四** —— 活四必胜（两个成五点堵不住），冲四只是一次先手
5. `double` **双三与双四** —— 双重威胁才是真正的杀招：双四、四三、双活三
6. `defense` **如何防守** —— 对手成五 > 自己成五 > 对手活四 > 对手冲四/活三；先看对手有什么
7. `combo` **常见进攻组合** —— 四三、双活三的构造，以及为什么它们比单个活三强
8. `vcf` **基础必胜战术** —— 用一串对手不得不应的冲四把先手保持到底，最后成五（ROADMAP 给这一节定的名字是「基础必胜战术」，连续冲四是它的主角）

每节的 `practice` 目标按主题选，**八节全覆盖**：

| 节 | 主题 | 练习目标 |
| --- | --- | --- |
| 1 | 基本规则 | `win` |
| 2 | 活二与眠二 | `makeShape('openTwo')` |
| 3 | 活三与眠三 | `makeShape('openThree')` |
| 4 | 冲四与活四 | `makeShape('openFour')` |
| 5 | 双三与双四 | `doubleThreat` |
| 6 | 如何防守 | `blockFive` |
| 7 | 常见进攻组合 | `doubleThreat` |
| 8 | 连续冲四取胜 | `forcedWin`（`maxPlies: 3`） |

第 2 节的题面里**不许出现跳二**（见 Task 2 对二的口径说明）；第 3/4 两节反过来要**故意用上隔子型**，让学习者看到引擎确实认得 `mm.mm`。

- [ ] **Step 4：跑结构测试**

- [ ] **Step 5：提交**

---

## Task 5：15 道残局题

**Files:**
- Create: `src/learn/puzzles.ts`
- Test: `src/learn/puzzles.test.ts`（结构）

**Interfaces:**
- Produces:
  ```ts
  export type PuzzleCategory = 'winInOne' | 'blockFive' | 'makeOpenFour' | 'doubleThreat' | 'vcf' | 'forcedWin'
  export interface Puzzle extends Practice {
    readonly id: string
    readonly title: string
    readonly category: PuzzleCategory
  }
  export const PUZZLES: readonly Puzzle[]
  export const CATEGORY_LABELS: Record<PuzzleCategory, string>
  export const CATEGORY_ORDER: readonly PuzzleCategory[]
  ```

- [ ] **Step 1：写结构测试**

```ts
it('至少 15 道', () => expect(PUZZLES.length).toBeGreaterThanOrEqual(15))
it('六个分类都有题', () => {
  for (const category of CATEGORY_ORDER) {
    expect(PUZZLES.some((p) => p.category === category)).toBe(true)
  }
})
it('id 唯一、标题与提示文案齐备', () => {})
it('每道题至少 2 条渐进提示与一段解法说明', () => {})
```

- [ ] **Step 2：跑测试确认失败**

- [ ] **Step 3：出题**

分类与目标严格对应：

| 分类 | 目标 |
| --- | --- |
| `winInOne` 一步获胜 | `win` |
| `blockFive` 挡对手直接胜着 | `blockFive` |
| `makeOpenFour` 构造活四 | `makeShape('openFour')` |
| `doubleThreat` 双重威胁 | `doubleThreat` |
| `vcf` 连续冲四 | `forcedWin`，**`maxPlies: 5`** |
| `forcedWin` 强制获胜路线 | `forcedWin`，`maxPlies: 7` |

**`vcf` 不能用 3**：引擎里「3 手胜」只有一条路——一手做出活四或双四（`threat.test.ts` 的「活三能走成活四：三步取胜」就是这个）。而一条**冲四链**最短是 5 手：冲四 → 对手被迫堵 → 再冲四 → 对手再堵 → 成五。用 3 去表达「连续冲四」，判定会接受一个只做了活四的着法，题目的教学意图完全落空。

**出题时不许写答案坐标**，只写局面、落子方与目标。题面必须满足：

- 盘上**没有任何一方已经连成五子**（否则题目开局就是终局）
- 按手数奇偶推出的落子方与 `player` 一致
- 目标**尚未达成**（比如 `makeShape('openFour')` 的题，开局不该已经存在活四）

这三条由 Task 6 的自检兜底，但出题时就要照着做。

**出题时出一道验一道，不要一口气写完 15 道再跑自检。** 每写完一道就临时跑一次 `solveMove` 确认它有解；`vcf` / `forcedWin` 两类尤其如此——手工构造的强制取胜局面经常自以为有杀，实际被对手一步反先就破了。一口气写完再验，等待你的会是五个性质各异的失败，逐个 debug 的代价远高于写一道验一道。

- [ ] **Step 4：跑结构测试**

- [ ] **Step 5：提交**

---

## Task 6：内容自检（跨全部内容）

这是本阶段的**核心验收装置**：它把「答案经过验证」从一句承诺变成一条会红的测试。

**Files:**
- Create: `src/learn/content.test.ts`

**Interfaces:**
- Consumes: `LESSONS` / `PUZZLES` / `solveMove` / `judgeMove` / `boardHasFive`

- [ ] **Step 1：写测试**

```ts
const ALL: ReadonlyArray<{ id: string; practice: Practice }> = [
  ...LESSONS.map((l) => ({ id: `lesson:${l.id}`, practice: l.practice })),
  ...PUZZLES.map((p) => ({ id: `puzzle:${p.id}`, practice: p })),
]

const CLOCK = (): number => 0
const BUDGET = (): number => 0            // 判定里额外加 2 秒上限，这里给个固定值

describe('内容自检', () => {
  it('每一个练习/题目都至少有一个正确解', () => {
    // 整段的骨干。任何一道题无解，玩家都会卡在一个不可能完成的任务上。
    const unsolvable = ALL.filter(({ practice }) => {
      const board = parseBoardLines(practice.board.lines)
      return solveMove(board, practice.player, practice.goal, CLOCK) === null
    }).map(({ id }) => id)

    expect(unsolvable).toEqual([])
  })

  it('解出来的着法必须通过判定（求解器与判定器同一把尺子）', () => {
    for (const { id, practice } of ALL) {
      const board = parseBoardLines(practice.board.lines)
      const move = solveMove(board, practice.player, practice.goal, CLOCK)
      expect(move, id).not.toBeNull()
      // 用真实时钟给算杀留预算
      expect(judgeMove(board, practice.player, move!, practice.goal, Date.now), id).toEqual({ ok: true })
    }
  })

  it('没有哪道题的开局就已经分出胜负', () => {
    for (const { id, practice } of ALL) {
      const board = parseBoardLines(practice.board.lines)
      expect(boardHasFive(board), id).toBe(false)
    }
  })

  it('每道题的题目本身成立', () => {
    // 比如「挡住对手的成五点」的题，局面里必须真的存在成五点；
    // 否则题目无从谈起，玩家会对着一个没有威胁的棋盘发呆。
    for (const { id, practice } of ALL) {
      const board = parseBoardLines(practice.board.lines)
      expect(checkPrecondition(board, practice.player, practice.goal), id).toEqual({ ok: true })
    }
  })

  it('题面是合法的：落子方与手数奇偶一致、棋盘不满', () => {
    for (const { id, practice } of ALL) {
      const board = parseBoardLines(practice.board.lines)
      let black = 0
      let white = 0
      for (const cell of board) { if (cell === BLACK) black++; else if (cell === WHITE) white++ }
      // 黑先，所以黑子数要么等于白子数（轮到黑走），要么比白多一（轮到白走）
      expect(black - white, id).toBe(practice.player === BLACK ? 0 : 1)
    }
  })

  it('提示文案与解法说明不是占位符', () => {})

  it('每个目标类型都至少被一道题覆盖', () => {
    const kinds = new Set(ALL.map(({ practice }) => practice.goal.kind))
    expect([...kinds].sort()).toEqual(['blockFive', 'doubleThreat', 'forcedWin', 'makeShape', 'win'])
  })
})
```

- [ ] **Step 2：跑测试，让内容去撞它**

Run: `yarn vitest run src/learn/content.test.ts`

**失败是预期的，而且这里才是真正的工作量**：出题时凭眼看觉得「这局面黑棋有活四」，跑出来可能发现被堵死了。逐条修到全绿——**修的是题目，不是断言**。

- [ ] **Step 3：反向验证**

把某一道题的局面改一个子，让它变成无解，确认「都至少有一个正确解」这条会红、且失败信息里点名了是哪一道。改回来。

- [ ] **Step 4：提交**

---

## Task 7：学习进度持久化（IndexedDB）

**Files:**
- Create: `src/persist/progress.ts`
- Modify: `package.json`（加 `fake-indexeddb` 开发依赖）
- Test: `src/persist/progress.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LearningProgress {
    readonly completedLessons: readonly string[]
    readonly solvedPuzzles: readonly string[]
    /** 上次停留的位置，用于刷新后回到原处。null 表示从列表开始。 */
    readonly lastVisited: { readonly kind: 'lesson' | 'puzzle'; readonly id: string } | null
    /**
     * 上次所在的顶层视图。
     *
     * 不存它的话，在残局页刷新会被踢回对战页——「刷新后回到原处」就只覆盖了课程。
     */
    readonly lastView: 'battle' | 'learn' | 'puzzles'
  }
  export const EMPTY_PROGRESS: LearningProgress
  export function loadProgress(): Promise<LearningProgress>
  export function saveProgress(progress: LearningProgress): Promise<void>
  export function clearProgress(): Promise<void>
  /** 仅供测试：注入一个 IDBFactory，省略时用全局的。 */
  export function __setIndexedDbFactory(factory: IDBFactory | null): void

  /**
   * 存取接口。`learnStore` 依赖这个形状而不是直接依赖上面几个函数——
   * Task 8 的测试要注入一个假存储，与 `createGameStore(engine)` 注入假引擎同一套做法。
   */
  export interface ProgressStorage {
    load(): Promise<LearningProgress>
    save(progress: LearningProgress): Promise<void>
    clear(): Promise<void>
  }
  export const indexedDbProgress: ProgressStorage
  ```

- [ ] **Step 1：装依赖并写失败测试**

```bash
yarn add -D fake-indexeddb
```

```ts
// src/persist/progress.test.ts
import 'fake-indexeddb/auto'   // 必须在导入被测模块之前
```

```ts
describe('学习进度存储', () => {
  beforeEach(async () => { await clearProgress() })

  it('没存过时返回空进度', async () => {
    expect(await loadProgress()).toEqual(EMPTY_PROGRESS)
  })

  it('存进去能原样读回来', async () => {
    const progress = { completedLessons: ['rules'], solvedPuzzles: ['p1'], lastVisited: { kind: 'lesson', id: 'two' } }
    await saveProgress(progress)
    expect(await loadProgress()).toEqual(progress)
  })

  it('覆盖写而不是追加', async () => {})

  it('清空后回到空进度', async () => {})

  it('读到损坏数据时退回空进度，不抛错', async () => {
    // 直接往 store 里塞一个形状不对的对象
  })

  it('IndexedDB 不可用时降级为内存态，读写仍然能用', async () => {
    __setIndexedDbFactory(null)   // 模拟隐私模式
    await saveProgress({ ...EMPTY_PROGRESS, completedLessons: ['rules'] })
    expect((await loadProgress()).completedLessons).toEqual(['rules'])
  })
})
```

- [ ] **Step 2：跑测试确认失败**

- [ ] **Step 3：实现**

数据库 `gomoku-lab`、版本 1、一个对象仓库 `progress`、一个固定主键 `'learning'`。

三条必须落实：

- **任何一步失败都降级到内存**：`indexedDB` 不存在、`open` 触发 `onerror`、`open` 被 `onblocked`、事务抛错——全部 catch 住转内存态，并让后续读写继续可用。**进度丢了可以接受，白屏不行。**
- **读回来的数据要校验形状**：数组里是不是字符串、`lastVisited.kind` 是不是那两个值之一。与 `persist/storage.ts` 同一条口径——宁可当作没有进度，也不把半截数据灌进状态。
- **`__setIndexedDbFactory` 只服务于测试**，生产路径不调用它。

- [ ] **Step 4：跑测试确认通过**

- [ ] **Step 5：提交**

---

## Task 8：learn store 与导航

**Files:**
- Create: `src/store/learnStore.ts`、`src/store/navStore.ts`
- Test: `src/store/learnStore.test.ts`、`src/store/navStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // navStore.ts
  export type View = 'battle' | 'learn' | 'puzzles'
  export interface NavStore { readonly view: View; go(view: View): void }
  export const useNavStore: UseBoundStore<StoreApi<NavStore>>

  // learnStore.ts
  export interface LearnStore {
    readonly progress: LearningProgress
    /** 进度是否已从存储载入。false 时界面不该断言「没做过」。 */
    readonly loaded: boolean
    bootstrap(): void
    completeLesson(id: string): void
    solvePuzzle(id: string): void
    visit(kind: 'lesson' | 'puzzle', id: string): void
    reset(): void
    isLessonDone(id: string): boolean
    isPuzzleDone(id: string): boolean
  }
  ```

- [ ] **Step 1：写失败测试**

`learnStore` 的测试注入一个假的存储（与 `gameStore` 注入假引擎同一套做法）：

```ts
function createLearnStore(storage: ProgressStorage): UseBoundStore<StoreApi<LearnStore>>
```

```ts
it('载入前 loaded 为 false，载入后为 true', async () => {})
it('完成一节课会写进进度并落盘', async () => {})
it('同一节课完成两次不会重复记录', async () => {})
it('存储读失败时仍然是可用状态，只是进度为空', async () => {
  // 这条钉住 Review Focus 3：存储不可用不能把界面卡死
})
it('visit 记录位置但不影响完成状态', async () => {})
it('reset 清空内存与存储', async () => {})
```

- [ ] **Step 2：跑测试确认失败**

- [ ] **Step 3：实现**

`learnStore` 用**工厂函数 + 注入存储**，与 `createGameStore(engine)` 保持一致——这样它可以脱离浏览器直接单测，不需要 fake-indexeddb 参与。

`useLearnStore` 是组装真实存储的单例入口，与 `useGameStore` / `useSettingsStore` 并列。

- [ ] **Step 4：跑测试确认通过，提交**

---

## Task 9：课程运行器 UI

**Files:**
- Create: `src/features/learn/LearnScreen.tsx`、`src/features/learn/LessonView.tsx`、`src/features/learn/StepView.tsx`、`src/components/panels/FeedbackBanner.tsx`
- Modify: `src/features/battle/BattleScreen.tsx`（抽出 `BoardStage` 后同步）、`src/App.tsx`（视图切换）、`src/components/panels/*`（导航栏）
- Test: `src/features/learn/LessonView.test.tsx`、`src/components/panels/FeedbackBanner.test.tsx`

**Interfaces:**
- Consumes: `LESSONS`、`judgeMove`、`solveMove`、`goalHint`、`useLearnStore`、`BoardStage`、`Board` 的 `marks`
- Produces: `export function LearnScreen()`、`export function LessonView(props: { lesson: Lesson; onExit: () => void })`

  **不写 `JSX.Element` 返回类型**：React 19 的 `@types/react` 已经移除了全局 `JSX` 命名空间，写了会让 `yarn typecheck` 直接红。仓库现有组件一个都没写返回类型，照既有的来。

- [ ] **Step 1：写失败测试**

```tsx
it('未选课时列出全部 8 节课，已完成的带标记', () => {})
it('进入一节课后显示第一页讲解', () => {})
it('点「下一步」翻到下一页，最后一页进入练习', () => {})
it('练习里走对了显示通过反馈，并提示可以继续', () => {})
it('练习里走错了显示理由，棋盘不允许再落子直到重试', () => {})
it('「重试」清掉反馈与棋盘上的对错标记', () => {})
it('三级提示逐级揭示：第一级只给文字，第三级才标出点位', () => {})
it('答对之后展示解法说明', () => {})
```

- [ ] **Step 2：跑测试确认失败**

- [ ] **Step 3：实现**

**棋盘演示（`sequence`）必须真的渲染出来。** 第 1 轮自审给它加了字段，但光有字段没有消费者，ROADMAP 明写的「棋盘演示」就落不了地。做法：`StepView` 在 `step.sequence` 存在时渲染一组「上一步 / 下一步」控件，用 `replay(sequence.moves.slice(0, k), sequence.firstPlayer)` 还原到第 k 手——**路径只有这一条**，不要另写一套摆子逻辑，`replay` 已经在 `core/game.ts` 里且经过完整测试。当前手用 `lastMove` 高亮，末手停住之后不再前进。

补三条组件用例：

```tsx
it('有 sequence 的步骤显示演示控件，没有的不显示')
it('点「下一步」逐手摆子，棋子数随之增加')
it('走到末手后「下一步」禁用，点「上一步」可以退回去')
```

关键约定：

- **练习里的棋盘状态是「题目局面 + 玩家这一手」**，玩家落子后用 `judgeMove` 判，判对判错都在那一手的位置画 `good` / `bad` 标记，并显示 `FeedbackBanner`。
- **判错后锁盘**（`interactive={false}`），必须点「重试」才能再走——否则玩家会乱点，`FeedbackBanner` 也会一直闪。
- **提示按钮累计计数**：第 1 次给 `practice.hints[0]`，第 2 次给 `hints[1]`，第 3 次给 `goalHint(goal)` 并把 `solveMove` 的结果画成 `accent` 标记。**第 3 级之后按钮禁用**，并明说已经给到最具体的提示。
- **答对即 `completeLesson(lesson.id)`**，并展示 `practice.solution`。
- **进入课程页时读 `progress.lastVisited`**：上次停在哪节课就展开哪节课，从第一页重新讲起（不记到具体第几页——讲解页面本身没有状态可言，记到页只会让刷新后的位置显得随机）。`visit()` 在进入课程时调用。**不读它的话，`lastVisited` 就是一个只写不读的死字段**。

- [ ] **Step 4：跑测试确认通过**

- [ ] **Step 5：提交**

---

## Task 10：残局挑战 UI

**Files:**
- Create: `src/features/puzzles/PuzzleScreen.tsx`、`src/features/puzzles/PuzzleView.tsx`
- Modify: `src/App.tsx`
- Test: `src/features/puzzles/PuzzleView.test.tsx`

**Interfaces:**
- Consumes: `PUZZLES` / `CATEGORY_LABELS` / `CATEGORY_ORDER`、Task 9 的练习交互（**把「棋盘 + 判定 + 反馈 + 提示」抽成一个共用组件 `PracticeBoard`，课程与残局都用它**）
- Produces: `export function PuzzleScreen()`

- [ ] **Step 1：先把练习交互抽成 `PracticeBoard`**

Task 9 写完后再抽，比一开始就猜形状可靠。抽取后的接口：

```tsx
export interface PracticeBoardProps {
  readonly practice: Practice
  /** 判定通过时回调一次。 */
  readonly onSolved: () => void
}
```

`LessonView` 与 `PuzzleView` 都只负责外壳（讲解步骤 / 分类与进度），交互全部走 `PracticeBoard`。**抽完先跑 Task 9 的测试确认没红**，再继续。

- [ ] **Step 2：写残局 UI 的失败测试**

```tsx
it('按分类列出题目，已通过的打勾', () => {})
it('进入一题显示目标与棋盘', () => {})
it('做对后标记为已通过并展示解法', () => {})
it('可以「再来一次」重做同一题', () => {})
it('列表显示总进度（通过数 / 总数）', () => {})
```

- [ ] **Step 3：跑测试确认失败 → 实现 → 跑测试确认通过**

- [ ] **Step 4：接上导航**

`App.tsx` 按 `useNavStore().view` 渲染 `BattleScreen` / `LearnScreen` / `PuzzleScreen`，顶部加三个入口。**对战页的刷新恢复逻辑不受影响**——`bootstrapStore()` 仍然在挂载前跑。

`navStore.go()` 同时把 `view` 写进 `progress.lastView`，启动时用它初始化当前视图。

- [ ] **Step 5：跑全量五连并提交**

---

## Task 11：端到端、浏览器验证与文档

**Files:**
- Create: `e2e/learn.spec.ts`
- Modify: `docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、`docs/TEST_REPORT.md`、`README.md`、`AGENTS.md`、`docs/AI_ENGINE.md`（只在需要时）
- 截图：`docs/screenshots/phase3-*.png`

- [ ] **Step 1：端到端用例**

```ts
it('从对战页进入课程页，打开一节课并走到练习')
it('练习做对：出现通过反馈与解法说明')
it('练习做错：出现理由，重试后可以再走')
it('三级提示：第三次才在棋盘上标出点位')
it('做完一节课刷新页面，完成标记还在')      // ← Review Focus 5
it('残局页做对一题，进度计数 +1 并刷新后仍在')
it('移动端：课程页棋盘不滚页面、点按命中正确')   // ← Review Focus 4
```

最后一条放进 `e2e/mobile.spec.ts` 并复用已有的触摸派发写法。

- [ ] **Step 2：真实浏览器验证**

用 Playwright 驱动本机 Chrome 实走并截图：课程列表、一页讲解、答对反馈、答错反馈、第三级提示、残局列表、残局答对。**逐张看一眼**——Phase 2 的经验是截图能抓到单元测试永远抓不到的问题（过期的文案、错位的布局）。

- [ ] **Step 3：更新文档**

| 文档 | 改什么 |
| --- | --- |
| `ARCHITECTURE.md` | 新增 `learn/` 一层：职责、依赖方向、为什么独立；`BoardStage` 与 `marks` 的复用；IndexedDB 与 localStorage 的分工（进度 vs 对局存档） |
| `ROADMAP.md` | Phase 3 勾选完成，写清已知不足与转交 Phase 4 的事项 |
| `TEST_REPORT.md` | 用例计数、内容自检的结果（几节课几道题、各类目标覆盖情况）、浏览器验证记录、本轮发现的问题与修法 |
| `README.md` | 功能清单加「互动教学」「残局挑战」与截图，更新用例数 |
| `AGENTS.md` | 硬性约束里补 `learn/` 这一层：依赖方向 `features → store → learn → ai → core`，且 `learn/` 不得被 `ai`/`core` 反向依赖；文档同步表加一行「教学内容与题库 → `docs/ARCHITECTURE.md`」 |

- [ ] **Step 4：两轴代码审查**

派两个并行子代理：标准轴（对照 `AGENTS.md` / `docs/*` 与 Fowler 坏味道基线）与规格轴（对照本计划的 11 个 Task、`ROADMAP.md` 的 Phase 3 条目、以及用户原始需求）。**两条轴分开列、不重排**，每条自己核实后再决定改不改，修完把「查出 → 处置」写进 `TEST_REPORT.md`。

- [ ] **Step 5：最终五连**

```bash
yarn lint && yarn typecheck && yarn test && yarn build && yarn e2e
```

- [ ] **Step 6：提交**

---

## 自审记录

三轮自审查出并已修正的问题，逐条记录以便回溯：

**第 1 轮（覆盖性，对照 ROADMAP 的 Phase 3 条目逐条核）**

| 查出 | 修法 |
| --- | --- |
| ROADMAP 明写课程要「讲解 + **棋盘演示**」，计划里只有静态棋盘配几个标记——静态图恰恰把「黑棋活三、白棋堵一端、黑棋成活四」这种**次序**丢了，而那正是要教的东西 | `LessonStep` 增加 `sequence?: { moves, firstPlayer }`，读者可以一步一步看；手顺交给 `core/game.ts` 现有的 `replay()` 还原，不另写一套摆子逻辑 |

除这一条外，ROADMAP 的六项（课程运行器 / 8 节课 / 15 道题 / 搜索验证解法 / 错误解释与渐进提示与重试 / 进度存 IndexedDB）与验收标准三条（真实可操作、可完成、答案经过验证）都能指到具体 Task。

**第 2 轮（可执行性）**

| 查出 | 修法 |
| --- | --- |
| Task 2 Step 1 的双威胁测试是**占位符**（「真正的夹具在实现时定」），违反本技能「No Placeholders」——而且夹具是这类测试里最容易写错的部分，把它推给执行者等于把最大的坑留在原地 | 补上四个具体棋局（双四 / 四三 / 双三 / 单个冲四），并把 `analyzePoint` 的语义写清楚：它**假定落子方已经落在那个点上**，所以夹具里那个点必须是空的 |
| 同上，夹具写了但没验 | 实跑确认：`four=2` / `four=1+openThree=1` / `openThree=2` / `four=1`，四项全部与设计一致，结果抄进计划备查 |

**第 3 轮（风险）**

| 查出 | 修法 |
| --- | --- |
| **`judgeOutcome` 的定义与可解性自检直接打架**：题目「可解」的定义就是「存在一手能达成目标」，那它到底算不算「目标已达成」？两种理解都说得通，而自检里那条「没有哪道题的开局就已经达成目标」按任一理解写都会写出一个恒真的断言 | 换成 **`checkPrecondition`**：判的是「这道题在这个局面上成不成立」，与玩家走没走对是两件事。逐目标定义——`blockFive` 要求对手真的有成五点、`forcedWin` 要求 `maxPlies >= 3`（一手取胜该用 `win` 表达，硬凑成 forcedWin 会让判定走空），其余恒成立 |
| **`makeShape` 用档位比较会让「要求活三、做出冲四」判对**。引擎的 `SHAPE_VALUE` 确实把冲四排在活三之上，但那是**给搜索排序用的权重**，不是教学上的包含关系——冲四与活三是两种互不包含的棋型，用档位比较等于没做出题目要的东西也算过 | 改为精确匹配 `counts[shape] > 0`，**外加成五与活四一律判对**（那已经是胜势，为它判错只会让学习者困惑）。理由写进计划正文，免得实现时又被「档位」这个词带回去 |
| **`lastVisited` 只写不读**：Task 7 定义了这个字段、Task 8 有 `visit()` 动作，但 Task 9 的课程界面从没说过要读它 | Task 9 补一条要求：进入课程页时按 `lastVisited` 展开上次那节课，并写明**不读它这个字段就是死的** |
| **15 道残局题一次性写完再跑自检，等于把五个性质各异的失败堆到最后**。`vcf` / `forcedWin` 两类尤其危险——手工构造的强制取胜局面经常自以为有杀，实际对手一步反先就破了 | Task 5 补一条硬要求：**出一道验一道**，每写完一道就临时跑一次 `solveMove` |
| `AGENTS.md` 的文档同步写成了「如果需要」，但 `learn/` 是**确定要新增的一层**，依赖方向必须落到硬性约束里 | 改为无条件：补分层约定与文档同步表的一行 |

**第 4 轮（独立终审，由另一个代理执行）**

| 查出 | 修法 |
| --- | --- |
| **【最重】`forcedWin` 判定把走子**后**的盘面交给 `findForcedWin`，而那个函数假定「传进来的盘面轮到攻方走」**——玩家落子之后轮到的是对手，于是判定白送攻方一手，把输棋判成赢棋。代理给了实跑证据，我也复现了：黑走 (7,7) 只做成一个冲四，白在 (3,7) 堵掉之后黑棋 9 手内都没有杀，而走子后的盘面却让 `findForcedWin` 返回 `plies: 1`。**两类挑战题的 `maxPlies` 因此形同虚设，「答案经过搜索验证」这条验收标准会整个落空** | 改为在**落子前**的盘面上调新增的 `isForcedWinStart`，要求玩家这一手就是取胜链的第一步。`threat.ts` 加这个函数（内部给递归 `attack` 加一个只作用于根节点的 `requiredFirst`），`findForcedWin` 本身不动。顺带让求解器与判定器回到同一把尺子——`solveMove` 本来就是在落子前的盘面上调 `findForcedWin` |
| **`vcf` 用 `maxPlies: 3` 表达不了「连续冲四」**：引擎里 3 手胜只有「一手做出活四/双四」这一条路（`threat.test.ts` 的「活三能走成活四：三步取胜」），而冲四链最短 5 手（冲四→应→冲四→应→成五）。用 3 的话判定会接受一个只做了活四的着法，教学意图落空 | `vcf` 改 `5`、`forcedWin` 改 `7`；第 8 课标题回到 ROADMAP 定的「基础必胜战术」 |
| **`LessonStep.sequence` 只有定义、没有消费者**——第 1 轮自审补了字段，但 Task 9/10/11 都不渲染也不测它，ROADMAP 明写的「棋盘演示」仍然落不了地 | Task 9 补实现要点（用 `replay(moves.slice(0, k))` 逐手还原）与三条组件用例 |
| **`ProgressStorage` 全计划无定义**：Task 8 的 `createLearnStore(storage: ProgressStorage)` 与它的测试都依赖这个类型，而 Task 7 只产出三个自由函数，两个任务的接口对不上 | Task 7 的 Interfaces 里写出接口形状与 `indexedDbProgress` 单例 |
| **视图不持久化**：`lastVisited` 只记 lesson/puzzle，在残局页刷新会被踢回对战页——Review Focus 5 说的「不能回到一个错的位置」只覆盖了课程 | `LearningProgress` 加 `lastView`，`navStore.go()` 写入、启动时读取 |
| 两处会让 `yarn typecheck` 红或写出恒真断言：`JSX.Element`（React 19 的 `@types/react` 已移除全局 `JSX` 命名空间，仓库里 src 零处使用）；Task 3 的「预算极紧时也能返回」（预算紧就是超时、超时就返回 null，自相矛盾） | 删掉返回类型标注；那条断言改成正面比对「求解结果必须通过判定器」 |

**一条终审判断有误，我复跑两次确认不成立**：代理称 `DOUBLE_FOUR` 夹具实测是 `openFour=1 four=1`、纵向其实是活四。我在自己的探针里跑了两遍都是 `openFour=0 four=2`——纵向的 (7,8) 被白子堵着，只有一个成五点 (7,3)，确实是冲四而不是活四。**计划里记录的数字保留**。（这正是 `AGENTS.md` 那条「审查意见要自己核实再决定改不改」的用处。）
