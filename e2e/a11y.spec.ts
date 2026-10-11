import { expect, test } from '@playwright/test'

/**
 * 无障碍与动效的验收。
 *
 * 这一组跑在真实 Chrome 里——键盘、焦点、`prefers-reduced-motion` 这些
 * 只有真浏览器才说得清；jsdom 既不跑 CSS 动画，也没有真正的焦点模型。
 */

/** 用本地双人模式：没有 AI 应手，刚落下的那颗子会一直是「最新一手」——
   人机模式里 AI 会在断言前抢先落子，那颗子就不再带落下动效了。 */
async function playOneMove(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('radio', { name: '本地双人' }).click()
  await page.getByTestId('intersection-7-7').click()
  await expect(page.getByTestId('stone-7-7')).toHaveAttribute('data-last', 'true')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e-fresh') !== null) return
    window.localStorage.clear()
    window.sessionStorage.setItem('e2e-fresh', '1')
    indexedDB.deleteDatabase('gomoku-lab')
  })
})

test.describe('prefers-reduced-motion', () => {
  test.describe('系统要求减少动态时', () => {
    test.use({ reducedMotion: 'reduce' })

    test('落子不发生位移与缩放动画', async ({ page }) => {
      await playOneMove(page)

      // 真的问浏览器要 computed style，而不是读源码猜
      await expect(page.getByTestId('stone-7-7')).toHaveCSS('animation-name', 'none')
    })
  })

  test.describe('没有该偏好时（对照组）', () => {
    test('同一颗子确实带落下动效——否则上一条断言等于没测', async ({ page }) => {
      await playOneMove(page)

      await expect(page.getByTestId('stone-7-7')).toHaveCSS('animation-name', 'motion-stone-drop')
    })
  })
})
