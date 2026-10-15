import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReplayTimeline } from './ReplayTimeline'

function setup(cursor: number, total: number) {
  const onSeek = vi.fn()
  render(<ReplayTimeline cursor={cursor} total={total} onSeek={onSeek} />)
  return { onSeek, slider: screen.getByRole('slider', { name: '回放手数' }) }
}

describe('ReplayTimeline', () => {
  it('滑块的量纲是手：min 0、max 总手数、当前值就是游标', () => {
    const { slider } = setup(3, 9)

    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '9')
    // jsdom 里 range 的 value 是**字符串**，不是数字
    expect(slider).toHaveValue('3')
  })

  it('拖动把手数报出去——调用方负责暂停，这里只管报数', () => {
    const { onSeek, slider } = setup(0, 9)

    fireEvent.change(slider, { target: { value: '5' } })

    expect(onSeek).toHaveBeenCalledWith(5)
  })

  it('边界：0 手与最后一手都在可动区间内', () => {
    // 起点取中间值——受控 input 设成**当前已有的值**时 React 不会派发事件，
    // 从 9 往 9 拖是测不出东西的（第一版就是这么写的，红了一次）
    const { onSeek, slider } = setup(3, 9)

    fireEvent.change(slider, { target: { value: '0' } })
    expect(onSeek).toHaveBeenCalledWith(0)

    fireEvent.change(slider, { target: { value: '9' } })
    expect(onSeek).toHaveBeenCalledWith(9)
  })

  it('读屏念的是「第 N 手，共 M 手」，不是裸数字', () => {
    const { slider } = setup(4, 9)

    // 默认读屏会念 "4"——这个控件的量纲是**手**，不换算一下没法理解
    expect(slider).toHaveAttribute('aria-valuetext', '第 4 手，共 9 手')
  })

  it('0 手认输局整条禁用——那时没有可动区间', () => {
    const { slider } = setup(0, 0)

    expect(slider).toBeDisabled()
    expect(slider).toHaveAttribute('max', '0')
  })

  it('命中区用 h-7 撑住，不是原生 range 的默认高度', () => {
    const { slider } = setup(0, 9)

    /*
     * 这是一条**结构**断言，量的活留给探针（`yarn ui:probe` 的判据 5：
     * 可交互元素 < 24px 直接判红，棋盘交叉点是唯一豁免）。
     * 这里守的是「别把它改回默认」——原生 range 的盒子只有约 16px 高。
     */
    expect(slider.className).toContain('h-7')
  })

  it('下方那行计数与游标同步', () => {
    setup(3, 9)

    expect(screen.getByTestId('timeline-counter')).toHaveTextContent('3 / 9 手')
  })
})
