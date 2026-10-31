import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Segmented } from './Segmented'

const OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const

/** 受控组件：不接状态就没有可测的语义。 */
function Harness({ onChange }: { onChange?: (value: string) => void } = {}) {
  const [value, setValue] = useState<string>('light')
  return (
    <Segmented
      label="主题"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

function radios() {
  return screen.getAllByRole('radio')
}

describe('Segmented 的键盘可达性', () => {
  /*
   * radiogroup 的既定模式：**整组只有一个 Tab 停靠点**，组内用方向键移动。
   * 现状是每个选项各自 `tabIndex=0`——Tab 要按四次才能穿过去，而且方向键完全没反应。
   * 这两条都是用户能直接感觉到的：读屏软件会念「单选按钮 1 / 3」，
   * 然后按方向键什么都不会发生。
   */

  it('整组只有当前选中项是可 Tab 到的（roving tabindex）', () => {
    render(<Harness />)

    const stops = radios().filter((item) => item.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveAccessibleName('浅色')
  })

  it('方向键把选中项移到相邻选项，并把焦点真的搬过去', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.tab()
    expect(radios()[1]).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('dark')
    // 只改选中而不搬焦点，键盘用户会在原地打转——读屏跟的是真实焦点
    expect(radios()[2]).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('light')
    expect(radios()[1]).toHaveFocus()
  })

  it('到两端即停，不绕回另一头', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.tab()
    // 已经在中间，先走到最右
    await user.keyboard('{ArrowRight}')
    expect(radios()[2]).toHaveFocus()

    onChange.mockClear()
    await user.keyboard('{ArrowRight}')
    expect(onChange).not.toHaveBeenCalled()
    expect(radios()[2]).toHaveFocus()
  })

  it('上下键与左右键等效（radiogroup 的两种惯例都要支持）', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith('dark')
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith('light')
  })

  it('Home / End 跳到两端', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.tab()
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('system')
    expect(radios()[0]).toHaveFocus()

    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('dark')
    expect(radios()[2]).toHaveFocus()
  })
})

describe('Segmented 的焦点跟随外部改值', () => {
  /*
   * 对战页换模式/执子走的是确认弹窗：弹窗关闭后会把焦点还给打开它的旧选项，
   * 而那个选项此时已经 `tabIndex=-1`。焦点必须跟到新的停靠点上。
   */
  it('焦点在组内时，外部改掉选中项会把焦点搬到新的停靠点', () => {
    function External() {
      const [value, setValue] = useState<string>('light')
      return (
        <>
          <button type="button" onClick={() => setValue('dark')}>
            外部切换
          </button>
          <Segmented label="主题" value={value} options={OPTIONS} onChange={() => {}} />
        </>
      )
    }
    render(<External />)

    screen.getByRole('radio', { name: '浅色' }).focus()
    fireEvent.click(screen.getByRole('button', { name: '外部切换' }))

    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '深色' }))
  })

  it('焦点不在组内时不抢焦点', () => {
    function External() {
      const [value, setValue] = useState<string>('light')
      return (
        <>
          <button type="button" onClick={() => setValue('dark')}>
            外部切换
          </button>
          <Segmented label="主题" value={value} options={OPTIONS} onChange={() => {}} />
        </>
      )
    }
    render(<External />)

    const trigger = screen.getByRole('button', { name: '外部切换' })
    trigger.focus()
    fireEvent.click(trigger)

    expect(document.activeElement).toBe(trigger)
  })
})

describe('Segmented 的语义', () => {
  it('是一个带名字的 radiogroup，选项带 aria-checked', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: '主题' })).toBeInTheDocument()
    const items = radios()
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  it('点击仍然能换选项（键盘改动不影响既有路径）', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: '深色' }))
    expect(onChange).toHaveBeenLastCalledWith('dark')
  })

  it('禁用的选项会被跳过，方向键不停在它上面', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    // 必须是**受控**的：选中不跟着变的话，下一次方向键还是从旧的选中项出发，
    // 测的就不是「跳过禁用项」，而是「组件没被重新渲染」。
    function KeyHarness() {
      const [value, setValue] = useState('medium')
      return (
        <Segmented
          label="难度"
          value={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
          options={[
            { value: 'easy', label: '初级' },
            { value: 'medium', label: '中级' },
            { value: 'expert', label: '专家', disabled: true },
          ]}
        />
      )
    }

    render(<KeyHarness />)

    await user.click(screen.getByRole('radio', { name: '初级' }))
    expect(onChange).toHaveBeenLastCalledWith('easy')

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('medium')
    expect(screen.getByRole('radio', { name: '中级' })).toHaveFocus()

    onChange.mockClear()
    await user.keyboard('{ArrowRight}')
    // 右边那个是禁用的，不能停上去
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: '中级' })).toHaveFocus()
  })
})

