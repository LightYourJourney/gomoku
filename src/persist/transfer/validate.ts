import { isDifficulty } from '../../ai/difficulty'
import { opponentOf } from '../../core/board'
import { replay, type GameState } from '../../core/game'
import { validateMove } from '../../core/rules'
import { BOARD_SIZE, type Player, type Point } from '../../core/types'
import { isThemePreference } from '../../lib/theme'
import { isFiniteInt, isObj, isPlayer, issue, type ImportErrorCode, type ImportIssue } from './guards'
import type {
  BackupPreferences,
  BackupProgress,
  BackupSession,
  GameEnding,
  GamePayload,
} from './format'
import { BACKUP_FORMAT, GAME_FORMAT, EXTERNAL_FORMAT_VERSION, RULES_FREESTYLE } from './format'

/**
 * 导入的硬边界。数字不是拍脑袋：
 * - 10 MiB：2000 局 × 225 手的理论上限远小于此；更大的文件只可能是误选/恶意；
 * - 24 层：合法格式最深约 6 层，留足余量又能在 `JSON.parse` 前拦住深嵌套；
 * - 2000 局 / 10 万手：正常用户一辈子也到不了，内存与主线程都可控。
 */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_JSON_DEPTH = 24
const MAX_GAMES = 2_000
const MAX_MOVES = BOARD_SIZE * BOARD_SIZE
const MAX_TOTAL_MOVES = 100_000
const MAX_STRING_LENGTH = 200
const MAX_PROGRESS_IDS = 1_000

export type { ImportIssue } from './guards'

export interface GameValidation {
  readonly ok: true
  readonly game: GamePayload
  readonly warnings: readonly ImportIssue[]
}
export interface GameValidationFailure {
  readonly ok: false
  readonly errors: readonly ImportIssue[]
  readonly warnings: readonly ImportIssue[]
}
export type GameValidationResult = GameValidation | GameValidationFailure

export interface GameFileResult {
  readonly ok: true
  readonly kind: 'game'
  readonly game: GamePayload
  readonly warnings: readonly ImportIssue[]
}
export interface GameFileFailure {
  readonly ok: false
  readonly errors: readonly ImportIssue[]
  readonly warnings: readonly ImportIssue[]
}

export interface BackupGameError {
  readonly index: number
  readonly errors: readonly ImportIssue[]
}

export interface BackupFileResult {
  readonly ok: true
  readonly kind: 'backup'
  readonly games: readonly GamePayload[]
  readonly gameErrors: readonly BackupGameError[]
  readonly progress: BackupProgress | null
  readonly preferences: BackupPreferences | null
  readonly session: BackupSession | null
  readonly warnings: readonly ImportIssue[]
}
export interface BackupFileFailure {
  readonly ok: false
  readonly errors: readonly ImportIssue[]
  readonly warnings: readonly ImportIssue[]
}

export type ImportResult = GameFileResult | BackupFileResult | GameFileFailure | BackupFileFailure

type Obj = Record<string, unknown>

function objectAt(
  value: unknown,
  path: string,
  errors: ImportIssue[],
): Obj | null {
  if (!isObj(value)) {
    errors.push(issue('wrong_type', path, '应为对象'))
    return null
  }
  return value
}

/** 未知字段只警告、不解释——绝不按猜测的含义使用。 */
export function warnUnknownFields(
  value: Obj,
  allowed: readonly string[],
  path: string,
  warnings: ImportIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      warnings.push(issue('invalid_field', `${path}.${key}`, '未知字段，已忽略'))
    }
  }
}

