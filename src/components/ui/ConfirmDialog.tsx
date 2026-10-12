import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /**
   * **后果描述**，写「会发生什么」，不是「你确定吗」。
   *
   * 「这一步不可撤销」这类话不解决任何问题——玩家需要知道的是
   * 哪一局会被丢掉、丢了之后还剩什么。对战页四处确认的文案见 `BattleScreen` 的
   * `CONFIRM_TEXT`。
   */
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** 破坏性操作用 `danger`（认输）。默认的确认用 `primary`。 */
  tone?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 确认弹窗。**建在 `Modal` 上，不是另写一遍浮层**——焦点搬运、Tab 循环、
 * Escape、`aria-modal` 这些 `Modal` 已经做对了，复制一份就是两处各错各的。
 *
 * 两条交互语义：
 *
 * - **Escape = 取消**。确认弹窗里 Escape 的既定含义就是「不做了」，
 *   接给 `onCancel` 而不是「关掉了但什么都没决定」。
 * - **按钮顺序：取消在左、确认在右**，用 DOM 顺序表达（不是 `flex-row-reverse`），
 *   Tab 顺序才与视觉顺序一致。与 `Modal` 的既定约定相同。
 *
 * 焦点：`Modal` 打开时把焦点搬到对话框容器上，读屏软件因此会念出标题与后果描述；
 * 关闭时若焦点还在框内，`Modal` 会把它还给打开它的那个控件（见 `Modal` 的注释）。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button block onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            block
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description}
    </Modal>
  )
}
