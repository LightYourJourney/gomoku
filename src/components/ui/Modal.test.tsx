import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
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


/**
 * `focusAfterClose`：关闭弹窗之后焦点送到哪里。
 *
 * 本应用里这个目标由 `BattleScreen` 明确指定为「重新开始」按钮。
 * 之所以不做成「自动还给打开弹窗的元素」：终局弹窗不是被某个控件打开的
 * （对局结束就自动弹），而且打开前持有焦点的元素在对局结束时必然不可聚焦
 * ——实测两条路径（五连 / 认输）还原都不生效，见 `Modal` 里的注释。
 *
 * **Phase 02 补上了另一半**：确认弹窗**是**被按钮点开的，触发控件关掉之后仍然有效，
 * 所以「不传 `focusAfterClose` 时把焦点还给打开它的那个控件」对它是成立的、
 * 也是可验证的。下面那组用例证明它。
 */
describe('Modal 的 focusAfterClose', () => {
  function WithTarget() {
    const [open, setOpen] = useState(true)
    const target = useRef<HTMLButtonElement>(null)

    return (
      <>
        <button ref={target} type="button">
          重新开始
        </button>
        <Modal open={open} title="本局结束" onClose={() => setOpen(false)} focusAfterClose={target}>
          内容
        </Modal>
      </>
    )
  }

  it('关闭后焦点落到指定元素上', () => {
    render(<WithTarget />)

    expect(screen.getByRole('dialog')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button', { name: '重新开始' })).toHaveFocus()
  })

  it('不传这个 prop 时不动焦点（既有行为）', () => {
    function Plain() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button">别处的按钮</button>
          <Modal open={open} title="本局结束" onClose={() => setOpen(false)}>
            内容
          </Modal>
        </>
      )
    }
    render(<Plain />)
    const other = screen.getByRole('button', { name: '别处的按钮' })
    other.focus()

    fireEvent.keyDown(document, { key: 'Escape' })

    // 焦点留在原处不动——弹窗卸载不会把它「送」去任何地方
    expect(other).toHaveFocus()
  })
})

/**
 * 确认弹窗要的那一条：**取消之后焦点回到打开它的那个控件**。
 *
 * 与上面最后一条并不矛盾，两者管的是不同的事：
 * 那条测的是「弹窗开着的时候焦点被别人拿走了」——关闭时不该抢回来；
 * 这条测的是「焦点还在弹窗里」——弹窗一卸载它就没地方可去了，得还回操作位置。
 * 判据就是「关闭那一刻焦点是不是已经掉到 `<body>`」，见 `Modal` 里的注释。
 */
describe('Modal 关闭时把焦点还给打开它的控件', () => {
  /** 用一个真实可点的按钮打开弹窗——这正是确认弹窗的形态。 */
  function Opened() {
    const [open, setOpen] = useState(false)

    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          认输
        </button>
        <Modal open={open} title="认输？" onClose={() => setOpen(false)}>
          这一局会记为对方获胜。
        </Modal>
      </>
    )
  }

  it('取消之后焦点回到触发它的按钮', () => {
    render(<Opened />)

    // jsdom 派发 click **不会**像真浏览器那样把焦点给按钮，所以这里显式补上这一步
    // ——不补的话下面测的就成了「焦点本来就在 body，还回 body」，等于没测。
    const trigger = screen.getByRole('button', { name: '认输' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button', { name: '认输' })).toHaveFocus()
  })

  it('弹窗开着时焦点被别处拿走，关闭时就不抢回来', () => {
    /**
     * 这条与上面那条管的是两件不同的事，**判据是「关闭那一刻焦点在哪」**：
     *
     * - 焦点还在弹窗里 → 弹窗一卸载它就没地方可去了，还回操作位置；
     * - 焦点已经被别处拿走 → 抢回来是帮倒忙。
     *
     * 这条**有鉴别力**：把 `Modal` 里那句「焦点不是 body 就不动」删掉，它立刻变红
     * （反向验证过）。而先前那条「触发控件已禁用」的写法没有鉴别力——
     * 禁用控件本来就 `focus()` 不动，撤掉判据它照样绿，所以删了。
     */
    function TwoButtons() {
      const [open, setOpen] = useState(false)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开
          </button>
          <button type="button">别处的按钮</button>
          <Modal open={open} title="确认" onClose={() => setOpen(false)}>
            内容
          </Modal>
        </>
      )
    }
    render(<TwoButtons />)

    const opener = screen.getByRole('button', { name: '打开' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toHaveFocus()

    const other = screen.getByRole('button', { name: '别处的按钮' })
    other.focus()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(other).toHaveFocus()
  })
})
