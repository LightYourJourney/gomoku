import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { fallbackRoute, formatRoute, pageRoute, parseRoute, type Page, type Route } from '../lib/routes'
import { useLearnStore, type LearnStore } from './learnStore'

export interface NavigationStore {
  /** 当前位置。以地址为准：刷新、直达、后退 / 前进都从地址读。 */
  readonly route: Route
  /** 去某个位置：默认推入一条历史；`replace` 换掉当前这条。去当前所在的地址不多历史。 */
  navigate(route: Route, options?: { readonly replace?: boolean }): void
  /**
   * 进入一个模块（顶栏、页面里「去残局」这类按钮）。已经在这个模块里时不动；
   * 教学 / 残局会展开上次停留的那节（裁定 17）——进度还没载入就等载入后再展开。
   */
  enterPage(page: Page): void
}

export interface NavigationDeps {
  readonly window: Pick<Window, 'location' | 'history' | 'addEventListener'>
  readonly learn: UseBoundStore<StoreApi<LearnStore>>
  /** `import.meta.env.BASE_URL`。 */
  readonly base: string
}

/** 上次停留的那节，若它属于 `page` 这个模块。 */
function lastIn(page: Page, learn: LearnStore): Route | null {
  const last = learn.progress.lastVisited
  if (page === 'learn' && last?.kind === 'lesson') return { page, lesson: last.id }
  if (page === 'puzzles' && last?.kind === 'puzzle') return { page, puzzle: last.id }
  return null
}

/** 子页面的 id（课 / 题）；列表与其他页面为 null。 */
function visited(route: Route): { kind: 'lesson' | 'puzzle'; id: string } | null {
  if (route.page === 'learn' && route.lesson !== null) return { kind: 'lesson', id: route.lesson }
  if (route.page === 'puzzles' && route.puzzle !== null) return { kind: 'puzzle', id: route.puzzle }
  return null
}

/**
 * 应用内导航：页面与子页面进浏览器历史，地址就是位置（路径路由，地址规则见 `lib/routes.ts`）。
 *
 * 不用路由库：位置只有四个页面、三类子页面，解析与格式化是两个纯函数，这里只管
 * `pushState` / `replaceState` / `popstate` 与学习进度里的两个位置字段：
 * - `progress.lastView` 照旧随切页写（备份格式里有它，schema 不动），冷启动打开裸的
 *   根地址时用它回到上次那一页；
 * - `progress.lastVisited` 跟着地址写：进到某节课 / 某道题写它，从它回到同一模块的
 *   列表清掉它（与原来点「← 列表」一样；后退回列表也算）。
 */
export function createNavigationStore(deps: NavigationDeps): UseBoundStore<StoreApi<NavigationStore>> {
  const { window: win, learn, base } = deps
  const parsed = parseRoute(win.location.pathname, base)
  const initial: Route = parsed ?? fallbackRoute(win.location.pathname, base)
  if (parsed === null) {
    win.history.replaceState(null, '', `${formatRoute(initial, base)}${win.location.search}${win.location.hash}`)
  }

  /** 每次位置变化递增。异步的「载入后再展开」用它判断用户在这期间有没有去过别处。 */
  let navigations = 0
  /** 等学习进度载入后要做的那一次展开：只对发起它时的那条历史有效。 */
  let pending: { readonly at: number; readonly resolve: () => Route | null } | null = null

  // 冷启动打开裸的根地址：等进度载入后回到上次那一页（及那一节）。
  if (parsed !== null && parsed.page === 'battle') {
    pending = {
      at: 0,
      resolve: () => {
        const page = learn.getState().progress.lastView
        if (page === 'battle') return null
        return lastIn(page, learn.getState()) ?? pageRoute(page)
      },
    }
  }

  const store = create<NavigationStore>()((set, get) => {
    function go(route: Route, replace: boolean): void {
      const url = formatRoute(route, base)
      if (url !== win.location.pathname) {
        const target = `${url}${win.location.search}`
        if (replace) win.history.replaceState(null, '', target)
        else win.history.pushState(null, '', target)
      }
      navigations += 1
      set({ route })
    }

    return {
      route: initial,

      navigate(route, options) {
        go(route, options?.replace === true)
      },

      enterPage(page) {
        const { route } = get()
        // 已经在这一页：在子页面里就回列表（推入一条历史），在列表就不动——连计数都不动，
        // 否则会让一次还在等进度载入的展开作废。
        if (route.page === page) {
          if (visited(route) !== null || (route.page === 'review' && route.sub !== null)) go(pageRoute(page), false)
          return
        }
        if (page !== 'learn' && page !== 'puzzles') {
          go(pageRoute(page), false)
          return
        }
        if (learn.getState().loaded) {
          go(lastIn(page, learn.getState()) ?? pageRoute(page), false)
          return
        }
        go(pageRoute(page), false)
        pending = { at: navigations, resolve: () => lastIn(page, learn.getState()) }
      },
    }
  })

  /** 写学习进度里的两个位置字段（见上）。`before` 为 null 表示启动时的地址。 */
  function record(route: Route, before: Route | null): void {
    if (route.page !== before?.page) learn.getState().recordView(route.page)
    const now = visited(route)
    if (now !== null) learn.getState().visit(now.kind, now.id)
    else if (before !== null && route.page === before.page && visited(before) !== null) learn.getState().visit(null)
  }

  // 启动时的地址也要记：直达、刷新到 `/puzzles/p5` 之后，下次点顶栏或打开裸的根地址都该以它为准。
  // 裸的根地址除外——那正是要按上次的位置去恢复的情形。
  if (pending === null) record(initial, null)
  store.subscribe((state, previous) => record(state.route, previous.route))

  function settlePending(): void {
    const task = pending
    if (task === null || !learn.getState().loaded) return
    pending = null
    if (task.at !== navigations) return
    const target = task.resolve()
    if (target !== null) store.getState().navigate(target, { replace: true })
  }
  learn.subscribe(settlePending)
  settlePending()

  win.addEventListener('popstate', () => {
    const route = parseRoute(win.location.pathname, base) ?? fallbackRoute(win.location.pathname, base)
    navigations += 1
    pending = null
    store.setState({ route })
  })

  return store
}

/** 应用唯一的单例入口。 */
export const useNavigationStore = createNavigationStore({
  window,
  learn: useLearnStore,
  base: import.meta.env.BASE_URL,
})
