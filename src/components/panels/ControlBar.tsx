import { Button } from '../ui/Button'

export interface ControlBarProps {
  canUndo: boolean
  canResign: boolean
  onUndo: () => void
  onRestart: () => void
  onResign: () => void
}

export function ControlBar({ canUndo, canResign, onUndo, onRestart, onResign }: ControlBarProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button onClick={onUndo} disabled={!canUndo}>
        悔棋
      </Button>
      <Button onClick={onRestart}>重新开始</Button>
      <Button variant="danger" onClick={onResign} disabled={!canResign}>
        认输
      </Button>
    </div>
  )
}
