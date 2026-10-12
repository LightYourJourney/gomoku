import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Switch } from './Switch'

function Harness({ onChange }: { onChange?: (next: boolean) => void } = {}) {
  const [checked, setChecked] = useState(false)
  return (
    <Switch
      label="显示坐标"
      description="棋盘四周标注 A–O / 1–15"
      checked={checked}
      onChange={(next) => {
        setChecked(next)
        onChange?.(next)
      }}
    />
  )
}

describe('Switch 的可访问名与说明', () => {
  /*
   * 说明文字是**补充**，不是名字的一部分。
   * 现在两者都在同一个 `<button>` 里，可访问名变成「显示坐标棋盘四周标注 A–O / 1–15」——
   * 读屏用户听到的名字取决于说明写多长，而且每次都要把那串标注念完才知道这是哪一个开关。
   */
  it('可访问名只有标签本身', () => {
    render(<Harness />)
    expect(screen.getByRole('switch')).toHaveAccessibleName('显示坐标')
  })

  it('说明通过 aria-describedby 关联，仍在无障碍树里读得到', () => {
    render(<Harness />)

    const control = screen.getByRole('switch')
    const describedBy = control.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()

    const description = document.getElementById(describedBy!)
    expect(description).not.toBeNull()
    expect(description).toHaveTextContent('棋盘四周标注 A–O / 1–15')
    expect(control).toHaveAccessibleDescription('棋盘四周标注 A–O / 1–15')
  })

  it('没有说明时不生成空的 aria-describedby', () => {
    render(<Switch label="落子音效" checked={false} onChange={() => {}} />)

    expect(screen.getByRole('switch')).toHaveAccessibleName('落子音效')
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toBeNull()
  })
})

describe('Switch 的行为', () => {
  it('切换时回调取反并更新 aria-checked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const control = screen.getByRole('switch')
    expect(control).toHaveAttribute('aria-checked', 'false')

    await user.click(control)
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(control).toHaveAttribute('aria-checked', 'true')
  })

  it('整行都是点击目标', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByText('显示坐标'))
    expect(onChange).toHaveBeenLastCalledWith(true)
  })
})
