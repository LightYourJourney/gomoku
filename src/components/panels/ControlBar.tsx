import type { Ref } from 'react'
import { Button } from '../ui/Button'

export interface ControlBarProps {
  canUndo: boolean
  canResign: boolean
  onUndo: () => void
  onRestart: () => void
  onResign: () => void
  /**
   * 「重新开始」按钮的 ref。
   *
   * 对局结束后它是棋盘上唯一还有意义的操作，所以终局弹窗关闭时把焦点送到这里
   * （见 `ResultDialog` 的 `focusAfterClose`）——键盘用户不必从页面最开头重新 Tab。
   */
  restartButtonRef?: Ref<HTMLButtonElement>
}

export function ControlBar({
  canUndo,
  canResign,
  onUndo,
  onRestart,
  onResign,
  restartButtonRef,
}: ControlBarProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button onClick={onUndo} disabled={!canUndo}>
        悔棋
      </Button>
      <Button ref={restartButtonRef} onClick={onRestart}>
        重新开始
      </Button>
      <Button variant="danger" onClick={onResign} disabled={!canResign}>
        认输
      </Button>
    </div>
  )
}
