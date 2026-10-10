import type { Player, Point } from '../core/types'

/** 棋盘的字符画表示：`B` 黑、`W` 白、其余字符为空。见 `lib/board-lines.ts`。 */
export interface BoardSpec {
  readonly lines: readonly string[]
}

export type MarkTone = 'accent' | 'good' | 'bad'

/** 讲解里标在棋盘上的点。 */
export interface MarkSpec {
  readonly point: Point
  readonly label?: string
  readonly tone?: MarkTone
}

/**
 * 一道题要玩家做到什么。
 *
 * 这是整套教学设计的枢纽：题目只声明目标，不声明答案坐标。判定用引擎自己的
 * 棋型分析与算杀去证明某一手是否达成目标，于是「多个正确解」是自然结果而不是
 * 需要逐个列举的负担，出题人也没有机会把答案写错。
 */
export type PuzzleGoal =
  /** 一手连成五子 */
  | { readonly kind: 'win' }
  /** 对手下一手能成五，把这手堵掉 */
  | { readonly kind: 'blockFive' }
  /** 做出指定棋型 */
  | { readonly kind: 'makeShape'; readonly shape: ShapeKind }
  /** 一次做成双重威胁（双四 / 四三 / 双活三） */
  | { readonly kind: 'doubleThreat' }
  /** 走出某条强制取胜路线的第一步 */
  | { readonly kind: 'forcedWin'; readonly maxPlies: number }

/**
 * 可作为目标的棋型。
 *
 * 二也在其中——第 2 节课「活二与眠二」的练习只能落在 `openTwo` / `two` 上。
 * 口径差异要知道：三与四走窗口枚举（看得见隔子型），二沿用的是便宜口径
 * （只数连续同色 + 两端可延展），所以一道「做出活二」的题里不能出现跳二。
 *
 * 这是**棋型词汇表**，不是「内容当前用过的那些」。`SHAPE_LABELS` 按它取中文名，
 * 而那张表要覆盖 `ThreatKind`，所以 `'five'` / `'three'` 即使今天的题目没拿它们
 * 当目标也不能删——删了 `threatLabel` 就收不回引擎返回的威胁档位。
 * 现有内容只把 `openTwo` / `openThree` / `openFour` 用作目标，那是内容覆盖面，
 * 不是类型多写了。
 */
export type ShapeKind = 'five' | 'openFour' | 'four' | 'openThree' | 'three' | 'openTwo' | 'two'

/** 讲解的一页。 */
export interface LessonStep {
  readonly title: string
  readonly body: string
  readonly board?: BoardSpec
  readonly marks?: readonly MarkSpec[]
  /**
   * 棋盘演示：一串按顺序摆出来的手顺，读者可以一步一步看。
   *
   * 「黑棋活三、白棋堵一端、黑棋成活四」这种**次序**正是要教的东西，
   * 一张静态图恰恰把它丢了。手顺交给 `core/game.ts` 的 `replay()` 还原。
   */
  readonly sequence?: {
    readonly moves: readonly Point[]
    readonly firstPlayer: Player
  }
}

/** 一段练习：课程末尾与残局题共用同一套结构。 */
export interface Practice {
  readonly prompt: string
  readonly board: BoardSpec
  readonly player: Player
  readonly goal: PuzzleGoal
  /** 渐进提示的前两级文案。第三级由引擎算出具体点位。 */
  readonly hints: readonly string[]
  /** 通关后展示的解法说明。 */
  readonly solution: string
}

export interface Lesson {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly steps: readonly LessonStep[]
  readonly practice: Practice
}

export type PuzzleCategory =
  | 'winInOne'
  | 'blockFive'
  | 'makeOpenFour'
  | 'doubleThreat'
  | 'vcf'
  | 'forcedWin'

export interface Puzzle extends Practice {
  readonly id: string
  readonly title: string
  readonly category: PuzzleCategory
}
