import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_PROGRESS, type LearningProgress, type ProgressStorage } from '../persist/progress'
import { createLearnStore } from './learnStore'
import { createNavigationStore } from './navigationStore'

/** 载入时机可控的进度存储：`release()` 之前 `load()` 一直挂着。 */
function storage(saved: Partial<LearningProgress> = {}) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const store: ProgressStorage = {
    load: () => gate.then(() => ({ ...EMPTY_PROGRESS, ...saved })),
    save: () => Promise.resolve(),
    saveStrict: () => Promise.resolve(true),
    clear: () => Promise.resolve(),
  }
  return { store, release }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 在 jsdom 里后退一步，等 popstate 到达。 */
function back(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
    window.history.back()
  })
}

function setup(path: string, saved: Partial<LearningProgress> = {}, { load = true } = {}) {
  window.history.replaceState(null, '', path)
  const { store, release } = storage(saved)
  const learn = createLearnStore(store)
  const nav = createNavigationStore({ window, learn, base: '/' })
  if (load) {
    learn.getState().bootstrap()
    release()
  }
  return { learn, nav, release }
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('导航 —— 地址就是位置', () => {
  it('启动时按地址取位置', () => {
    const { nav } = setup('/learn/intro')

    expect(nav.getState().route).toEqual({ page: 'learn', lesson: 'intro' })
  })

  it('认得页面、认不出子地址：回到那一页的列表', () => {
    const { nav } = setup('/learn/a/b')

    expect(nav.getState().route).toEqual({ page: 'learn', lesson: null })
    expect(window.location.pathname).toBe('/learn')
  })

  it('认不出的地址按对战处理，并把地址换成根（保留 hash）', () => {
    const { nav } = setup('/nowhere#share=abc')

    expect(nav.getState().route).toEqual({ page: 'battle' })
    expect(window.location.pathname).toBe('/')
    expect(window.location.hash).toBe('#share=abc')
  })

  it('navigate 推入一条历史并更新地址', async () => {
    const { nav } = setup('/')

    nav.getState().navigate({ page: 'review', sub: { kind: 'record', seq: 3 } })

    expect(window.location.pathname).toBe('/review/3')
    expect(nav.getState().route).toEqual({ page: 'review', sub: { kind: 'record', seq: 3 } })
    await back()
    expect(window.location.pathname).toBe('/')
  })

  it('replace 不多一条历史', async () => {
    window.history.replaceState(null, '', '/before')
    window.history.pushState(null, '', '/')
    const { nav } = setup('/')

    nav.getState().navigate({ page: 'learn', lesson: null }, { replace: true })
    expect(window.location.pathname).toBe('/learn')

    await back()
    expect(window.location.pathname).toBe('/before')
  })

  it('去当前所在的地址不多一条历史', async () => {
    window.history.replaceState(null, '', '/before')
    window.history.pushState(null, '', '/learn')
    const { nav } = setup('/learn')

    nav.getState().navigate({ page: 'learn', lesson: null })

    await back()
    expect(window.location.pathname).toBe('/before')
  })

  it('后退时以地址为准', async () => {
    const { nav } = setup('/')
    nav.getState().navigate({ page: 'puzzles', puzzle: null })
    nav.getState().navigate({ page: 'puzzles', puzzle: 'p1' })

    await back()

    expect(nav.getState().route).toEqual({ page: 'puzzles', puzzle: null })
  })
})

describe('导航 —— 进模块自动展开上次那节（裁定 17）', () => {
  it('点顶栏进教学：展开上次那节课，用户眼里只有一条历史', async () => {
    const { nav } = setup('/', { lastVisited: { kind: 'lesson', id: 'intro' } })
    await tick()

    nav.getState().enterPage('learn')
    expect(window.location.pathname).toBe('/learn/intro')

    await back()
    expect(window.location.pathname).toBe('/')
  })

  it('上次停在一道题时进教学看列表', async () => {
    const { nav } = setup('/', { lastVisited: { kind: 'puzzle', id: 'p1' } })
    await tick()

    nav.getState().enterPage('learn')

    expect(nav.getState().route).toEqual({ page: 'learn', lesson: null })
  })

  it('进度还没载入就点了顶栏：载入后把这条历史换成上次那节', async () => {
    const { nav, learn, release } = setup('/', { lastVisited: { kind: 'puzzle', id: 'p1' } }, { load: false })
    learn.getState().bootstrap()

    nav.getState().enterPage('puzzles')
    expect(window.location.pathname).toBe('/puzzles')
    release()
    await tick()

    expect(window.location.pathname).toBe('/puzzles/p1')
    await back()
    expect(window.location.pathname).toBe('/')
  })

  it('载入前点了顶栏、又在列表上点了一次同一项：照样展开（那一下什么都没动）', async () => {
    const { nav, learn, release } = setup('/', { lastVisited: { kind: 'puzzle', id: 'p1' } }, { load: false })
    learn.getState().bootstrap()

    nav.getState().enterPage('puzzles')
    nav.getState().enterPage('puzzles')
    release()
    await tick()

    expect(window.location.pathname).toBe('/puzzles/p1')
  })

  it('载入前点了顶栏、载入前又去了别处：不再展开', async () => {
    const { nav, learn, release } = setup('/', { lastVisited: { kind: 'puzzle', id: 'p1' } }, { load: false })
    learn.getState().bootstrap()

    nav.getState().enterPage('puzzles')
    nav.getState().enterPage('review')
    release()
    await tick()

    expect(window.location.pathname).toBe('/review')
  })

  it('在某节课里点顶栏的「教学」：回到课程列表（推入一条历史），不再展开', async () => {
    const { nav } = setup('/learn/intro', { lastVisited: { kind: 'lesson', id: 'intro' } })
    await tick()

    nav.getState().enterPage('learn')

    expect(window.location.pathname).toBe('/learn')
    await back()
    expect(window.location.pathname).toBe('/learn/intro')
  })

  it('已经在列表时点顶栏不动', async () => {
    window.history.replaceState(null, '', '/before')
    window.history.pushState(null, '', '/learn')
    const { nav } = setup('/learn', { lastVisited: { kind: 'lesson', id: 'intro' } })
    await tick()

    nav.getState().enterPage('learn')

    expect(window.location.pathname).toBe('/learn')
    await back()
    expect(window.location.pathname).toBe('/before')
  })

  it('后退回到模块列表不自动展开（否则会吃掉前进历史）', async () => {
    const { nav } = setup('/', { lastVisited: { kind: 'lesson', id: 'intro' } })
    await tick()
    nav.getState().navigate({ page: 'learn', lesson: null })
    nav.getState().navigate({ page: 'battle' })

    await back()
    await tick()

    expect(window.location.pathname).toBe('/learn')
  })
})

describe('导航 —— 冷启动', () => {
  it('裸的根地址：进度载入后回到上次那一页（及那一节），换掉而不是多一条历史', async () => {
    window.history.replaceState(null, '', '/before')
    window.history.pushState(null, '', '/')
    const { nav } = setup('/', { lastView: 'learn', lastVisited: { kind: 'lesson', id: 'intro' } })
    await tick()

    expect(nav.getState().route).toEqual({ page: 'learn', lesson: 'intro' })
    await back()
    expect(window.location.pathname).toBe('/before')
  })

  it('裸的根地址、载入前用户已经点了导航：不覆盖', async () => {
    const { nav, learn, release } = setup('/', { lastView: 'learn' }, { load: false })
    learn.getState().bootstrap()

    nav.getState().enterPage('review')
    release()
    await tick()

    expect(nav.getState().route).toEqual({ page: 'review', sub: null })
  })

  it('地址里有页面时不看上次的位置', async () => {
    const { nav } = setup('/puzzles', { lastView: 'learn', lastVisited: { kind: 'puzzle', id: 'p1' } })
    await tick()

    expect(nav.getState().route).toEqual({ page: 'puzzles', puzzle: null })
  })

  it('上次在对战页：留在对战页', async () => {
    const { nav } = setup('/', { lastView: 'battle' })
    await tick()

    expect(nav.getState().route).toEqual({ page: 'battle' })
  })
})

describe('导航 —— 学习进度里的位置照旧写', () => {
  it('切页面写 lastView', async () => {
    const { nav, learn } = setup('/')
    await tick()

    nav.getState().enterPage('review')

    expect(learn.getState().progress.lastView).toBe('review')
  })

  it('进到某节课写 lastVisited，后退回课程列表清掉它', async () => {
    const { nav, learn } = setup('/learn')
    await tick()
    nav.getState().navigate({ page: 'learn', lesson: 'intro' })
    expect(learn.getState().progress.lastVisited).toEqual({ kind: 'lesson', id: 'intro' })

    await back()

    expect(learn.getState().progress.lastVisited).toBeNull()
  })

  it('直达 / 刷新到某道题：启动时的地址同样写进进度（下次点顶栏、打开裸的根地址都以它为准）', async () => {
    const { learn } = setup('/puzzles/p5', { lastView: 'learn', lastVisited: { kind: 'lesson', id: 'old' } })
    await tick()

    expect(learn.getState().progress.lastView).toBe('puzzles')
    expect(learn.getState().progress.lastVisited).toEqual({ kind: 'puzzle', id: 'p5' })
  })

  it('直达模块列表只写页面，不清上次那节（与点「← 列表」不同，它没有离开过哪一节）', async () => {
    const { learn } = setup('/learn', { lastView: 'battle', lastVisited: { kind: 'lesson', id: 'intro' } })
    await tick()

    expect(learn.getState().progress.lastView).toBe('learn')
    expect(learn.getState().progress.lastVisited).toEqual({ kind: 'lesson', id: 'intro' })
  })

  it('从一节课去别的模块不清 lastVisited（与现在点顶栏一样）', async () => {
    const { nav, learn } = setup('/learn')
    await tick()
    nav.getState().navigate({ page: 'learn', lesson: 'intro' })

    nav.getState().enterPage('battle')

    expect(learn.getState().progress.lastVisited).toEqual({ kind: 'lesson', id: 'intro' })
  })
})
