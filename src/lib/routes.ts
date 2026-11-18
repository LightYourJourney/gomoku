/**
 * 应用的地址规则：页面 + 子页面 ↔ 路径。纯函数，不碰 `window`。
 *
 * 地址就是位置——刷新、直达、后退都以它为准（`store/navigationStore.ts`）。
 * 部署端必须为 `PAGE_PATHS` 里的每个前缀配改写规则（`public/_redirects`），
 * 两边的一致性由 `routes.test.ts` 核对。
 */

export type Page = 'battle' | 'learn' | 'puzzles' | 'review'

/** 复盘页的子页面：棋谱库（null）、回放某一局、局面编辑器。 */
export type ReviewSub = null | { readonly kind: 'record'; readonly seq: number } | { readonly kind: 'editor' }

export type Route =
  | { readonly page: 'battle' }
  | { readonly page: 'learn'; readonly lesson: string | null }
  | { readonly page: 'puzzles'; readonly puzzle: string | null }
  | { readonly page: 'review'; readonly sub: ReviewSub }

/** 除对战页（应用根）之外的页面路径前缀。 */
export const PAGE_PATHS = ['learn', 'puzzles', 'review'] as const

/** 某个页面的列表 / 首页（没有子页面）。 */
export function pageRoute(page: Page): Route {
  switch (page) {
    case 'battle':
      return { page }
    case 'learn':
      return { page, lesson: null }
    case 'puzzles':
      return { page, puzzle: null }
    case 'review':
      return { page, sub: null }
  }
}

/** `BASE_URL` 规范成以 `/` 结尾。 */
function rootOf(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** 地址 → 位置；认不出返回 null。`base` 是 `import.meta.env.BASE_URL`（以 `/` 结尾）。 */
export function parseRoute(pathname: string, base: string): Route | null {
  const root = rootOf(base)
  let rest: string
  if (pathname === root.slice(0, -1) || pathname === root) rest = ''
  else if (pathname.startsWith(root)) rest = pathname.slice(root.length)
  else return null

  const segments = rest.split('/')
  if (segments[segments.length - 1] === '') segments.pop()
  const [head, detail, ...extra] = segments
  if (head === undefined) return { page: 'battle' }
  if (extra.length > 0) return null

  switch (head) {
    case 'learn':
    case 'puzzles': {
      const id = detail === undefined ? null : decode(detail)
      if (detail !== undefined && (id === null || id === '')) return null
      return head === 'learn' ? { page: head, lesson: id } : { page: head, puzzle: id }
    }
    case 'review':
      if (detail === undefined) return { page: 'review', sub: null }
      if (detail === 'editor') return { page: 'review', sub: { kind: 'editor' } }
      if (/^[1-9]\d*$/.test(detail)) return { page: 'review', sub: { kind: 'record', seq: Number(detail) } }
      return null
    default:
      return null
  }
}

/**
 * 认不出的地址的退路：开头是认得的页面（`/learn/a/b`、`/review/abc`——Cloudflare 的
 * `/learn/*` 改写会把它们送进应用）就回那一页的列表，否则回对战页。
 */
export function fallbackRoute(pathname: string, base: string): Route {
  const root = rootOf(base)
  const head = pathname.startsWith(root) ? pathname.slice(root.length).split('/')[0] : undefined
  const page = PAGE_PATHS.find((path) => path === head)
  return page === undefined ? { page: 'battle' } : pageRoute(page)
}

/** 位置 → 地址。 */
export function formatRoute(route: Route, base: string): string {
  const root = rootOf(base)
  switch (route.page) {
    case 'battle':
      return root
    case 'learn':
      return route.lesson === null ? `${root}learn` : `${root}learn/${encodeURIComponent(route.lesson)}`
    case 'puzzles':
      return route.puzzle === null ? `${root}puzzles` : `${root}puzzles/${encodeURIComponent(route.puzzle)}`
    case 'review':
      if (route.sub === null) return `${root}review`
      return route.sub.kind === 'editor' ? `${root}review/editor` : `${root}review/${route.sub.seq}`
  }
}
