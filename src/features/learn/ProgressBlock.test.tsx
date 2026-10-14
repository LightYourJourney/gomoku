import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgressBlock } from './ProgressBlock'

const TEXTS = {
  loading: '正在读取进度…',
  doneLabel: '已完成',
  unit: '节',
  action: '继续学习',
  allDone: '全部完成了。',
} as const

function setup(overrides: Partial<Parameters<typeof ProgressBlock>[0]> = {}) {
  return render(
    <ProgressBlock
      loaded
      done={3}
      total={8}
      testId="demo-progress"
      texts={TEXTS}
      next={{ title: '活二与眠二', run: () => {} }}
      {...overrides}
    />,
  )
}

/**
 * 这一组是**组件级**的用例：只管这个块自己的契约（载入占位、aria、testId 派生、
 * 主操作的取舍）。「它真的出现在教学页 / 残局页上、文案对不对」属于集成，
 * 留在 `screens.test.tsx` 里——两个层次不该混。
 */
describe('ProgressBlock', () => {
  /**
   * 载入态**不许出现任何数字**。
   *
   * 这不是小气：进度没读出来时说「已完成 0 / 8 节」是在说一件还不知道的事
   * （存储里可能记着 7 节）。占位块连「0」都不含，所以整个块的文本里
   * 一个阿拉伯数字都不该有。
   */
  it('载入时给占位，而且一个数字都不出现', () => {
    setup({ loaded: false })

    const placeholder = screen.getByTestId('demo-progress-loading')
    expect(placeholder).toHaveAttribute('aria-busy', 'true')
    expect(placeholder).toHaveTextContent(TEXTS.loading)
    expect(placeholder.textContent).not.toMatch(/\d/)

    // 真实块与主操作都不该在场
    expect(screen.queryByTestId('demo-progress-block')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('读出来之后：计数、进度条、aria 三件套都来自真实状态', () => {
    setup({ done: 3, total: 8 })

    expect(screen.getByTestId('demo-progress')).toHaveTextContent('已完成 3 / 8 节')

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '8')

    // 37.5% → 38%
    expect(screen.getByTestId('demo-progress-bar')).toHaveStyle({ width: '38%' })
  })

  it('总量为 0 时不算出 NaN，退到 0%', () => {
    setup({ done: 0, total: 0 })

    expect(screen.getByTestId('demo-progress-bar')).toHaveStyle({ width: '0%' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '0')
  })

  it('主操作把目的地写在脸上，点了就回调', () => {
    const run = vi.fn()
    setup({ next: { title: '活二与眠二', run } })

    fireEvent.click(screen.getByRole('button', { name: '继续学习：活二与眠二' }))

    expect(run).toHaveBeenCalledTimes(1)
  })

  /**
   * 全部完成时**没有主操作**，只有一句话。
   *
   * 这条不是排版偏好：「一屏最多一个 primary」管的是按钮，
   * 而全完成时根本没有「下一步」可做——留一颗按不动的按钮或者另造一个去处，
   * 都是为凑数而生的界面。
   */
  it('全部完成时给完成文案，不给按钮', () => {
    setup({ done: 8, total: 8, next: null })

    expect(screen.getByText(TEXTS.allDone)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  /**
   * `testId` 是**契约**，四个派生点一个都不能少。
   *
   * 两页各有一个已存在的抓手（`learn-progress` / `puzzle-progress`），
   * 而 e2e、组件测试、探针的 boot 都在用它。把这条钉在这里，
   * 将来谁改了派生规则（比如把 `-bar` 去掉）会当场红，而不是等到 e2e 跑超时。
   */
  it('四个测试点都由 testId 前缀派生', () => {
    const { unmount } = setup()
    expect(screen.getByTestId('demo-progress')).toBeInTheDocument()
    expect(screen.getByTestId('demo-progress-block')).toBeInTheDocument()
    expect(screen.getByTestId('demo-progress-bar')).toBeInTheDocument()
    unmount()

    setup({ loaded: false })
    expect(screen.getByTestId('demo-progress-loading')).toBeInTheDocument()
  })
})
