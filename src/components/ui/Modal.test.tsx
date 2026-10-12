import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开弹窗
      </button>
      <Modal
        open={open}
        title="本局结束"
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
        footer={
          <>
            <button type="button">第一颗</button>
            <button type="button">第二颗</button>
          </>
        }
      >
        内容
      </Modal>
    </>
  )
}

function openModal(): void {
  fireEvent.click(screen.getByRole('button', { name: '打开弹窗' }))
}

/**
 * **刻意不测「关闭后把焦点还给原处」。** 那段实现加过又撤掉了：在真实浏览器里
 * 量下来它从未生效——本应用唯一的弹窗是终局结果弹窗，两条触发路径都会让
 * 「打开前持有焦点的元素」变得不可聚焦（棋盘在对局结束时摘掉 tabindex、
 * 「认输」按钮随后 disabled）。细节见 `Modal.tsx` 里那段注释与 `FINDINGS.md` F-28。
 */

function activeText(): string {
  return document.activeElement?.textContent ?? ''
}

/**
 * `Modal` 声明了 `role="dialog" aria-modal="true"`，向读屏软件承诺
 * 「弹窗外的东西是惰性的」。**承诺了就必须做到**——否则是声明了一件假的事。
 *
 * 注意这里能测的只有「Tab 循环处理器的行为」与焦点搬运；**真实的 Tab 顺序
 * 只有浏览器有**，所以另有一条 Playwright 用例（`e2e/a11y.spec.ts`）。
 */
describe('Modal 的焦点管理', () => {
  it('打开时把焦点搬进弹窗', () => {
    render(<Harness />)
    openModal()

    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('Escape 关闭弹窗', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    openModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Tab 从最后一个可聚焦元素回到第一个，不逃出弹窗', () => {
    render(<Harness />)
    openModal()

    const last = screen.getByRole('button', { name: '第二颗' })
    last.focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(activeText()).toBe('第一颗')
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('Shift+Tab 从第一个回到最后一个', () => {
    render(<Harness />)
    openModal()

    const first = screen.getByRole('button', { name: '第一颗' })
    first.focus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(activeText()).toBe('第二颗')
  })

  it('焦点意外落到弹窗外时，下一次 Tab 把它拉回来', () => {
    const { rerender } = render(<Harness />)
    openModal()

    const opener = screen.getByRole('button', { name: '打开弹窗' })
    opener.focus() // 模拟焦点被别的东西抢走

    rerender(<Harness />)
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('没有可聚焦内容时不抛错，焦点留在弹窗上', () => {
    function Empty() {
      const [open, setOpen] = useState(true)
      return (
        <Modal open={open} title="空的" onClose={() => setOpen(false)}>
          只有文字
        </Modal>
      )
    }
    render(<Empty />)

    expect(() => fireEvent.keyDown(document, { key: 'Tab' })).not.toThrow()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})
