import { beforeEach, describe, expect, it } from 'vitest'
import { BLACK, WHITE } from '../core/types'
import {
  decodeSession,
  encodeSession,
  loadSession,
  loadSessionResult,
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
  resignedBy: null,
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

  it('v1 存档只读迁移到 v2：补 resignedBy: null', () => {
    const { resignedBy: _omitted, ...v1 } = sample
    const raw = JSON.stringify({ schemaVersion: 1, ...v1 })

    expect(decodeSession(raw)).toEqual({ schemaVersion: SCHEMA_VERSION, ...v1, resignedBy: null })
  })

  it('v1 存档里即使出现 resignedBy 也不采信——那一版没有这个语义', () => {
    const raw = JSON.stringify({ schemaVersion: 1, ...sample, resignedBy: BLACK })

    expect(decodeSession(raw)?.resignedBy).toBeNull()
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

  it('认输的一方会被存下来', () => {
    const decoded = decodeSession(encodeSession({ ...sample, resignedBy: BLACK }))

    expect(decoded?.resignedBy).toBe(BLACK)
  })

  it('resignedBy 为 null 表示对局还没认输', () => {
    expect(decodeSession(encodeSession(sample))?.resignedBy).toBeNull()
  })

  it.each([
    ['不是合法的一方', 3],
    ['是字符串', 'black'],
    ['是布尔值', true],
  ])('resignedBy %s 时返回 null', (_label, value) => {
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...sample, resignedBy: value })

    expect(decodeSession(raw)).toBeNull()
  })

  it('缺少 resignedBy 字段时返回 null', () => {
    const { resignedBy: _omitted, ...withoutResign } = sample
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...withoutResign })

    expect(decodeSession(raw)).toBeNull()
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

})


describe('loadSessionResult：旧存档无法迁移时给出具体原因', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('没有存档时既没有会话也没有错误', () => {
    expect(loadSessionResult()).toEqual({ session: null, error: null })
  })

  it('合法存档没有错误', () => {
    saveSession(sample)
    expect(loadSessionResult().error).toBeNull()
    expect(loadSessionResult().session).toEqual({ schemaVersion: SCHEMA_VERSION, ...sample })
  })

  it('未来版本明确说出不支持的版本号', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 9, ...sample }))
    expect(loadSessionResult().error).toContain('9')
    expect(loadSessionResult().error).toContain('不受支持')
  })

  it('v1 字段损坏时指出是哪一版、哪类问题', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, ...sample, moves: [{ x: 99, y: 0 }] }),
    )
    expect(loadSessionResult().session).toBeNull()
    expect(loadSessionResult().error).toContain('v1')
    expect(loadSessionResult().error).toContain('字段不完整或类型错误')
  })

  it('坏 JSON 指出不是合法 JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{{{')
    expect(loadSessionResult().error).toBe('不是合法 JSON')
  })
})