function parseEnvelope(
  value: Obj,
  expectedFormat: string,
  path: string,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): { board: { size: number }; rules: typeof RULES_FREESTYLE } | null {
  if (value.format !== expectedFormat) {
    errors.push(issue('wrong_format', `${path}.format`, `格式应为 ${expectedFormat}`))
    return null
  }

  const version = value.formatVersion
  if (!isFiniteInt(version)) {
    errors.push(issue('invalid_field', `${path}.formatVersion`, '格式版本应为整数'))
    return null
  }
  if (version > EXTERNAL_FORMAT_VERSION) {
    errors.push(
      issue(
        'unsupported_version',
        `${path}.formatVersion`,
        `不支持版本 ${version}（当前支持 ${EXTERNAL_FORMAT_VERSION}）`,
      ),
    )
    return null
  }
  if (version < 1) {
    errors.push(issue('unsupported_version', `${path}.formatVersion`, `无效版本 ${version}`))
    return null
  }

  const board = objectAt(value.board, `${path}.board`, errors)
  if (board === null) return null
  if (board.size !== BOARD_SIZE) {
    errors.push(issue('bad_board', `${path}.board.size`, `棋盘必须是 ${BOARD_SIZE}×${BOARD_SIZE}`))
    return null
  }
  warnUnknownFields(board, ['size'], `${path}.board`, warnings)

  if (value.rules !== RULES_FREESTYLE) {
    errors.push(issue('bad_rules', `${path}.rules`, `只支持 ${RULES_FREESTYLE}`))
    return null
  }

  return { board: { size: BOARD_SIZE }, rules: RULES_FREESTYLE }
}

/** JSON 深度扫描：在 `JSON.parse` 之前挡住深嵌套，避免解析器递归爆栈。 */
export function jsonDepth(text: string): number {
  let depth = 0
  let max = 0
  let inString = false
  let escaped = false

  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      depth += 1
      max = Math.max(max, depth)
    } else if (char === '}' || char === ']') {
      depth -= 1
    }
  }

  return max
}

function validateMoveObjects(
  value: unknown,
  path: string,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): Point[] | null {
  if (!Array.isArray(value)) {
    errors.push(issue('invalid_field', path, 'moves 应为数组'))
    return null
  }
  if (value.length > MAX_MOVES) {
    errors.push(issue('too_many_moves', path, `最多 ${MAX_MOVES} 手`))
    return null
  }

  const moves: Point[] = []
  for (let i = 0; i < value.length; i++) {
    const entry = value[i]
    const at = `${path}[${i}]`
    const point = objectAt(entry, at, errors)
    if (point === null) return null
    warnUnknownFields(point, ['x', 'y'], at, warnings)
    if (!isFiniteInt(point.x) || !isFiniteInt(point.y)) {
      errors.push(issue('bad_coordinate', at, '坐标必须是有限整数'))
      return null
    }
    if (point.x < 0 || point.x >= BOARD_SIZE || point.y < 0 || point.y >= BOARD_SIZE) {
      errors.push(
        issue('bad_coordinate', at, `坐标 (${point.x}, ${point.y}) 越界（0–${BOARD_SIZE - 1}）`),
      )
      return null
    }
    moves.push({ x: point.x, y: point.y })
  }
  return moves
}

interface SequenceResult {
  readonly state: GameState
  readonly errors: readonly ImportIssue[]
}

/**
 * 严格手顺校验。**不接受 `replay()` 的截断结果**：它遇到非法/终局后的手会停下，
 * 适合恢复旧存档；导入必须把「停下」变成明确失败，不能把 80 手的坏文件截成
 * 35 手还报成功。
 */
function validateSequence(
  moves: readonly Point[],
  firstPlayer: Player,
  path: string,
): SequenceResult {
  /*
   * **只 replay 一次。** `replay()` 会在第一个非法手/终局后手处停下，返回的
   * `state.moves.length` 正好是第一个坏手的位置——不需要逐手 `applyMove`
   * （那会让每手都从头重放，225 手 × 2000 局把 10 MiB 上限变成几十秒的主线程
   * 卡顿）。停下之后只用 `validateMove` 判一次错误类型，规则仍来自 core。
   */
  const state = replay(moves, firstPlayer)
  if (state.moves.length === moves.length) return { state, errors: [] }

  const i = state.moves.length
  if (state.status !== 'playing') {
    return {
      state,
      errors: [issue('move_after_end', `${path}[${i}]`, '对局已经结束，不能再落子')],
    }
  }

  const error = validateMove(state.board, moves[i]!)
  const code: ImportErrorCode = error === 'occupied' ? 'duplicate_move' : 'bad_coordinate'
  return {
    state,
    errors: [
      issue(
        code,
        `${path}[${i}]`,
        error === 'occupied' ? '该交叉点已有棋子（重复落子）' : '落子非法',
      ),
    ],
  }
}

