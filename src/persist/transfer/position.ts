import { createBoard } from '../../core/board'
import { applyMove, createGame } from '../../core/game'
import type { Position, PositionProvenance } from '../../core/position'
import { BOARD_SIZE, type Player, type Point } from '../../core/types'
import {
  jsonDepth,
  MAX_IMPORT_BYTES,
  MAX_JSON_DEPTH,
  warnUnknownFields,
} from './validate'
import { isFiniteInt, isObj, isPlayer, issue, type ImportIssue } from './guards'

export const POSITION_FORMAT = 'gomoku-lab.position'
const POSITION_FORMAT_VERSION = 1
export const RULES_FREESTYLE = 'freestyle'
const MAX_TITLE = 80

export interface PositionStone {
  readonly x: number
  readonly y: number
  readonly color: Player
}

export interface PositionFile {
  readonly format: typeof POSITION_FORMAT
  readonly formatVersion: number
  readonly board: { readonly size: number }
  readonly rules: typeof RULES_FREESTYLE
  readonly nextPlayer: Player
  readonly stones: readonly PositionStone[]
  readonly title?: string
  readonly provenance?: {
    readonly kind: 'replay'
    readonly moves: readonly Point[]
    readonly firstPlayer: Player
    readonly ply: number
  }
}

export interface PositionParseSuccess {
  readonly ok: true
  readonly position: Position
  readonly title: string | null
  readonly provenance: PositionProvenance | null
  readonly warnings: readonly ImportIssue[]
}
export interface PositionParseFailure {
  readonly ok: false
  readonly errors: readonly ImportIssue[]
  readonly warnings: readonly ImportIssue[]
}
export type PositionParseResult = PositionParseSuccess | PositionParseFailure

export function toPositionFile(
  position: Position,
  title: string | null,
  provenance: PositionProvenance | null,
): PositionFile {
  const stones: PositionStone[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = position.board[y * BOARD_SIZE + x]
      if (cell === 1 || cell === 2) stones.push({ x, y, color: cell })
    }
  }
  return {
    format: POSITION_FORMAT,
    formatVersion: POSITION_FORMAT_VERSION,
    board: { size: BOARD_SIZE },
    rules: RULES_FREESTYLE,
    nextPlayer: position.nextPlayer,
    stones,
    ...(title === null || title === '' ? {} : { title }),
    ...(provenance === null
      ? {}
      : {
          provenance: {
            kind: 'replay' as const,
            moves: provenance.moves.map((point) => ({ ...point })),
            firstPlayer: provenance.firstPlayer,
            ply: provenance.ply,
          },
        }),
  }
}

function parseProvenance(
  value: unknown,
  path: string,
  position: Position,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): PositionProvenance | null {
  const raw = value as Record<string, unknown>
  warnUnknownFields(raw, ['kind', 'moves', 'firstPlayer', 'ply'], path, warnings)
  if (raw.kind !== 'replay') {
    errors.push(issue('invalid_field', `${path}.kind`, '已知手顺类型必须是 replay'))
    return null
  }
  if (!isPlayer(raw.firstPlayer)) {
    errors.push(issue('invalid_field', `${path}.firstPlayer`, '先手方必须是 1 或 2'))
    return null
  }
  if (!Array.isArray(raw.moves) || raw.moves.length > 225) {
    errors.push(issue('invalid_field', `${path}.moves`, '手顺必须是长度不超过 225 的数组'))
    return null
  }
  if (!isFiniteInt(raw.ply) || raw.ply !== raw.moves.length) {
    errors.push(issue('invalid_field', `${path}.ply`, 'ply 必须等于手顺长度'))
    return null
  }

  const moves: Point[] = []
  let state = createGame(raw.firstPlayer)
  for (let i = 0; i < raw.moves.length; i++) {
    const entry = raw.moves[i]
    if (!isObj(entry) || !isFiniteInt(entry.x) || !isFiniteInt(entry.y)) {
      errors.push(issue('invalid_field', `${path}.moves[${i}]`, '坐标必须是有限整数'))
      return null
    }
    const point = { x: entry.x, y: entry.y }
    if (point.x < 0 || point.x >= 15 || point.y < 0 || point.y >= 15) {
      errors.push(issue('invalid_field', `${path}.moves[${i}]`, '坐标越界'))
      return null
    }
    if (state.status !== 'playing') {
      errors.push(issue('invalid_field', `${path}.moves[${i}]`, '对局已结束，手顺不能继续'))
      return null
    }
    const outcome = applyMove(state, point)
    if (!outcome.ok) {
      errors.push(issue('invalid_field', `${path}.moves[${i}]`, '手顺包含非法/重复落子'))
      return null
    }
    state = outcome.state
    moves.push(point)
  }

  for (let i = 0; i < 225; i++) if (state.board[i] !== position.board[i]) {
    errors.push(issue('invalid_field', path, '已知手顺重建出的盘面与 stones 不一致'))
    return null
  }
  if (state.current !== position.nextPlayer) {
    errors.push(issue('invalid_field', path, '已知手顺的下一手与 nextPlayer 不一致'))
    return null
  }

  return { kind: 'replay', moves, firstPlayer: raw.firstPlayer, ply: raw.ply }
}

