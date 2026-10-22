import type { Player } from '../../core/types'

export type ImportErrorCode =
  | 'too_large'
  | 'too_deep'
  | 'invalid_json'
  | 'wrong_type'
  | 'wrong_format'
  | 'unsupported_version'
  | 'invalid_field'
  | 'bad_board'
  | 'bad_rules'
  | 'bad_coordinate'
  | 'duplicate_move'
  | 'move_after_end'
  | 'bad_ending'
  | 'ending_conflict'
  | 'too_many_games'
  | 'too_many_moves'
  | 'bad_progress'
  | 'bad_preferences'
  | 'bad_session'

export interface ImportIssue {
  readonly code: ImportErrorCode
  readonly path: string
  readonly message: string
}

/** 传输格式校验共用的小守卫；游戏文件与局面文件各写一份就会被 jscpd 抓。 */
export function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPlayer(value: unknown): value is Player {
  return value === 1 || value === 2
}

export function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
}

export function issue(code: ImportIssue['code'], path: string, message: string): ImportIssue {
  return { code, path, message }
}