function validateEnding(
  value: unknown,
  state: GameState,
  path: string,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): GameEnding | null {
  const ending = objectAt(value, path, errors)
  if (ending === null) return null
  warnUnknownFields(ending, ['type', 'winner', 'resignedBy'], path, warnings)

  if (ending.type === 'five') {
    if (!isPlayer(ending.winner)) {
      errors.push(issue('bad_ending', `${path}.winner`, '赢家必须是 1（黑）或 2（白）'))
      return null
    }
    if (state.status !== 'won' || state.winner !== ending.winner) {
      errors.push(issue('ending_conflict', path, '声明五连获胜，但手顺没有产生对应胜负'))
      return null
    }
    return { type: 'five', winner: ending.winner }
  }

  if (ending.type === 'draw') {
    if (state.status !== 'draw') {
      errors.push(issue('ending_conflict', path, '声明和棋，但手顺没有下满棋盘或并非和棋'))
      return null
    }
    return { type: 'draw', winner: null }
  }

  if (ending.type === 'resign') {
    if (!isPlayer(ending.winner) || !isPlayer(ending.resignedBy)) {
      errors.push(issue('bad_ending', path, '认输局必须给出来赢家与认输方'))
      return null
    }
    if (ending.winner !== opponentOf(ending.resignedBy)) {
      errors.push(issue('ending_conflict', `${path}.winner`, '赢家必须是认输方的对手'))
      return null
    }
    if (state.status !== 'playing') {
      errors.push(issue('ending_conflict', path, '手顺本身已经结束，不能再以认输结束'))
      return null
    }
    return { type: 'resign', winner: ending.winner, resignedBy: ending.resignedBy }
  }

  errors.push(issue('bad_ending', `${path}.type`, '结束方式必须是 five / draw / resign'))
  return null
}

function validateSource(
  value: unknown,
  path: string,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): GamePayload['source'] | undefined {
  if (value === undefined) return undefined
  const source = objectAt(value, path, errors)
  if (source === null) return undefined
  warnUnknownFields(source, ['app', 'engineVersion'], path, warnings)
  if (typeof source.app !== 'string' || source.app.length > MAX_STRING_LENGTH) {
    errors.push(issue('invalid_field', `${path}.app`, '来源应用名应为不超过 200 字符的字符串'))
    return undefined
  }
  if (
    typeof source.engineVersion !== 'string' ||
    source.engineVersion.length > MAX_STRING_LENGTH
  ) {
    errors.push(issue('invalid_field', `${path}.engineVersion`, '引擎版本应为不超过 200 字符的字符串'))
    return undefined
  }
  return { app: 'gomoku-lab', engineVersion: source.engineVersion }
}

/** 校验一局的内容部分（不含 format/board/rules 外壳）。 */
function validateGamePayload(
  value: unknown,
  path = 'game',
  envelopeKeys: readonly string[] = [],
): GameValidationResult {
  const errors: ImportIssue[] = []
  const warnings: ImportIssue[] = []

  const game = objectAt(value, path, errors)
  if (game === null) return { ok: false, errors, warnings }

  warnUnknownFields(
    game,
    ['firstPlayer', 'moves', 'mode', 'humanColor', 'difficulty', 'ending', 'source', ...envelopeKeys],
    path,
    warnings,
  )

  const firstPlayer = game.firstPlayer
  const mode = game.mode
  const humanColor = game.humanColor
  const difficulty = game.difficulty

  if (!isPlayer(firstPlayer)) {
    errors.push(issue('invalid_field', `${path}.firstPlayer`, '先手方必须是 1（黑）或 2（白）'))
    return { ok: false, errors, warnings }
  }
  if (mode !== 'pve' && mode !== 'pvp') {
    errors.push(issue('invalid_field', `${path}.mode`, '模式必须是 pve / pvp'))
    return { ok: false, errors, warnings }
  }
  if (!isPlayer(humanColor)) {
    errors.push(issue('invalid_field', `${path}.humanColor`, '执子方必须是 1（黑）或 2（白）'))
    return { ok: false, errors, warnings }
  }
  if (!isDifficulty(difficulty)) {
    errors.push(issue('invalid_field', `${path}.difficulty`, '难度不在白名单内'))
    return { ok: false, errors, warnings }
  }

  const moves = validateMoveObjects(game.moves, `${path}.moves`, errors, warnings)
  if (moves === null) {
    return { ok: false, errors, warnings }
  }

  const sequence = validateSequence(moves, firstPlayer, `${path}.moves`)
  if (sequence.errors.length > 0) {
    return { ok: false, errors: [...errors, ...sequence.errors], warnings }
  }

  const ending = validateEnding(game.ending, sequence.state, `${path}.ending`, errors, warnings)
  if (ending === null) return { ok: false, errors, warnings }

  const source = validateSource(game.source, `${path}.source`, errors, warnings)
  if (errors.length > 0) return { ok: false, errors, warnings }

  return {
    ok: true,
    warnings,
    game: {
      firstPlayer,
      moves,
      mode,
      humanColor,
      difficulty,
      ending,
      ...(source === undefined ? {} : { source }),
    },
  }
}

