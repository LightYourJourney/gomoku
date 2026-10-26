import { expect, test } from '@playwright/test'
import { BLACK, type Point } from '../src/core/types'
import { seedGameRecords } from './helpers/seed'

/**
 * Phase 11C 的完整实测流程：
 * 47 手原棋谱 → 第 26 手 → 创建分支 → AI 继续 → 认输入库 → 原棋谱仍完整。
 */
test('分支：47 手棋谱第 26 手继续，AI 接管并保存独立棋谱', async ({ page }) => {
  test.setTimeout(90_000)

  const filler: Point[] = []
  for (const x of [3, 7, 11]) {
    for (let y = 2; y < 15; y++) filler.push({ x, y })
  }
  filler.push({ x: 0, y: 2 }, { x: 0, y: 4 }, { x: 0, y: 6 })
  const winning: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
  ]
  const moves = [...filler, ...winning]
  expect(moves).toHaveLength(47)

  await seedGameRecords(page, [
    {
      schemaVersion: 1,
      moves,
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    },
  ])

  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  const source = page.getByTestId(/^record-/).filter({ hasText: '47 手' })
  await expect(source).toHaveCount(1)
  await source.click()

  const slider = page.getByLabel('回放手数')
  await slider.focus()
  await slider.press('Home')
  for (let i = 0; i < 26; i++) await slider.press('ArrowRight')
  await expect(page.getByTestId('move-counter')).toHaveText('26 / 47')

  await page.getByRole('button', { name: '从这里继续对弈' }).click()
  await expect(page.getByTestId('branch-dialog')).toContainText('26 / 47 手')
  await page.getByLabel('分支对弈模式').selectOption('pve')
  await page.getByLabel('分支玩家执子').selectOption('2')
  await page.getByRole('button', { name: '开始探索' }).click()

  await expect(page.getByTestId('branch-banner')).toContainText('从第 26 手继续')
  await expect
    .poll(async () => page.getByTestId(/^stone-/).count(), { timeout: 20_000 })
    .toBeGreaterThan(26)

  await page.setViewportSize({ width: 1440, height: 900 })
  const board = await page.getByTestId('board').boundingBox()
  expect(board).not.toBeNull()
  if (board !== null) {
    expect(board.width).toBeGreaterThanOrEqual(620)
    expect(board.width / 1440).toBeGreaterThanOrEqual(0.35)
  }
  await expect(page.getByTestId('branch-banner')).toBeVisible()

  await page.getByRole('button', { name: '认输' }).click()
  await page.getByRole('button', { name: '确认认输' }).click()
  await expect(page.getByRole('dialog')).toContainText('这局已存入棋谱库')
  await page.getByRole('button', { name: '看看棋盘' }).click()

  await page.getByRole('button', { name: '复盘', exact: true }).click()
  const branch = page.getByTestId(/^record-/).filter({ hasText: '27 手' })
  await expect(branch).toHaveCount(1)
  await expect(page.getByTestId(/^record-/).filter({ hasText: '47 手' })).toHaveCount(1)

  await page.getByTestId(/^record-/).filter({ hasText: '47 手' }).click()
  await expect(page.getByTestId('move-counter')).toHaveText('0 / 47')

  await page.reload()
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await expect(page.getByTestId(/^record-/).filter({ hasText: '27 手' })).toHaveCount(1)
  await expect(page.getByTestId(/^record-/).filter({ hasText: '47 手' })).toHaveCount(1)
})
