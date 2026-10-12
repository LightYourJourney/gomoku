import type { RefObject } from 'react'
import type { GameStatusDescriptor } from '../../features/battle/status'
import type { RecordSaveState } from '../../store/gameStore'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { StoneDot } from './StoneDot'

export interface ResultDialogProps {
  open: boolean
  status: GameStatusDescriptor
  moves: number
  /** 这一局的棋谱入库进度。界面如实显示，失败也如实说。 */
  saveState: RecordSaveState
  onRestart: () => void
  onClose: () => void
  /** 关闭后焦点去哪里。见 `Modal` 的同名 prop。 */
  focusAfterClose?: RefObject<HTMLElement | null>
}

const SAVE_LABELS: Record<Exclude<RecordSaveState, 'idle'>, string> = {
  saving: '正在存入棋谱库…',
  saved: '这局已存入棋谱库',
  failed: '没能保存这局',
}

export function ResultDialog({
  open,
  status,
  moves,
  saveState,
  onRestart,
  onClose,
  focusAfterClose,
}: ResultDialogProps) {
  return (
    <Modal
      open={open}
      title="本局结束"
      onClose={onClose}
      focusAfterClose={focusAfterClose}
      footer={
        <>
          <Button variant="primary" block onClick={onRestart}>
            再来一局
          </Button>
          <Button block onClick={onClose}>
            看看棋盘
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2.5">
        {status.player !== null && <StoneDot player={status.player} size={20} />}
        <span className="text-base font-semibold text-fg">{status.label}</span>
      </div>
      <p className="mt-2 text-xs text-faint">
        共 {moves} 手。
        {saveState !== 'idle' && <> {SAVE_LABELS[saveState]}</>}
      </p>
    </Modal>
  )
}