/**
 * `beforeChange`：让调用方**否决**一次变更。
 *
 * 对战页要用它做防误触确认——「切换模式会重开一局，先问一句」。
 * 没有这个口子的话，键盘路径会留下一个坏状态：`moveTo` 是「先 `onChange` 再搬焦点」，
 * 而拦截挂在 `onChange` 上，于是方向键 → 弹确认 → 取消之后，
 * **焦点落在那个 `aria-checked=false` 且 `tabIndex=-1` 的选项上**：
 * 整组的 Tab 停靠点说选中的是 A，焦点却在 B。
 */
describe('Segmented 的 beforeChange 拦截钩子', () => {
  function VetoHarness({ beforeChange }: { beforeChange: (next: string) => boolean }) {
    const [value, setValue] = useState<string>('light')
    return (
      <Segmented
        label="对战模式"
        value={value}
        options={OPTIONS}
        beforeChange={beforeChange}
        onChange={setValue}
      />
    )
  }

  it('否决时键盘不换选中，也不把焦点搬过去', async () => {
    const user = userEvent.setup()
    render(<VetoHarness beforeChange={() => false} />)

    const current = screen.getByRole('radio', { name: '浅色' })
    current.focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('radio', { name: '浅色' })).toHaveAttribute('aria-checked', 'true')
    // 焦点必须还在**选中项**上——这是 roving tabindex 的既定含义
    expect(current).toHaveFocus()
  })

  it('否决时点击也不换选中，并把焦点收回选中项', async () => {
    const user = userEvent.setup()
    render(<VetoHarness beforeChange={() => false} />)

    await user.click(screen.getByRole('radio', { name: '深色' }))

    const current = screen.getByRole('radio', { name: '浅色' })
    expect(current).toHaveAttribute('aria-checked', 'true')
    expect(current).toHaveFocus()
  })

  it('放行时一切照旧', async () => {
    const user = userEvent.setup()
    render(<VetoHarness beforeChange={() => true} />)

    await user.click(screen.getByRole('radio', { name: '深色' }))

    expect(screen.getByRole('radio', { name: '深色' })).toHaveAttribute('aria-checked', 'true')
  })
})

/**
 * 点「已经选中的那一项」。
 *
 * radiogroup 的既定语义：再次激活选中项**不产生变更事件**。少了这条判断，
 * 会重建棋局的调用方（`setMode` / `setHumanColor` 都走 `newGame`）就会被
 * 「点一下当前高亮的选项」把进行中的棋局清掉——而且本阶段加了确认之后，
 * 还会先弹一句「切换对战模式？」，用户根本没切换什么。
 *
 * 键盘路径（`moveTo`）一直是判的，这条补的是点击路径的对称性。
 */
describe('Segmented 点已选中的那一项', () => {
  /*
   * 计数器放在**组件外面**：建在组件里的话，`setValue` 触发的那次重渲染
   * 会造出两个全新的 mock，读到的永远是 0——这正是本用例第一版的样子。
   */
  const onChange = vi.fn()
  const beforeChange = vi.fn(() => true)

  function Counting() {
    const [value, setValue] = useState('light')

    return (
      <Segmented
        label="主题"
        value={value}
        options={OPTIONS}
        beforeChange={beforeChange}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
      />
    )
  }

  beforeEach(() => {
    onChange.mockClear()
    beforeChange.mockClear()
  })

  it('再点一次已选中的项：既不问 beforeChange，也不调 onChange', async () => {
    const user = userEvent.setup()
    render(<Counting />)

    await user.click(screen.getByRole('radio', { name: '浅色' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(beforeChange).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: '浅色' })).toHaveAttribute('aria-checked', 'true')
    // 但焦点要落在它身上——用户刚点过它
    expect(screen.getByRole('radio', { name: '浅色' })).toHaveFocus()
  })

  /**
   * F-UI-27：`SegmentedOption` 上原有一个 `hint` 覆盖字段，**没有任何调用方用过**。
   * 删掉之后悬停提示仍然在（取的就是标签本身）——窄栏里标签会被 `truncate`
   * 截断，得留一条看全文的路。
   */
  it('悬停提示是标签本身', () => {
    render(<Harness />)

    expect(screen.getByRole('radio', { name: '跟随系统' })).toHaveAttribute('title', '跟随系统')
    expect(screen.getByRole('radio', { name: '深色' })).toHaveAttribute('title', '深色')
  })

  it('点别的项照旧：问一次、改一次', async () => {
    const user = userEvent.setup()
    render(<Counting />)

    await user.click(screen.getByRole('radio', { name: '深色' }))

    expect(beforeChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('dark')
    expect(screen.getByRole('radio', { name: '深色' })).toHaveAttribute('aria-checked', 'true')
  })
})