interface ValidationContext {
  readonly top: Obj | null
  readonly errors: ImportIssue[]
  readonly warnings: ImportIssue[]
}

/** 两个文件级校验器的共同开头：建数组、取对象、登记未知字段。 */
function validationContext(
  value: unknown,
  path: string,
  allowed: readonly string[],
  warnUnknown = true,
): ValidationContext {
  const errors: ImportIssue[] = []
  const warnings: ImportIssue[] = []
  const top = objectAt(value, path, errors)
  if (top !== null && warnUnknown) warnUnknownFields(top, allowed, path, warnings)
  return { top, errors, warnings }
}

function validateGameFile(value: unknown, path: string): GameFileResult | GameFileFailure {
  // 未知字段留给 `validateGamePayload` 统一检查（它知道 payload + 外壳两套键），
  // 这里再查一遍会对同一个未知字段报两次。
  const { top, errors, warnings } = validationContext(value, path, [], false)
  if (top === null) return { ok: false, errors, warnings }
  if (parseEnvelope(top, GAME_FORMAT, path, errors, warnings) === null) {
    return { ok: false, errors, warnings }
  }

  const payload = validateGamePayload(top, path, ['format', 'formatVersion', 'board', 'rules'])
  if (!payload.ok) return { ok: false, errors: payload.errors, warnings: payload.warnings }
  return { ok: true, kind: 'game', game: payload.game, warnings: payload.warnings }
}

function progressArray(
  value: unknown,
  path: string,
  errors: ImportIssue[],
): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(issue('bad_progress', path, '应为字符串数组'))
    return null
  }
  if (value.length > MAX_PROGRESS_IDS) {
    errors.push(issue('bad_progress', path, `最多 ${MAX_PROGRESS_IDS} 项`))
    return null
  }
  const out: string[] = []
  for (let i = 0; i < value.length; i++) {
    const entry = value[i]
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_STRING_LENGTH) {
      errors.push(issue('bad_progress', `${path}[${i}]`, 'ID 应为 1–200 字符的字符串'))
      return null
    }
    out.push(entry)
  }
  return out
}

