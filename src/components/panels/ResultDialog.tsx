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
  // 恢复的对局不会自动入库；查过库之后才敢这么说。
  absent: '这局不在棋谱库（恢复的对局不会自动入库）',
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
      /*
        * 贴下沿，不居中：居中时它正好压在棋盘中线上，
        * 五颗获胜子里有两颗被盖住。贴下之后棋盘上半部分整个露出来，
        * 「五连」这件事在终局那一刻就看得见了，不必先点「看看棋盘」。
      */
      placement="bottom"
      footer={
        <>
          {/* 次要在前、主操作在后：视觉上是「左次右主」，Tab 顺序也是从左到右 */}
          <Button block onClick={onClose}>
            看看棋盘
          </Button>
          <Button variant="primary" block onClick={onRestart}>
            再来一局
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3">
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
