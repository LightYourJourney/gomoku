import type { Difficulty } from './types'

export interface DifficultyParams {
  /** 每层保留的候选着法数 */
  readonly width: number
  /**
   * 搜索深度上限。注意这是**安全上限、不是承诺**——真正约束搜索的是
   * `budgetMs`，迭代加深在预算耗尽时就停。实际达到的深度见 AI_ENGINE.md 的实测。
   */
  readonly depth: number
  /** 时间预算（毫秒） */
  readonly budgetMs: number
  /** 进攻权重 */
  readonly attack: number
  /** 防守权重 */
  readonly defense: number
  /** 算杀最大手数；0 表示关闭 */
  readonly threatPlies: number
  /** 算杀是否允许活三（VCT）。关掉即纯 VCF。 */
  readonly threatThrees: boolean
}

/**
 * 五档难度参数。
 *
 * 难度差异来自**真实的能力差异**，不是把固定深度贴上「人类棋力」的标签：
 * 入门与初级关闭算杀、深度只有 1–2；中级以上开启算杀并逐级加深。
 *
 * 置换表不进这张表——它只影响速度不影响棋力，对低档关掉属于人为削弱。
 *
 * `threatThrees` 五档全是 false，也就是只用 VCF、不用 VCT。VCT 的实现与测试
 * 都在（见 threat.ts），但实测代价是 VCF 的 39–489 倍，而 VCF 在测过的每个
 * 局面上都给出了同样的结论，所以默认关闭。这是一处**有意的漏杀**，不是没做。
 */
export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  beginner: {
    width: 6,
    depth: 1,
    budgetMs: 250,
    attack: 1,
    defense: 0.6,
    threatPlies: 0,
    threatThrees: false,
  },
  easy: {
    width: 10,
    depth: 2,
    budgetMs: 500,
    attack: 1,
    defense: 1,
    threatPlies: 0,
    threatThrees: false,
  },
  medium: {
    width: 10,
    depth: 4,
    budgetMs: 1000,
    attack: 1,
    defense: 1,
    threatPlies: 6,
    threatThrees: false,
  },
  hard: {
    width: 12,
    depth: 6,
    budgetMs: 1600,
    attack: 1,
    defense: 1,
    threatPlies: 10,
    threatThrees: false,
  },
  expert: {
    width: 14,
    depth: 8,
    budgetMs: 2600,
    attack: 1,
    defense: 1,
    threatPlies: 14,
    threatThrees: false,
  },
}

/** 全部难度，顺序即由弱到强。 */
export const DIFFICULTIES = Object.keys(DIFFICULTY_PARAMS) as readonly Difficulty[]

/** 界面开放使用的难度。Phase 2 起五档全开。 */
export const AVAILABLE_DIFFICULTIES: readonly Difficulty[] = DIFFICULTIES

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value)
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: '入门',
  easy: '初级',
  medium: '中级',
  hard: '高级',
  expert: '专家',
}
