import type { GameRecord } from '../persist/gameRecords'
import { positionFromReplay, type Position, type PositionProvenance } from '../core/position'
import { parsePositionText, toPositionFile } from '../persist/transfer/position'
import { parseImportText } from '../persist/transfer/validate'
import { toGameFile, type GamePayload } from '../persist/transfer/format'

/**
 * 分享协议版本。与棋谱/局面内部格式版本分开：这是链接外壳的版本。
 * 版本过新的链接明确拒绝，不猜测字段含义。
 */
const SHARE_VERSION = 1
const SHARE_HASH_PREFIX = '#share='

/**
 * 链接 token 的长度上限。
 *
 * 不是“所有浏览器都支持无限 URL”的承诺；超过这个长度直接拒绝生成，
 * 并提示改用 Phase 11A 的文件导出。225 手棋谱/满盘局面都远低于此值。
 */
export const MAX_SHARE_TOKEN = 12_000

export type ShareKind = 'game' | 'position'

export type ShareFailureCode =
  | 'too_long'
  | 'unsupported_version'
  | 'malformed'
  | 'checksum'
  | 'invalid_data'
  | 'unsupported_type'

export interface ShareFailure {
  readonly ok: false
  readonly code: ShareFailureCode
  readonly message: string
}

export interface ShareTokenSuccess {
  readonly ok: true
  readonly token: string
}

export type ShareTokenResult = ShareTokenSuccess | ShareFailure

export type ShareDecodeResult =
  | { readonly ok: true; readonly kind: 'game'; readonly game: GamePayload }
  | {
      readonly ok: true
      readonly kind: 'position'
      readonly position: Position
      readonly title: string | null
      readonly provenance: PositionProvenance | null
    }
  | ShareFailure

interface ShareEnvelope {
  readonly v: number
  readonly kind: ShareKind
  readonly data: unknown
}

function checksum(bytes: Uint8Array): string {
  // FNV-1a 32 位：只用于发现复制/截断造成的损坏，不是防篡改签名。
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function encodeShare(kind: ShareKind, data: unknown): ShareTokenResult {
  const body = JSON.stringify({ v: SHARE_VERSION, kind, data } satisfies ShareEnvelope)
  const bytes = new TextEncoder().encode(body)
  const token = `${SHARE_VERSION}.${checksum(bytes)}.${toBase64Url(bytes)}`
  if (token.length > MAX_SHARE_TOKEN) {
    return {
      ok: false,
      code: 'too_long',
      message: '分享内容超过链接长度上限，请改用文件导出。',
    }
  }
  return { ok: true, token }
}

export function createGameShare(record: GameRecord): ShareTokenResult {
  try {
    return encodeShare('game', toGameFile(record))
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_data',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function createReplayPositionShare(
  record: GameRecord,
  cursor: number,
): ShareTokenResult {
  const loaded = positionFromReplay(record.moves, record.firstPlayer, cursor)
  return createPositionShare(
    loaded.position,
    `棋谱第 ${loaded.provenance.ply} 手`,
    loaded.provenance,
  )
}

export function createPositionShare(
  position: Position,
  title: string | null,
  provenance: PositionProvenance | null = null,
): ShareTokenResult {
  return encodeShare('position', toPositionFile(position, title, provenance))
}

export interface ShareBase {
  readonly origin: string
  readonly pathname: string
}

export type ShareLinkResult =
  | { readonly ok: true; readonly link: string }
  | { readonly ok: false; readonly message: string }

export function createShareUrl(token: string, base: ShareBase): string {
  return `${base.origin}${base.pathname}${SHARE_HASH_PREFIX}${token}`
}

/** 把生成器结果转成界面共享的链接/错误，统一“过长改用文件”的文案。 */
export function shareLink(
  result: ShareTokenResult,
  base: ShareBase,
): ShareLinkResult {
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.code === 'too_long'
          ? '内容超过分享链接长度上限，请使用文件导出。'
          : result.message,
    }
  }
  return { ok: true, link: createShareUrl(result.token, base) }
}

export function shareTokenFromHash(hash: string): string | null {
  return hash.startsWith(SHARE_HASH_PREFIX) ? hash.slice(SHARE_HASH_PREFIX.length) : null
}

function decodeEnvelope(token: string): ShareEnvelope | ShareFailure {
  if (token.length > MAX_SHARE_TOKEN) {
    return { ok: false, code: 'too_long', message: '分享链接过长，已拒绝解析。' }
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, code: 'malformed', message: '分享链接格式不完整。' }
  }

  const versionText = parts[0]!
  const version = Number(versionText)
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, code: 'malformed', message: '分享链接版本无效。' }
  }
  if (version > SHARE_VERSION) {
    return {
      ok: false,
      code: 'unsupported_version',
      message: `分享链接版本 ${version} 高于当前支持的 ${SHARE_VERSION}。`,
    }
  }
  if (version !== SHARE_VERSION) {
    return { ok: false, code: 'malformed', message: '分享链接版本无效。' }
  }

  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(parts[2]!)
  } catch {
    return { ok: false, code: 'malformed', message: '分享链接内容不是有效的编码。' }
  }

  if (checksum(bytes) !== parts[1]) {
    return { ok: false, code: 'checksum', message: '分享链接校验失败，内容可能被截断或修改。' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return { ok: false, code: 'malformed', message: '分享链接内容不是有效的 JSON。' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, code: 'malformed', message: '分享链接内容必须是一个对象。' }
  }

  const value = parsed as Record<string, unknown>
  if (value.v !== SHARE_VERSION) {
    return { ok: false, code: 'invalid_data', message: '分享链接外壳版本不一致。' }
  }
  if (value.kind !== 'game' && value.kind !== 'position') {
    return { ok: false, code: 'unsupported_type', message: '分享链接类型不受支持。' }
  }
  if (typeof value.data !== 'object' || value.data === null) {
    return { ok: false, code: 'invalid_data', message: '分享链接缺少有效内容。' }
  }

  return { v: SHARE_VERSION, kind: value.kind, data: value.data }
}

export function decodeShareToken(token: string): ShareDecodeResult {
  try {
    const envelope = decodeEnvelope(token)
    if ('ok' in envelope) return envelope

    if (envelope.kind === 'game') {
      const parsed = parseImportText(JSON.stringify(envelope.data))
      if (!parsed.ok || parsed.kind !== 'game') {
        return {
          ok: false,
          code: 'invalid_data',
          message: '分享的棋谱未通过严格校验。',
        }
      }
      return { ok: true, kind: 'game', game: parsed.game }
    }

    const parsed = parsePositionText(JSON.stringify(envelope.data))
    if (!parsed.ok) {
      return { ok: false, code: 'invalid_data', message: '分享的局面未通过严格校验。' }
    }
    return {
      ok: true,
      kind: 'position',
      position: parsed.position,
      title: parsed.title,
      provenance: parsed.provenance,
    }
  } catch {
    // 任何未预料的解码错误都不能让 React 白屏。
    return { ok: false, code: 'malformed', message: '分享链接无法解析。' }
  }
}
