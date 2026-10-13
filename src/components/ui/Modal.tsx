import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { cx } from '../../lib/cx'
import { motionClass } from '../../lib/motion'
import { createPortal } from 'react-dom'

export interface ModalProps {
  open: boolean
  title: string
  onClose?: () => void
  children: ReactNode
  footer?: ReactNode
  /**
   * 关闭之后把焦点送到这个元素上。
   *
   * 传了就按传的来（终局弹窗指定为「重新开始」按钮，它是对局结束后棋盘上唯一
   * 还有意义的操作）。**不传**时走下面那条「还给打开它的控件」的规则。
   */
  focusAfterClose?: RefObject<HTMLElement | null>
}

/** 弹窗内可聚焦的元素。`[tabindex]` 那一支排除了 -1（不可 Tab 到的）。 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 关闭弹窗时还能不能把焦点还回去。
 *
 * **只有一个条件：打开时确实有东西持有焦点。** 一开始写的版本还查了
 * 「是否已禁用」「`tabindex` 是不是 -1」「节点还在不在文档里」，反向验证时发现
 * 那三条**全都观测不到**——禁用控件与已卸载的节点本来就 `focus()` 不动，
 * 浏览器与 jsdom 都不会把焦点给它们，撤掉判据用例照样绿。
 * 观测不到的判据就是没有判据，按「不做没验证的复杂度」删掉。
 */
function canRestoreFocus(element: HTMLElement | null): element is HTMLElement {
  return element !== null && element !== document.body
}

export function Modal({ open, title, onClose, children, footer, focusAfterClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  /**
   * 正文的 id：对话框用 `aria-describedby` 指向它。
   *
   * 只有 `aria-label` 的话，读屏软件念出标题就停了——**后果描述读不到**，
   * 而「清楚的标题与后果描述」是任务书对确认弹窗的硬要求。
   * 顺带把 `ConfirmDialog` 头顶那句承诺变成真的。
   */
  const bodyId = useId()

  /**
   * 把最新的 `onClose` 放进 ref，好让下面的 effect 只依赖 `open`。
   *
   * 不能把 `onClose` 写进依赖数组：调用方传的多半是内联箭头函数，每次渲染都换
   * 引用，effect 于是每渲染一次就重跑一遍——重跑会给 `document` 重新挂一遍
   * 键盘处理器，还会把弹窗自己再 `focus()` 一次。
   */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  /*
   * **「关闭后把焦点还给打开它的那个控件」为什么加过又撤掉、这次又加回来。**
   *
   * 加过、撤掉的那一次（F-28）：当时本应用唯一的 `Modal` 是终局结果弹窗，
   * 它**不是被某个控件打开的**（对局结束自动弹），而打开前持有焦点的元素在对局结束时
   * 必然变得不可聚焦——五连终局时整盘 `interactive` 变假、格子失去 `tabindex`；
   * 认输终局时「认输」按钮已 `disabled`。实测两条路径还原都不生效，
   * 于是按「不做没验证的复杂度」撤掉了。
   *
   * Phase 02 加回来，因为**确认弹窗的形态不一样**：它是被按钮点开的，
   * 触发控件在关闭之后仍然有效（唯一例外是「认输」，那时终局弹窗会接管焦点）。
   * 而且这次它有可红的判据：`Modal.test.tsx` 里那条「取消之后焦点回到触发它的按钮」。
   *
   * 两条规则并存，优先级明确：
   *
   * 1. 调用方给了 `focusAfterClose` → 听调用方的（终局弹窗走这条，行为与之前逐字相同）。
   * 2. 否则，**且关闭这一刻焦点已经掉到 `<body>`** → 还给打开时持有焦点的那个控件。
   *    为什么必须加「已经掉到 body」这个前提：弹窗开着的时候焦点有可能被别处拿走
   *    （程序化 `focus()`、浏览器行为），那种情况下抢回来是帮倒忙。
   *    `Modal.test.tsx` 有一条用例专门钉住这个前提。
   */
  useEffect(() => {
    if (!open) return

    // **必须在把焦点搬进弹窗之前取**——下面那一行一执行，activeElement 就变了。
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    dialogRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return

      const root = dialogRef.current
      if (root === null) return

      /*
       * `aria-modal="true"` 向读屏软件声明「弹窗外的东西是惰性的」，
       * 那 Tab 就必须真的出不去——否则是声明了一件假的事。
       *
       * jsdom 不做真实的 Tab 顺序，所以这条只能靠这里的显式循环 +
       * `e2e/a11y.spec.ts` 里的一条 Playwright 用例共同保证。
       */
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }

      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      const inside = active !== null && root.contains(active)

      const leftTheStart = event.shiftKey && (active === first || !inside)
      const leftTheEnd = !event.shiftKey && (active === last || !inside)

      if (leftTheStart || leftTheEnd) {
        event.preventDefault()
        const wrapTo = event.shiftKey ? last : first
        wrapTo.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    // 在 effect 里取一次 DOM 节点，cleanup 用这个局部变量。
    // 不要在 cleanup 里读 `focusAfterClose.current`（exhaustive-deps 会告警，
    // 而且那条告警有道理：清理时 ref 指向的节点可能已经换过了）。
    // 这里「重新开始」按钮在对局结束前后是同一个 DOM 节点，取一次就够了。
    const focusTarget = focusAfterClose?.current ?? null

    return () => {
      document.removeEventListener('keydown', handleKeyDown)

      // 调用方指定了去处就听它的。
      if (focusTarget !== null) {
        focusTarget.focus()
        return
      }

      // 焦点已经被别处拿走（不是卸载导致的 body），就别抢。
      const active = document.activeElement
      if (active !== null && active !== document.body) return

      if (canRestoreFocus(opener)) opener.focus()
    }
  }, [open, focusAfterClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={cx(
          // 浮层用 shadow-overlay：它压在整页之上，比面板高一档
          'w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-overlay outline-none',
          motionClass('panelIn'),
        )}
      >
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <div id={bodyId} className="mt-3 text-body text-muted">
          {children}
        </div>
        {/*
          按钮顺序：**次要操作在左、主操作在右**。
          用 DOM 顺序表达，不用 `flex-row-reverse`——反排会让 Tab 顺序与视觉顺序相反，
          键盘用户从右往左跳，看起来像界面错了。
        */}
        {footer !== undefined && <div className="mt-5 flex gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
