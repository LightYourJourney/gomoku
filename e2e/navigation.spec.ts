import { expect, test, type Page } from '@playwright/test'
import { BLACK } from '../src/core/types'
import { createGameShare } from '../src/sharing/link'
import { seedGameRecords } from './helpers/seed'

/**
 * 导航进浏览器历史 + 深链接（阶段 C，`docs/research/PHASE_C_PLAN.md`）。
 *
 * 地址就是位置：切页面、进出子页面都推入一条历史，后退 / 前进逐层返回，
 * 回到第一条之后再后退才离开应用；刷新与直达回到原地；对局内的动作不进历史。
 * 「离开应用」用一条应用之外的历史来判：先打开 `/robots.txt`（同源的静态文件，不启动应用）再进应用——
 * 新页面的初始 `about:blank` 在 Firefox 里不留历史，拿它判会因浏览器而异（CI 的 firefox-full 实测）。
 */

const path = (page: Page) => new URL(page.url()).pathname

async function nav(page: Page, name: '对战' | '教学' | '残局' | '复盘') {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click()
}

test('三层进入后逐层后退，回到第一条之后再后退就离开应用；前进逐层回来', async ({ page }) => {
  await page.goto('/robots.txt')
  await page.goto('/')
  await expect(page.getByTestId('board')).toBeVisible()

  await nav(page, '教学')
  await page.getByTestId('lesson-rules').click()
  await expect(page).toHaveURL(/\/learn\/rules$/)
  await nav(page, '残局')
  await page.getByTestId('puzzle-win-h').click()
  await expect(page).toHaveURL(/\/puzzles\/win-h$/)

  await page.goBack()
  await expect(page.getByTestId('puzzle-win-h')).toBeVisible()
  expect(path(page)).toBe('/puzzles')
  await page.goBack()
  await expect(page.getByRole('button', { name: '← 课程列表' })).toBeVisible()
  expect(path(page)).toBe('/learn/rules')
  await page.goBack()
  await expect(page.getByTestId('lesson-rules')).toBeVisible()
  expect(path(page)).toBe('/learn')
  await page.goBack()
  await expect(page.getByTestId('board')).toBeVisible()
  expect(path(page)).toBe('/')
  await page.goBack()
  await expect(page).toHaveURL(/\/robots\.txt$/)

  await page.goForward()
  await expect(page.getByTestId('board')).toBeVisible()
  await page.goForward()
  await expect(page.getByTestId('lesson-rules')).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('button', { name: '← 课程列表' })).toBeVisible()
})

test('刷新留在原地：子页面也一样', async ({ page }) => {
  await page.goto('/')
  await nav(page, '残局')
  await page.getByTestId('puzzle-win-h').click()
  await expect(page).toHaveURL(/\/puzzles\/win-h$/)

  await page.reload()

  await expect(page.getByRole('button', { name: '← 残局列表' })).toBeVisible()
  expect(path(page)).toBe('/puzzles/win-h')
})

test('直达：地址里的页面与子页面直接打开，不存在的 id 回到列表', async ({ page }) => {
  await page.goto('/learn/rules')
  await expect(page.getByRole('button', { name: '← 课程列表' })).toBeVisible()

  await page.goto('/review/editor')
  await expect(page.getByRole('heading', { level: 1, name: '局面研究' })).toBeVisible()

  await page.goto('/review/9999')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/review$/)

  await page.goto('/puzzles/没有这道题')
  await expect(page.getByTestId('puzzle-win-h')).toBeVisible()
  await expect(page).toHaveURL(/\/puzzles$/)
})

test('点顶栏进教学：展开上次那节课，后退一次就回到来处（只多一条历史）', async ({ page }) => {
  await page.goto('/')
  await nav(page, '教学')
  await page.getByTestId('lesson-three').click()
  await nav(page, '对战')
  await expect(page.getByTestId('board')).toBeVisible()

  await nav(page, '教学')
  await expect(page).toHaveURL(/\/learn\/three$/)

  await page.goBack()
  await expect(page.getByTestId('board')).toBeVisible()
  expect(path(page)).toBe('/')
})

test('对局里落子、悔棋不进历史：后退直接回到上一页', async ({ page }) => {
  await page.goto('/')
  await nav(page, '复盘')
  await expect(page).toHaveURL(/\/review$/)
  await nav(page, '对战')
  await page.getByTestId('intersection-7-7').click()
  await expect(page.locator('[data-testid^="stone-"]')).toHaveCount(2)
  await page.getByRole('button', { name: /悔棋/ }).first().click()

  await page.goBack()

  await expect(page).toHaveURL(/\/review$/)
})

test('在某节课里点顶栏的「教学」：回到课程列表', async ({ page }) => {
  await page.goto('/learn/rules')
  await expect(page.getByRole('button', { name: '← 课程列表' })).toBeVisible()

  await nav(page, '教学')

  await expect(page.getByTestId('lesson-rules')).toBeVisible()
  expect(path(page)).toBe('/learn')
})

const NINE_MOVES = [
  { x: 3, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 7 }, { x: 4, y: 9 },
  { x: 5, y: 7 }, { x: 5, y: 9 }, { x: 6, y: 7 }, { x: 6, y: 9 }, { x: 7, y: 7 },
]

test('回放某一局：直达 /review/<棋谱号> 与刷新都回到那一局', async ({ page }) => {
  await seedGameRecords(page, [
    {
      schemaVersion: 1,
      moves: NINE_MOVES,
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    },
  ])
  await page.goto('/review')
  await page.getByTestId(/^record-/).first().click()
  await expect(page).toHaveURL(/\/review\/\d+$/)
  const replay = path(page)

  await page.reload()
  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')
  expect(path(page)).toBe(replay)

  await page.goto('/')
  await page.goto(replay)
  await expect(page.getByTestId('move-counter')).toHaveText('0 / 9')
})

test('分享预览进出不弄乱历史：返回应用后回到原来的页面，后退照常逐层', async ({ page }) => {
  const token = createGameShare({
    seq: 1,
    schemaVersion: 1,
    moves: NINE_MOVES,
    firstPlayer: BLACK,
    mode: 'pvp',
    humanColor: BLACK,
    difficulty: 'easy',
    resignedBy: null,
    winner: BLACK,
  })
  expect(token.ok).toBe(true)
  if (!token.ok) return

  await page.goto('/')
  await nav(page, '教学')
  await expect(page).toHaveURL(/\/learn$/)
  await page.evaluate((value) => {
    window.location.hash = `share=${value}`
  }, token.token)
  await expect(page.getByTestId('share-kind')).toContainText('单盘棋谱')

  await page.getByRole('button', { name: '← 返回应用' }).first().click()

  await expect(page.getByTestId('lesson-rules')).toBeVisible()
  expect(path(page)).toBe('/learn')
  expect(new URL(page.url()).hash).toBe('')
  // 进预览那一下是一条 hash 历史，返回应用把它换成了无 hash 的同一页——后退仍在教学页，再退才回对战页
  await page.goBack()
  await expect(page.getByTestId('lesson-rules')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('board')).toBeVisible()
  expect(path(page)).toBe('/')
})

