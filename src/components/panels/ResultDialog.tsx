import type { GameStatusDescriptor } from '../../features/battle/status'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { StoneDot } from './StoneDot'

export interface ResultDialogProps {
  open: boolean
  status: GameStatusDescriptor
  moves: number
  onRestart: () => void
  onClose: () => void
}

export function ResultDialog({ open, status, moves, onRestart, onClose }: ResultDialogProps) {
  return (
    <Modal
      open={open}
      title="本局结束"
      onClose={onClose}
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
      <p className="mt-2 text-xs text-faint">共 {moves} 手。</p>
    </Modal>
  )
}
