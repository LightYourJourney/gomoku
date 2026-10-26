import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { BLACK } from '../src/core/types'
import { seedGameRecords } from './helpers/seed'

/**
 * 生产构建的冒烟验收（`yarn e2e:prod`，见 playwright.prod.config.ts）。
 *
 * 跑的是 `dist` 里的产物，不是 dev server。不追求覆盖全部功能——那由主通道
 * 负责——只盯「构建之后才会坏」的几件事：Worker 的 module 加载、样式打包、
 * 首页之外的页面能不能进。
 */

test('首屏渲染出棋盘，状态条说轮到玩家', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('样式真的生效：棋盘是被 CSS 撑起来的正方形，不是裸 SVG', async ({ page }) => {
  await page.goto('/')

  const box = await page.getByTestId('board').boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return

  // 裸 SVG 的默认尺寸是 300×150；正方形且够大说明容器查询与 aspect-square 都生效了
  expect(box.width).toBeGreaterThan(300)
  expect(Math.abs(box.width - box.height)).toBeLessThan(1)

  // 主题变量由打包后的 CSS 注入；样式丢了这里就是空串
  const boardFace = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--c-board-a').trim(),
  )
  expect(boardFace).toMatch(/^(#|rgb|oklch)/)
})

test('AI 真的应手——Worker 在产物里的加载路径与 dev 不同，最容易断在这', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('intersection-7-7').click()

  await expect(page.getByTestId('stone-7-7')).toBeVisible()
  // 等 AI 落完第二手，轮次交还玩家
  await expect(page.getByTestId(/^stone-/)).toHaveCount(2, { timeout: 20_000 })
  await expect(page.getByTestId('status-pill')).toHaveText('轮到你落子')
})

test('完整下一局：九手成五、终局弹窗、入库——产物里从落子到持久化整条链路', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: '本地双人' }).click()

  // 黑棋第 7 行连五点、白棋在第 9 行陪走四点，第 9 手黑棋成五终局
  const moves: Array<[number, number]> = [
    [3, 7], [3, 9], [4, 7], [4, 9], [5, 7], [5, 9], [6, 7], [6, 9], [7, 7],
  ]
  for (const [x, y] of moves) {
    await page.getByTestId(`intersection-${x}-${y}`).click()
  }

  await expect(page.getByTestId(/^stone-/)).toHaveCount(9)
  // 本地双人没有「你」这个视角，终局文案是棋色（人机模式下才会说「你赢了」）
  await expect(page.getByRole('dialog')).toContainText('黑棋获胜')
  // IndexedDB 在产物里同样要能写进去
  await expect(page.getByText(/这局已存入棋谱库/)).toBeVisible()
})

test('构建版本标识可核对：应用版本、引擎版本与提交号', async ({ page }) => {
  await page.goto('/')

  const info = await page.evaluate(() => {
    const content = (name: string) =>
      document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? ''
    return {
      app: content('app-version'),
      engine: content('engine-version'),
      commit: content('build-commit'),
    }
  })

  // 版本号是有意的硬编码：升级版本却忘了改这里，说明发布记录也会漏。
  expect(info.app).toBe('0.4.0')
  expect(info.engine).toBe('search-1')

  // 只验 40 位十六进制不够——插件写死一个合法 SHA 也会通过。直接和当前
  // 检出比对：CI 必须完全相等；本地未提交的工作区允许 -dirty。
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  expect(info.commit).toMatch(process.env.CI ? new RegExp(`^${head}$`) : new RegExp(`^${head}(-dirty)?$`))
})

test('复盘页进得去——代码分割后的 chunk 在生产环境要能取到', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '复盘', exact: true }).click()

  await expect(page.getByRole('heading', { name: '复盘' })).toBeVisible()
  await expect(page.getByText('还没有保存的对局')).toBeVisible()
})


test('分享链接预览在生产构建与根路径下可解析', async ({ page }) => {
  await seedGameRecords(page, [
    {
      schemaVersion: 1,
      moves: [
        { x: 3, y: 7 }, { x: 3, y: 9 },
        { x: 4, y: 7 }, { x: 4, y: 9 },
        { x: 5, y: 7 }, { x: 5, y: 9 },
        { x: 6, y: 7 }, { x: 6, y: 9 },
        { x: 7, y: 7 },
      ],
      firstPlayer: BLACK,
      mode: 'pvp',
      humanColor: BLACK,
      difficulty: 'easy',
      resignedBy: null,
    },
  ])
  await page.goto('/')
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.getByTestId(/^record-/).first().click()
  await page.getByRole('button', { name: '分享棋谱' }).click()
  await page.getByRole('button', { name: '分享整盘' }).click()
  const link = await page.getByTestId('share-link').inputValue()
  await page.getByRole('button', { name: '关闭' }).click()

  await page.goto(link)
  await expect(page.getByTestId('share-kind')).toContainText('单盘棋谱')
  await expect(page.getByTestId('share-save')).toBeVisible()
})