export function parsePositionText(text: string): PositionParseResult {
  const errors: ImportIssue[] = []
  const warnings: ImportIssue[] = []

  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    errors.push(issue('invalid_field', 'file', `文件超过 ${MAX_IMPORT_BYTES} 字节`))
    return { ok: false, errors, warnings }
  }
  if (jsonDepth(text) > MAX_JSON_DEPTH) {
    errors.push(issue('invalid_field', 'file', `JSON 嵌套超过 ${MAX_JSON_DEPTH} 层`))
    return { ok: false, errors, warnings }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    errors.push(issue('invalid_field', 'file', '不是合法的 JSON'))
    return { ok: false, errors, warnings }
  }
  if (!isObj(parsed)) {
    errors.push(issue('invalid_field', 'file', '顶层必须是对象'))
    return { ok: false, errors, warnings }
  }

  warnUnknownFields(
    parsed,
    ['format', 'formatVersion', 'board', 'rules', 'nextPlayer', 'stones', 'title', 'provenance'],
    'file',
    warnings,
  )
  if (parsed.format !== POSITION_FORMAT) {
    errors.push(issue('invalid_field', 'file.format', `格式必须是 ${POSITION_FORMAT}`))
    return { ok: false, errors, warnings }
  }
  if (!isFiniteInt(parsed.formatVersion)) {
    errors.push(issue('invalid_field', 'file.formatVersion', '格式版本必须是整数'))
    return { ok: false, errors, warnings }
  }
  if (parsed.formatVersion > POSITION_FORMAT_VERSION) {
    errors.push(issue('invalid_field', 'file.formatVersion', `不支持版本 ${parsed.formatVersion}`))
    return { ok: false, errors, warnings }
  }
  if (parsed.formatVersion < 1) {
    errors.push(issue('invalid_field', 'file.formatVersion', `无效版本 ${parsed.formatVersion}`))
    return { ok: false, errors, warnings }
  }
  if (!isObj(parsed.board) || parsed.board.size !== BOARD_SIZE) {
    errors.push(issue('invalid_field', 'file.board.size', `棋盘必须是 ${BOARD_SIZE}×${BOARD_SIZE}`))
    return { ok: false, errors, warnings }
  }
  if (parsed.rules !== RULES_FREESTYLE) {
    errors.push(issue('invalid_field', 'file.rules', `只支持 ${RULES_FREESTYLE}`))
    return { ok: false, errors, warnings }
  }
  if (!isPlayer(parsed.nextPlayer)) {
    errors.push(issue('invalid_field', 'file.nextPlayer', '下一手必须是 1 或 2'))
    return { ok: false, errors, warnings }
  }
  if (!Array.isArray(parsed.stones) || parsed.stones.length > 225) {
    errors.push(issue('invalid_field', 'file.stones', 'stones 必须是长度不超过 225 的数组'))
    return { ok: false, errors, warnings }
  }

  const board = createBoard()
  const seen = new Set<string>()
  for (let i = 0; i < parsed.stones.length; i++) {
    const entry = parsed.stones[i]
    if (!isObj(entry) || !isFiniteInt(entry.x) || !isFiniteInt(entry.y)) {
      errors.push(issue('invalid_field', `file.stones[${i}]`, '坐标必须是有限整数'))
      return { ok: false, errors, warnings }
    }
    if (entry.x < 0 || entry.x >= 15 || entry.y < 0 || entry.y >= 15) {
      errors.push(issue('invalid_field', `file.stones[${i}]`, '坐标越界'))
      return { ok: false, errors, warnings }
    }
    if (entry.color !== 1 && entry.color !== 2) {
      errors.push(issue('invalid_field', `file.stones[${i}].color`, '颜色必须是 1 或 2'))
      return { ok: false, errors, warnings }
    }
    const key = `${entry.x},${entry.y}`
    if (seen.has(key)) {
      errors.push(issue('invalid_field', `file.stones[${i}]`, '同一交叉点出现多次'))
      return { ok: false, errors, warnings }
    }
    seen.add(key)
    board[entry.y * 15 + entry.x] = entry.color
  }

  let title: string | null = null
  if (parsed.title !== undefined) {
    if (typeof parsed.title !== 'string' || parsed.title.length > MAX_TITLE) {
      errors.push(issue('invalid_field', 'file.title', `标题必须是不超过 ${MAX_TITLE} 字符的字符串`))
      return { ok: false, errors, warnings }
    }
    title = parsed.title
  }

  const position = { board, nextPlayer: parsed.nextPlayer }
  let provenance: PositionProvenance | null = null
  if (parsed.provenance !== undefined) {
    if (!isObj(parsed.provenance)) {
      errors.push(issue('invalid_field', 'file.provenance', 'provenance 必须是对象'))
      return { ok: false, errors, warnings }
    }
    provenance = parseProvenance(parsed.provenance, 'file.provenance', position, errors, warnings)
    if (errors.length > 0) return { ok: false, errors, warnings }
  }

  return { ok: true, position, title, provenance, warnings }
}
