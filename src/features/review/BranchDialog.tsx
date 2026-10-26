import { useState } from 'react'
import { AVAILABLE_DIFFICULTIES, DIFFICULTY_LABELS, isDifficulty } from '../../ai/difficulty'
import type { Difficulty } from '../../ai/types'
import { buildBranchGame } from '../../core/branch'
import type { Player } from '../../core/types'
import type { GameRecord } from '../../persist/gameRecords'
import type { BranchConfig, GameMode } from '../../store/gameStore'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'

const SELECT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg'

export interface BranchDialogProps {
  readonly record: GameRecord
  readonly cursor: number
  readonly error: string | null
  readonly onCancel: () => void
  readonly onConfirm: (config: BranchConfig) => void
}

/**
 * 「从这里继续对弈」的确认框。
 *
 * 只负责收集配置与展示分支点事实；真正接管对局由 `gameStore.startBranch`
 * 完成。终局等不可继续的情况在这里明确说明并禁用确认，不把胜局/和棋变成进行中。
 */
export function BranchDialog({
  record,
  cursor,
  error,
  onCancel,
  onConfirm,
}: BranchDialogProps) {
  const [mode, setMode] = useState<GameMode>(record.mode)
  const [humanColor, setHumanColor] = useState<Player>(record.humanColor)
  const [difficulty, setDifficulty] = useState<Difficulty>(record.difficulty)

  const built = buildBranchGame(
    { moves: record.moves, firstPlayer: record.firstPlayer },
    cursor,
  )
  const blocked = built.ok ? null : built.error
  const nextPlayer = built.ok ? built.game.current : null
  const pve = mode === 'pve'

  return (
    <Modal
      open
      title="从这里继续对弈"
      onClose={onCancel}
      footer={
        <>
          <Button block onClick={onCancel}>
            取消
          </Button>
          <Button
            block
            variant="primary"
            disabled={blocked !== null}
            onClick={() => onConfirm({ mode, humanColor, difficulty })}
          >
            开始探索
          </Button>
        </>
      }
    >
      <div data-testid="branch-dialog" className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-faint">分支起点</span>
          <span className="font-mono tabular-nums text-fg">
            {cursor} / {record.moves.length} 手
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-faint">下一手</span>
          <span className="font-medium text-fg">
            {nextPlayer === null ? '不可继续' : nextPlayer === 1 ? '黑棋' : '白棋'}
          </span>
        </div>

        {blocked !== null && (
          <p role="alert" data-testid="branch-blocked" className="text-sm text-warn">
            {blocked}
          </p>
        )}
        {error !== null && (
          <p role="alert" data-testid="branch-error" className="text-sm text-danger">
            {error}
          </p>
        )}

        <label className="block text-xs text-faint">
          对弈模式
          <select
            aria-label="分支对弈模式"
            value={mode}
            onChange={(event) => setMode(event.target.value === 'pvp' ? 'pvp' : 'pve')}
            className={SELECT_CLASS}
          >
            <option value="pve">人机对战</option>
            <option value="pvp">本地双人</option>
          </select>
        </label>

        {pve && (
          <label className="block text-xs text-faint">
            玩家执子
            <select
              aria-label="分支玩家执子"
              value={humanColor}
              onChange={(event) =>
                setHumanColor(event.target.value === '2' ? 2 : 1)
              }
              className={SELECT_CLASS}
            >
              <option value="1">黑棋</option>
              <option value="2">白棋</option>
            </select>
          </label>
        )}

        {pve && (
          <label className="block text-xs text-faint">
            AI 难度
            <select
              aria-label="分支 AI 难度"
              value={difficulty}
              onChange={(event) => {
                if (isDifficulty(event.target.value)) setDifficulty(event.target.value)
              }}
              className={SELECT_CLASS}
            >
              {AVAILABLE_DIFFICULTIES.map((entry) => (
                <option key={entry} value={entry}>
                  {DIFFICULTY_LABELS[entry]}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          原棋谱不会被修改。探索完成后会保存为一条独立棋谱。
        </p>
      </div>
    </Modal>
  )
}