function validateProgress(
  value: unknown,
  path: string,
  warnings: ImportIssue[],
): BackupProgress | null {
  const errors: ImportIssue[] = []
  const raw = objectAt(value, path, errors)
  if (raw === null) return null
  warnUnknownFields(raw, ['completedLessons', 'solvedPuzzles', 'lastVisited', 'lastView'], path, warnings)

  const completedLessons = progressArray(raw.completedLessons, `${path}.completedLessons`, errors)
  const solvedPuzzles = progressArray(raw.solvedPuzzles, `${path}.solvedPuzzles`, errors)
  if (completedLessons === null || solvedPuzzles === null) return null

  let lastVisited: BackupProgress['lastVisited'] = null
  if (raw.lastVisited !== null && raw.lastVisited !== undefined) {
    const visited = objectAt(raw.lastVisited, `${path}.lastVisited`, errors)
    if (visited === null) return null
    if (visited.kind !== 'lesson' && visited.kind !== 'puzzle') {
      errors.push(issue('bad_progress', `${path}.lastVisited.kind`, '必须是 lesson / puzzle'))
      return null
    }
    if (typeof visited.id !== 'string' || visited.id.length === 0 || visited.id.length > MAX_STRING_LENGTH) {
      errors.push(issue('bad_progress', `${path}.lastVisited.id`, 'ID 应为 1–200 字符'))
      return null
    }
    lastVisited = { kind: visited.kind, id: visited.id }
  }

  const lastView = raw.lastView
  if (lastView !== 'battle' && lastView !== 'learn' && lastView !== 'puzzles' && lastView !== 'review') {
    errors.push(issue('bad_progress', `${path}.lastView`, '视图不在白名单内'))
    return null
  }

  return { completedLessons, solvedPuzzles, lastVisited, lastView }
}

function validatePreferences(
  value: unknown,
  path: string,
  warnings: ImportIssue[],
): BackupPreferences | null {
  const errors: ImportIssue[] = []
  const raw = objectAt(value, path, errors)
  if (raw === null) return null
  warnUnknownFields(raw, ['theme', 'showCoords', 'soundEnabled'], path, warnings)

  if (!isThemePreference(raw.theme)) {
    errors.push(issue('bad_preferences', `${path}.theme`, '主题必须是 system / light / dark'))
    return null
  }
  if (typeof raw.showCoords !== 'boolean' || typeof raw.soundEnabled !== 'boolean') {
    errors.push(issue('bad_preferences', path, 'showCoords / soundEnabled 必须是布尔值'))
    return null
  }
  return { theme: raw.theme, showCoords: raw.showCoords, soundEnabled: raw.soundEnabled }
}

function validateSession(
  value: unknown,
  path: string,
  warnings: ImportIssue[],
): BackupSession | null {
  const errors: ImportIssue[] = []
  const raw = objectAt(value, path, errors)
  if (raw === null) return null
  warnUnknownFields(
    raw,
    ['moves', 'firstPlayer', 'mode', 'humanColor', 'difficulty', 'resignedBy'],
    path,
    warnings,
  )

  const firstPlayer = raw.firstPlayer
  const mode = raw.mode
  const humanColor = raw.humanColor
  const difficulty = raw.difficulty

  if (!isPlayer(firstPlayer)) {
    errors.push(issue('bad_session', `${path}.firstPlayer`, '先手方必须是 1 或 2'))
    return null
  }
  if (mode !== 'pve' && mode !== 'pvp') {
    errors.push(issue('bad_session', `${path}.mode`, '模式必须是 pve / pvp'))
    return null
  }
  if (!isPlayer(humanColor)) {
    errors.push(issue('bad_session', `${path}.humanColor`, '执子方必须是 1 或 2'))
    return null
  }
  if (!isDifficulty(difficulty)) {
    errors.push(issue('bad_session', `${path}.difficulty`, '难度不在白名单内'))
    return null
  }

  let resignedBy: Player | null = null
  if (raw.resignedBy !== null) {
    if (!isPlayer(raw.resignedBy)) {
      errors.push(issue('bad_session', `${path}.resignedBy`, '认输方必须是 1、2 或 null'))
      return null
    }
    resignedBy = raw.resignedBy
  }

  const moves = validateMoveObjects(raw.moves, `${path}.moves`, errors, warnings)
  if (moves === null) return null
  const sequence = validateSequence(moves, firstPlayer, `${path}.moves`)
  if (sequence.errors.length > 0) return null

  if (resignedBy !== null && sequence.state.status !== 'playing') {
    return null
  }

  return {
    moves,
    firstPlayer,
    mode,
    humanColor,
    difficulty,
    resignedBy,
  }
}

/**
 * 可选段：缺失/null = 文件没带这一段；带了但无效 = 警告并跳过，**不影响棋谱**。
 * 三段的处理完全相同，抽出来避免三份复制粘贴（jscpd 零容忍）。
 */
