import { describe, expect, it } from 'vitest'
// ?raw 由 Vite 提供（见 motion.test.ts 的说明）：读部署配置本身，核对它与地址规则一致。
import redirects from '../../public/_redirects?raw'
import headers from '../../public/_headers?raw'
import { PAGE_PATHS, fallbackRoute, formatRoute, parseRoute, type Route } from './routes'

const ROUTES: readonly [string, Route][] = [
  ['/', { page: 'battle' }],
  ['/learn', { page: 'learn', lesson: null }],
  ['/learn/intro-five', { page: 'learn', lesson: 'intro-five' }],
  ['/puzzles', { page: 'puzzles', puzzle: null }],
  ['/puzzles/p-vcf-3', { page: 'puzzles', puzzle: 'p-vcf-3' }],
  ['/review', { page: 'review', sub: null }],
  ['/review/12', { page: 'review', sub: { kind: 'record', seq: 12 } }],
  ['/review/editor', { page: 'review', sub: { kind: 'editor' } }],
]

describe('parseRoute / formatRoute', () => {
  it.each(ROUTES)('%s', (path, route) => {
    expect(parseRoute(path, '/')).toEqual(route)
    expect(formatRoute(route, '/')).toBe(path)
  })

  it('尾斜杠与不带尾斜杠是同一个地址', () => {
    expect(parseRoute('/learn/', '/')).toEqual({ page: 'learn', lesson: null })
    expect(parseRoute('/review/12/', '/')).toEqual({ page: 'review', sub: { kind: 'record', seq: 12 } })
  })

  it('子路径部署：地址相对于 base', () => {
    expect(parseRoute('/gomoku/', '/gomoku/')).toEqual({ page: 'battle' })
    expect(parseRoute('/gomoku', '/gomoku/')).toEqual({ page: 'battle' })
    expect(parseRoute('/gomoku/review/3', '/gomoku/')).toEqual({ page: 'review', sub: { kind: 'record', seq: 3 } })
    expect(formatRoute({ page: 'learn', lesson: 'a' }, '/gomoku/')).toBe('/gomoku/learn/a')
    expect(formatRoute({ page: 'battle' }, '/gomoku/')).toBe('/gomoku/')
  })

  it.each([
    '/foo',
    '/learn/a/b',
    '/review/abc',
    '/review/0',
    '/review/-1',
    '/review/1.5',
    '/review/12/editor',
    '/battle',
    '/other/learn',
  ])('认不出的地址 %s 返回 null', (path) => {
    expect(parseRoute(path, '/')).toBeNull()
  })

  it.each([
    ['/learn/a/b', { page: 'learn', lesson: null }],
    ['/review/abc', { page: 'review', sub: null }],
    ['/puzzles/x/y/', { page: 'puzzles', puzzle: null }],
    ['/foo', { page: 'battle' }],
    ['/gomoku-other', { page: 'battle' }],
  ] as const)('认不出的地址 %s 的退路：认得页面就回那一页的列表，否则对战', (path, route) => {
    expect(fallbackRoute(path, '/')).toEqual(route)
  })

  it('不在 base 之下的地址认不出', () => {
    expect(parseRoute('/learn', '/gomoku/')).toBeNull()
  })

  it('id 里的特殊字符编码进地址，读回来还是原样', () => {
    const route: Route = { page: 'learn', lesson: '五连 /?#' }
    const path = formatRoute(route, '/')
    expect(path).not.toMatch(/[ ?#]/)
    expect(parseRoute(path, '/')).toEqual(route)
  })

  it('解不开的百分号编码认不出，不抛', () => {
    expect(parseRoute('/learn/%E0%A4%A', '/')).toBeNull()
  })
})

describe('部署配置与地址规则一致（Cloudflare Pages）', () => {
  const rules = redirects
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))

  // 目标是 `/` 不是 `/index.html`：Pages 把 `/index.html` 308 到 `/`，改写到它会变成跳转（预览环境实测）。
  it.each(PAGE_PATHS)('/%s 与 /%s/* 都改写到入口页 /（200）', (path) => {
    expect(rules).toContainEqual([`/${path}`, '/', '200'])
    expect(rules).toContainEqual([`/${path}/*`, '/', '200'])
  })

  it('没有通配全站的改写——那会把发布后已不存在的旧分块也回成 HTML', () => {
    for (const [source] of rules) {
      expect(source).not.toBe('/*')
      expect(PAGE_PATHS.some((path) => source === `/${path}` || source === `/${path}/*`)).toBe(true)
    }
  })

  it.each(PAGE_PATHS)('/%s 下的页面与首页一样每次回源校验', (path) => {
    for (const source of [`/${path}`, `/${path}/*`]) {
      const block = headers.split(/\n(?=\S)/).find((entry) => entry.split('\n')[0]!.trim() === source)
      expect(block, `${source} 缺少 _headers 规则`).toBeDefined()
      expect(block).toContain('Cache-Control: public, max-age=0, must-revalidate')
    }
  })
})
