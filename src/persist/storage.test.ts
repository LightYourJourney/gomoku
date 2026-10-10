import { beforeEach, describe, expect, it } from 'vitest'
import { BLACK, WHITE } from '../core/types'
import {
  clearSession,
  decodeSession,
  encodeSession,
  loadSession,
  saveSession,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type PersistedSession,
} from './storage'

const sample: Omit<PersistedSession, 'schemaVersion'> = {
  moves: [
    { x: 7, y: 7 },
    { x: 7, y: 8 },
    { x: 8, y: 8 },
  ],
  firstPlayer: BLACK,
  mode: 'pve',
  humanColor: WHITE,
  difficulty: 'easy',
}

describe('encodeSession / decodeSession', () => {
  it('导出再导入得到完全相同的会话', () => {
    const decoded = decodeSession(encodeSession(sample))

    expect(decoded).toEqual({ schemaVersion: SCHEMA_VERSION, ...sample })
  })

  it('空存档返回 null', () => {
    expect(decodeSession(null)).toBeNull()
    expect(decodeSession('')).toBeNull()
  })

  it('JSON 损坏时返回 null 而不是抛错', () => {
    expect(decodeSession('{ 这不是 json')).toBeNull()
    expect(decodeSession('undefined')).toBeNull()
  })

  it('顶层不是对象时返回 null', () => {
    expect(decodeSession('42')).toBeNull()
    expect(decodeSession('"gomoku"')).toBeNull()
    expect(decodeSession('null')).toBeNull()
  })

  it('schemaVersion 不匹配时返回 null', () => {
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, ...sample })

    expect(decodeSession(raw)).toBeNull()
  })

  it('缺少 schemaVersion 时返回 null', () => {
    expect(decodeSession(JSON.stringify(sample))).toBeNull()
  })

  it.each([
    ['firstPlayer 非法', { firstPlayer: 3 }],
    ['humanColor 非法', { humanColor: 0 }],
    ['mode 非法', { mode: 'online' }],
    ['difficulty 非法', { difficulty: 'godlike' }],
    ['moves 不是数组', { moves: 'nope' }],
  ])('%s 时返回 null', (_label, patch) => {
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...sample, ...patch })

    expect(decodeSession(raw)).toBeNull()
  })

  it.each([
    ['坐标越界', { x: 15, y: 0 }],
    ['坐标为负', { x: -1, y: 0 }],
    ['坐标是小数', { x: 1.5, y: 2 }],
    ['坐标是字符串', { x: '7', y: 7 }],
    ['缺少 y', { x: 7 }],
  ])('手顺里出现%s时返回 null', (_label, point) => {
    const raw = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ...sample,
      moves: [point],
    })

    expect(decodeSession(raw)).toBeNull()
  })

  it('空手顺是合法的存档', () => {
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...sample, moves: [] })

    expect(decodeSession(raw)?.moves).toEqual([])
  })

  it('重复落子的手顺能解出来，语义问题交给 replay 处理', () => {
    const raw = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ...sample,
      moves: [
        { x: 7, y: 7 },
        { x: 7, y: 7 },
      ],
    })

    expect(decodeSession(raw)?.moves).toHaveLength(2)
  })
})

describe('saveSession / loadSession', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('写入后再读出得到同一份会话', () => {
    saveSession(sample)

    expect(loadSession()).toEqual({ schemaVersion: SCHEMA_VERSION, ...sample })
  })

  it('没有存档时返回 null', () => {
    expect(loadSession()).toBeNull()
  })

  it('存档内容被损坏时返回 null 而不是抛错', () => {
    localStorage.setItem(STORAGE_KEY, '{{{')

    expect(loadSession()).toBeNull()
  })

  it('clearSession 之后读不到东西', () => {
    saveSession(sample)
    clearSession()

    expect(loadSession()).toBeNull()
  })
})
