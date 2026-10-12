import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
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
   * **不传就不动焦点**（落到 `<body>`，也就是本项目此前的行为）。
   * 为什么不做成「自动还给打开它的那个元素」：本应用唯一的弹窗是终局结果弹窗，
   * 它**不是被某个控件打开的**（对局结束就自动弹），而且打开前持有焦点的元素
   * 在对局结束时必然变得不可聚焦——五连终局时整盘 `interactive` 变假、格子
   * 失去 `tabindex`；认输终局时那个按钮已 `disabled`。实测两条路径还原都不生效。
   * 所以这里把「关掉之后焦点该去哪」交给调用方明确指定。
   */
  focusAfterClose?: RefObject<HTMLElement | null>
}

/** 弹窗内可聚焦的元素。`[tabindex]` 那一支排除了 -1（不可 Tab 到的）。 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, title, onClose, children, footer, focusAfterClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

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
   * **这里刻意没有「关闭后把焦点还给打开它的那个元素」。**
   *
   * 加过，随后在真实 Chrome 里量了一遍（Playwright，终局的两条路径都跑过）：
   * 关闭之后 `document.activeElement` 一律是 `BODY`，还原从未生效——因为本应用
   * 唯一的 `Modal` 是终局结果弹窗，它的两条触发路径都会让「打开前持有焦点的
   * 元素」变得**不可聚焦**：
   *
   * - 五连终局：打开前焦点在刚点过的那一格 `<rect>` 上（`tabindex="-1"`），
   *   对局一结束整盘 `interactive` 变假、`tabindex` 被摘掉，`focus()` 成了空操作；
   * - 认输终局：打开前焦点在「认输」按钮上，而它随后 `disabled`，同样聚焦不了。
   *
   * 那段代码在当前产品里**永远不会生效、也无法被验证**，按「最小代码、不做没
   * 验证的复杂度」撤掉了。底层问题（关掉弹窗后键盘用户要从页面开头重新 Tab）
   * 是真的，属**产品决策**——落到哪个元素取决于产品想要什么。记为 F-28。
   */
  useEffect(() => {
    if (!open) return

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
      // 关闭后把焦点送到调用方指定的地方。没指定就什么都不做。
      focusTarget?.focus()
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
        tabIndex={-1}
        className={cx(
          'w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-panel outline-none',
          motionClass('panelIn'),
        )}
      >
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <div className="mt-3 text-sm text-muted">{children}</div>
        {footer !== undefined && <div className="mt-5 flex gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