function optionalSection<T>(
  value: unknown,
  path: string,
  parse: (value: unknown, path: string, warnings: ImportIssue[]) => T | null,
  code: ImportErrorCode,
  label: string,
  warnings: ImportIssue[],
): T | null {
  if (value === undefined || value === null) return null
  const parsed = parse(value, path, warnings)
  if (parsed === null) warnings.push(issue(code, path, `${label}段无效，已跳过`))
  return parsed
}

function validateBackupFile(value: unknown, path: string): BackupFileResult | BackupFileFailure {
  const { top, errors, warnings } = validationContext(value, path, [
    'format', 'formatVersion', 'board', 'rules', 'games', 'progress', 'preferences',
    'session', 'source',
  ])
  if (top === null) return { ok: false, errors, warnings }
  if (parseEnvelope(top, BACKUP_FORMAT, path, errors, warnings) === null) {
    return { ok: false, errors, warnings }
  }

  if (!Array.isArray(top.games)) {
    errors.push(issue('wrong_type', `${path}.games`, 'games 应为数组'))
    return { ok: false, errors, warnings }
  }
  if (top.games.length > MAX_GAMES) {
    errors.push(issue('too_many_games', `${path}.games`, `最多 ${MAX_GAMES} 局`))
    return { ok: false, errors, warnings }
  }

  let totalMoves = 0
  const games: GamePayload[] = []
  const gameErrors: BackupGameError[] = []

  for (let i = 0; i < top.games.length; i++) {
    const result = validateGamePayload(top.games[i], `${path}.games[${i}]`)
    if (!result.ok) {
      gameErrors.push({ index: i, errors: result.errors })
      continue
    }
    totalMoves += result.game.moves.length
    games.push(result.game)
    warnings.push(...result.warnings)
  }

  if (totalMoves > MAX_TOTAL_MOVES) {
    errors.push(issue('too_many_moves', `${path}.games`, `总手数超过 ${MAX_TOTAL_MOVES}`))
    return { ok: false, errors, warnings }
  }

  const progress = optionalSection(
    top.progress,
    `${path}.progress`,
    validateProgress,
    'bad_progress',
    '进度',
    warnings,
  )
  const preferences = optionalSection(
    top.preferences,
    `${path}.preferences`,
    validatePreferences,
    'bad_preferences',
    '偏好',
    warnings,
  )
  const session = optionalSection(
    top.session,
    `${path}.session`,
    validateSession,
    'bad_session',
    '会话',
    warnings,
  )

  const sourceErrorsBefore = errors.length
  validateSource(top.source, `${path}.source`, errors, warnings)
  if (errors.length > sourceErrorsBefore) {
    return { ok: false, errors, warnings }
  }

  return {
    ok: true,
    kind: 'backup',
    games,
    gameErrors,
    progress,
    preferences,
    session,
    warnings,
  }
}

/** 解析入口：先做大小/深度/JSON 检查，再按 `format` 分发。 */
export function parseImportText(text: string): ImportResult {
  const errors: ImportIssue[] = []
  const warnings: ImportIssue[] = []

  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    errors.push(issue('too_large', 'file', `文件超过 ${MAX_IMPORT_BYTES} 字节`))
    return { ok: false, errors, warnings }
  }
  if (jsonDepth(text) > MAX_JSON_DEPTH) {
    errors.push(issue('too_deep', 'file', `JSON 嵌套超过 ${MAX_JSON_DEPTH} 层`))
    return { ok: false, errors, warnings }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    errors.push(issue('invalid_json', 'file', '不是合法的 JSON'))
    return { ok: false, errors, warnings }
  }

  if (!isObj(parsed)) {
    errors.push(issue('wrong_type', 'file', '顶层必须是对象'))
    return { ok: false, errors, warnings }
  }

  if (parsed.format === GAME_FORMAT) return validateGameFile(parsed, 'file')
  if (parsed.format === BACKUP_FORMAT) return validateBackupFile(parsed, 'file')

  errors.push(issue('wrong_format', 'file.format', '不是支持的棋谱或备份格式'))
  return { ok: false, errors, warnings }
}
