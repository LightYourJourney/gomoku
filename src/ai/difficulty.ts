import type { Difficulty } from './types'

export interface DifficultyParams {
  /** 每层保留的候选着法数 */
  readonly width: number
  /** 搜索深度上限 */
  readonly depth: number
  /** 时间预算（毫秒） */
  readonly budgetMs: number
  /** 进攻权重 */
  readonly attack: number
  /** 防守权重 */
  readonly defense: number
}

/**
 * 五档难度参数。
 *
 * 难度差异来自参数组合（候选宽度、搜索深度、时间预算、攻防权重），
 * 而不是把固定深度贴上「人类棋力」的标签。
 *
 * Phase 1 只开放 beginner 与 easy；medium / hard / expert 需要 Phase 2 的
 * 迭代加深调优与算杀搜索才谈得上名副其实，现在参数先占位，界面不开放。
 */
export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  beginner: { width: 6, depth: 1, budgetMs: 400, attack: 1, defense: 0.6 },
  easy: { width: 10, depth: 2, budgetMs: 900, attack: 1, defense: 1 },
  medium: { width: 12, depth: 4, budgetMs: 1500, attack: 1, defense: 1 },
  hard: { width: 14, depth: 6, budgetMs: 2500, attack: 1, defense: 1 },
  expert: { width: 16, depth: 8, budgetMs: 4000, attack: 1, defense: 1 },
}

/** 全部难度，顺序即由弱到强。 */
export const DIFFICULTIES = Object.keys(DIFFICULTY_PARAMS) as readonly Difficulty[]

/** Phase 1 界面开放使用的难度。 */
export const AVAILABLE_DIFFICULTIES: readonly Difficulty[] = ['beginner', 'easy']

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
