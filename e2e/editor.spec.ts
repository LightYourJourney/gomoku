import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

async function openEditor(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()
  await expect(page.getByRole('heading', { name: '局面研究' })).toBeVisible()
}

async function playNineMoveWin(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '对战', exact: true }).click()
  await page.getByRole('radio', { name: '本地双人' }).click()
  const moves: Array<[number, number]> = [
    [3, 7], [3, 9], [4, 7], [4, 9], [5, 7], [5, 9], [6, 7], [6, 9], [7, 7],
  ]
  for (const [x, y] of moves) await page.getByTestId(`intersection-${x}-${y}`).click()
  await expect(page.getByRole('dialog')).toContainText('黑棋获胜')
  await page.getByRole('button', { name: '看看棋盘' }).click()
}

test('编辑器：放黑/放白/擦除/撤销/重做/键盘', async ({ page }) => {
  await openEditor(page)

  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')

  await page.getByRole('button', { name: '工具：白棋' }).click()
  await page.getByTestId('intersection-8-8').click()
  await expect(page.getByTestId('stone-8-8')).toHaveAttribute('data-player', '2')

  await page.getByRole('button', { name: '工具：擦除' }).click()
  await page.getByTestId('intersection-8-8').click()
  await expect(page.getByTestId('stone-8-8')).toHaveCount(0)

  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.getByTestId('stone-8-8')).toBeVisible()
  await page.getByRole('button', { name: '重做' }).click()
  await expect(page.getByTestId('stone-8-8')).toHaveCount(0)

  await page.getByRole('button', { name: '工具：黑棋' }).click()
  const cell = page.getByTestId('intersection-9-9')
  await cell.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('stone-9-9')).toBeVisible()
})

test('编辑器：保存局面 → 刷新后重新打开', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('intersection-7-7').click()
  await page.getByLabel('局面名称').fill('斜月研究')
  await page.getByRole('button', { name: '保存局面' }).click()
  await expect(page.getByTestId('position-notice')).toContainText('已保存')

  await page.reload()
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()
  await page.getByLabel('打开已保存局面').selectOption({ label: '斜月研究' })
  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  await expect(page.getByTestId('position-saved-at')).toContainText(
    /最近保存：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
  )

  await page.getByRole('button', { name: '删除已保存局面' }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByTestId('position-notice')).toContainText('已删除')
  await expect(page.getByTestId('position-saved-at')).toHaveCount(0)
  await expect(page.getByTestId('stone-7-7')).toBeVisible()
})

test('编辑器：从合法棋谱载入第 9 手', async ({ page }) => {
  await playNineMoveWin(page)
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByRole('button', { name: '局面研究' }).click()

  await page.getByLabel('棋谱').selectOption({ index: 1 })
  await page.getByLabel('载入手数').fill('9')
  await page.getByRole('button', { name: '载入' }).click()

  await expect(page.getByTestId('position-kind')).toContainText('第 9 手')
  await expect(page.getByTestId(/^stone-/)).toHaveCount(9)
})

test('编辑器：AI 只读分析显示候选与搜索指标', async ({ page }) => {
  test.setTimeout(60_000)
  await openEditor(page)
  await page.getByTestId('intersection-7-7').click()
  await page.getByRole('button', { name: '工具：白棋' }).click()
  await page.getByTestId('intersection-8-8').click()

  await page.getByLabel('分析档位').selectOption('hard')
  await page.getByRole('button', { name: '分析当前局面' }).click()
  const panel = page.getByTestId('position-analysis')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel).toContainText('高级 · 1600ms')
  await expect(panel).toContainText('深度')
  await expect(panel).toContainText('节点')
  await expect(panel).toContainText('结论')
})

test('编辑器：导出局面文件 → 清空 → 导入恢复', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('intersection-7-7').click()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出局面文件' }).click(),
  ])
  const path = await download.path()
  expect(path).not.toBeNull()
  const file = JSON.parse(readFileSync(path!, 'utf8')) as { format: string; stones: unknown[] }
  expect(file.format).toBe('gomoku-lab.position')
  expect(file.stones).toHaveLength(1)

  await page.getByRole('button', { name: '清空' }).click()
  await expect(page.getByTestId('stone-7-7')).toHaveCount(0)
  await page.getByTestId('position-file').setInputFiles(path!)
  await expect(page.getByTestId('stone-7-7')).toBeVisible()
})

test('编辑器：双方五连的异常快照被明确指出', async ({ page }) => {
  await openEditor(page)
  for (const x of [0, 1, 2, 3, 4]) await page.getByTestId(`intersection-${x}-0`).click()
  await page.getByRole('button', { name: '工具：白棋' }).click()
  for (const x of [0, 1, 2, 3, 4]) await page.getByTestId(`intersection-${x}-1`).click()

  await expect(page.getByTestId('position-issues')).toContainText('同时五连')
  await expect(page.getByRole('button', { name: '分析当前局面' })).toBeDisabled()
})
