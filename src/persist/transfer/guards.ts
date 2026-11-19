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

export function issue(code: ImportIssue['code'], path: string, message: string): ImportIssue {
  return { code, path, message }
}
