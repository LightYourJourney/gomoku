import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ControlBar, type ControlBarProps } from './ControlBar'

function setup(overrides: Partial<ControlBarProps> = {}) {
  const onUndo = vi.fn()
  const onHint = vi.fn()
  const onRestart = vi.fn()
  const onResign = vi.fn()
  const props: ControlBarProps = {
    canUndo: true,
    canHint: true,
    hintThinking: false,
    canResign: true,
    onUndo,
    onHint,
    onRestart,
    onResign,
    ...overrides,
  }

  return { onUndo, onHint, onRestart, onResign, ...render(<ControlBar {...props} />) }
}

const NAMES = ['悔棋', '求提示', '重新开始', '认输'] as const

function button(name: (typeof NAMES)[number]): HTMLElement {
  return screen.getByRole('button', { name })
}

describe('ControlBar 的动作', () => {
  it('四颗按钮各调各的回调', async () => {
    const user = userEvent.setup()
    const spies = setup()

    for (const [name, spy] of [
      ['悔棋', spies.onUndo],
      ['求提示', spies.onHint],
      ['重新开始', spies.onRestart],
      ['认输', spies.onResign],
    ] as const) {
      await user.click(button(name))
      expect(spy).toHaveBeenCalledTimes(1)
    }
  })

  /**
   * 禁用条件**全部沿用 store 的判据**，工具栏自己不发明规则。
   * 这里钉的是「判据有没有接上」，不是判据本身——`canUndo` / `canHumanPlay`
   * 的语义由 `gameStore.test.ts` 守。
   */
  it('悔棋按 canUndo 禁用', () => {
    setup({ canUndo: false })

    expect(button('悔棋')).toBeDisabled()
  })

  /**
   * 「求提示」的两个禁用来源：轮不到自己（`canHumanPlay` 为假），
   * 以及**已经有一个提示请求在飞**（`hintThinking`）。
   * 后者不能漏——漏了就能连点，而提示与落子共用同一只引擎。
   */
  it('求提示按 canHint 禁用', () => {
    setup({ canHint: false })

    expect(button('求提示')).toBeDisabled()
  })

  it('提示正在算的时候求提示也禁用，防止连点', () => {
    setup({ hintThinking: true })

    expect(button('求提示')).toBeDisabled()
  })

  it('终局后认输与悔棋都不可用', () => {
    setup({ canResign: false, canUndo: false })

    expect(button('认输')).toBeDisabled()
    expect(button('悔棋')).toBeDisabled()
  })

  it('重新开始永远可用——终局之后它是棋盘上唯一还有意义的操作', () => {
    setup({ canUndo: false, canResign: false })

    expect(button('重新开始')).toBeEnabled()
  })
})

describe('ControlBar 的层级', () => {
  /**
   * `DESIGN_SYSTEM.md` §6.1：`primary` 是「当前唯一的下一步」，**一屏最多一个**。
   * 四颗按钮里只有「求提示」该是它（它是主动去问引擎的那颗）。
   */
  it('四颗里恰好一颗是 primary，且是求提示', () => {
    setup()

    const primaries = NAMES.map(button).filter((el) =>
      el.className.split(/\s+/).includes('bg-accent'),
    )

    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveAccessibleName('求提示')
  })

  /**
   * 认输是破坏性操作：**保持可发现，但与普通操作分开**（任务书 §四）。
   * `ml-auto` 把它推到行的另一端，窄屏换行时它落在自己那一行的右端。
   */
  it('认输被推到另一端，不与普通操作挤在一起', () => {
    setup()

    expect(button('认输').className.split(/\s+/)).toContain('ml-auto')
    expect(button('悔棋').className.split(/\s+/)).not.toContain('ml-auto')
  })

  it('认输用 danger 档，不靠文案吓人', () => {
    setup()

    expect(button('认输').className).toContain('bg-danger-soft')
  })
})
