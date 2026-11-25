import { useMemo, useRef, useState } from 'react'
import { replay } from '../../core/game'
import { findWins } from '../../core/position'
import type { GamePayload } from '../../persist/transfer/format'
import { gamePayloadToRecordInput } from '../../persist/transfer/format'
import type { GameRecordsStorage } from '../../persist/gameRecords'
import {
  inputFromPosition,
  positionContentKey,
  type PositionStorage,
} from '../../persist/positions'
import { Board } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import { useFocusHandoff } from '../../components/ui/useFocusHandoff'
import { cx } from '../../lib/cx'
import { useSettingsStore } from '../../store/settingsStore'
import {
  decodeShareToken,
  type ShareDecodeResult,
  type ShareFailureCode,
} from '../../sharing/link'
import { PageShell, SIDE_PANEL_CLASS } from '../shell/PageShell'

export interface SharePreviewProps {
  readonly token: string
  readonly games: GameRecordsStorage
  readonly positions: PositionStorage
  readonly now: () => number
  readonly onExit: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'duplicate' | 'memory' | 'failed'

function endingLabel(game: GamePayload): string {
  switch (game.ending.type) {
    case 'five':
      return `${game.ending.winner === 1 ? '黑' : '白'}方胜`
    case 'draw':
      return '和棋'
    case 'resign':
      return `${game.ending.winner === 1 ? '黑' : '白'}方胜（对手认输）`
  }
}

function errorTitle(code: ShareFailureCode): string {
  switch (code) {
    case 'unsupported_version':
      return '分享链接版本过新'
    case 'too_long':
      return '分享链接过长'
    case 'checksum':
      return '分享内容已损坏'
    case 'invalid_data':
      return '分享内容不合法'
    case 'unsupported_type':
      return '分享类型不受支持'
    case 'malformed':
      return '分享链接格式不完整'
  }
}

/**
 * 分享链接的只读预览。**解析成功不会写任何存储**；只有用户点击保存才调用
 * Phase 11A 的导入 / Phase 11B 的局面库。错误链接也由这个页面接住，
 * 不会让 App 白屏。
 */
export function SharePreview({ token, games, positions, now, onExit }: SharePreviewProps) {
  const decoded = useMemo(() => decodeShareToken(token), [token])
  const showCoords = useSettingsStore((settings) => settings.showCoords)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // 「保存」按下去当场禁用（保存中 / 已保存），焦点掉到 body：落到下面那行结果
  const handoff = useFocusHandoff()
  const saveStateRef = useRef<HTMLParagraphElement>(null)

  const message = (() => {
    switch (saveState) {
      case 'saving':
        return '正在保存…'
      case 'saved':
        return '已保存到本地。'
      case 'duplicate':
        return '这份内容已经在本地，未重复写入。'
      case 'memory':
        return '只写进了本次会话的内存兜底，刷新后可能丢失。'
      case 'failed':
        return '保存失败，本地数据未改变。'
      default:
        return null
    }
  })()

  /*
   * 结果的色调（§2.2）：失败是错误，用 `danger`；只进了内存兜底**不是失败**——
   * 这次会话里确实存下了，只是刷新后可能丢——是警示，用 `warn`，
   * 与数据管理面板「这次只写进了内存兜底」那一句同色。其余是中性的过程信息。
   */
  const messageTone =
    saveState === 'failed' ? 'text-danger' : saveState === 'memory' ? 'text-warn' : 'text-muted'

  async function saveGame(game: GamePayload): Promise<void> {
    setSaveState('saving')
    try {
      const result = await games.importMany([gamePayloadToRecordInput(game)])
      if (result.imported > 0) {
        setSaveState(result.persisted ? 'saved' : 'memory')
      } else if (result.duplicates > 0) {
        setSaveState('duplicate')
      } else {
        setSaveState('failed')
      }
    } catch {
      setSaveState('failed')
    }
  }

  async function savePosition(
    position: ReturnType<typeof inputFromPosition>,
  ): Promise<void> {
    setSaveState('saving')
    try {
      const list = await positions.list()
      const key = positionContentKey(position)
      const duplicate = list.records.some(
        (record) =>
          positionContentKey({
            cells: record.cells,
            nextPlayer: record.nextPlayer,
            provenance: record.provenance,
          }) === key,
      )
      if (duplicate) {
        setSaveState('duplicate')
        return
      }
      const result = await positions.save(position, null, now)
      setSaveState(result.persisted ? 'saved' : 'memory')
    } catch {
      setSaveState('failed')
    }
  }

  function renderError(failure: Extract<ShareDecodeResult, { ok: false }>) {
    return (
      <PageShell
        key="share-error"
        showNav={false}
        toolbar={
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <Button onClick={onExit}>← 返回应用</Button>
            <h1 className="truncate text-xl font-semibold text-fg">分享预览</h1>
          </div>
        }
      >
        <Panel title={errorTitle(failure.code)} bodyClassName="space-y-3">
          <p role="alert" data-testid="share-error" className="text-sm text-danger">
            {failure.message}
          </p>
          <p className="text-sm text-muted">
            这个链接无法打开，但应用的其他页面仍可正常使用。
          </p>
        </Panel>
      </PageShell>
    )
  }

  if (!decoded.ok) return renderError(decoded)

  const game = decoded.kind === 'game' ? decoded.game : null
  const gameState = game === null ? null : replay(game.moves, game.firstPlayer)
  const positionShare = decoded.kind === 'position' ? decoded : null
  const position = positionShare?.position ?? null
  const wins = position === null ? [] : findWins(position.board)

  return (
    <PageShell
      key="share-preview"
      showNav={false}
      variant="flush"
      toolbar={
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Button onClick={onExit}>← 返回应用</Button>
          <h1 className="truncate text-xl font-semibold text-fg">分享预览</h1>
        </div>
      }
    >
      <BoardStage>
        <Board
          board={game === null ? position!.board : gameState!.board}
          lastMove={gameState?.lastMove ?? null}
          winLine={gameState?.winLine ?? wins[0]?.points ?? null}
          nextPlayer={gameState?.current ?? position!.nextPlayer}
          showCoords={showCoords}
          interactive={false}
          onPlay={() => {}}
        />
      </BoardStage>

      <aside className={`order-2 space-y-3 px-3 pb-4 wide-layout:order-2 ${SIDE_PANEL_CLASS}`}>
        <Panel title="内容" bodyClassName="space-y-2">
          <p data-testid="share-kind" className="text-sm font-medium text-fg">
            {decoded.kind === 'game' ? '单盘棋谱' : '自定义局面'}
          </p>
          <p className="text-xs text-muted">
            {game !== null
              ? `${game.moves.length} 手 · ${endingLabel(game)}`
              : positionShare?.provenance !== null && positionShare?.provenance !== undefined
                ? `来自棋谱第 ${positionShare.provenance.ply} 手（已知手顺）`
                : '自由摆盘'}
          </p>
          <p className="text-xs text-faint">只读预览；打开链接不会自动写入本地。</p>
        </Panel>

        {/*
          `flex gap` 而不是 `space-y`：下面那行结果常驻（空着时 `empty:absolute` 退出排版），
          `space-y` 按选择器给「非末位」加边距，空节点也会让按钮下面多出一截空白。
        */}
        <Panel title="导入" bodyClassName="flex flex-col gap-2">
          <Button
            block
            variant="primary"
            disabled={saveState === 'saving' || saveState === 'saved' || saveState === 'duplicate'}
            data-testid="share-save"
            onClick={(event) => {
              handoff(event.currentTarget, () => saveStateRef.current)
              if (game !== null) {
                void saveGame(game)
              } else if (decoded.kind === 'position') {
                void savePosition(
                  inputFromPosition(
                    decoded.position,
                    decoded.title ?? '分享局面',
                    decoded.provenance,
                  ),
                )
              }
            }}
          >
            {decoded.kind === 'game' ? '保存到我的棋谱' : '保存为我的局面'}
          </Button>
          {/*
            播报区常驻、只换内容：`role="status"` 随内容一起挂载时部分读屏不播报
            （`FeedbackBanner` 的约定）。`tabIndex={-1}` 是给上面「保存」交焦点用的。
          */}
          <p
            ref={saveStateRef}
            role="status"
            tabIndex={-1}
            data-testid="share-save-state"
            className={cx('text-xs outline-none empty:absolute', messageTone)}
          >
            {message}
          </p>
        </Panel>
      </aside>
    </PageShell>
  )
}
