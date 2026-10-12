import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

function Harness({
  tone,
  onConfirm = vi.fn(),
  onCancel = vi.fn(),
}: {
  tone?: 'default' | 'danger'
  onConfirm?: () => void
  onCancel?: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开确认
      </button>
      <ConfirmDialog
        open={open}
        title="重新开始？"
        description="当前这局还没结束，已经下的 12 手会被清空。"
        confirmLabel="重新开始"
        tone={tone}
        onConfirm={() => {
          onConfirm()
          setOpen(false)
        }}
        onCancel={() => {
          onCancel()
          setOpen(false)
        }}
      />
    </>
  )
}

function open(): void {
  const trigger = screen.getByRole('button', { name: '打开确认' })
  // jsdom 派发 click 不会像真浏览器那样把焦点给按钮，显式补上——
  // 否则「焦点回到触发处」测的会变成「body 还回 body」。
  trigger.focus()
  fireEvent.click(trigger)
}

describe('ConfirmDialog', () => {
  it('打开时给出标题与后果描述，且是 dialog 语义', () => {
    render(<Harness />)

    open()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('重新开始？')
    // 后果描述必须说清「会丢掉什么」，不是「你确定吗」
    expect(dialog).toHaveTextContent('已经下的 12 手会被清空')
  })

  it('点确认只触发确认', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />)
    open()

    fireEvent.click(screen.getByRole('button', { name: '重新开始' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('点取消只触发取消', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />)
    open()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Escape 走取消，不是「关掉但什么都没决定」', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />)
    open()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    // 取消之后焦点回到触发它的按钮
    expect(screen.getByRole('button', { name: '打开确认' })).toHaveFocus()
  })

  it('破坏性操作用 danger 档', () => {
    render(<Harness tone="danger" />)
    open()

    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: '重新开始' })
    expect(confirm.className).toContain('danger')
  })
})
