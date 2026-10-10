import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Board } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { AiPanel } from '../../components/panels/AiPanel'
import { ControlBar } from '../../components/panels/ControlBar'
import { HintPanel } from '../../components/panels/HintPanel'
import { MoveList } from '../../components/panels/MoveList'
import { ResultDialog } from '../../components/panels/ResultDialog'
import { SettingsPanel } from '../../components/panels/SettingsPanel'
import { StatusPill } from '../../components/panels/StatusPill'
import { StoneDot } from '../../components/panels/StoneDot'
import { Panel } from '../../components/ui/Panel'
import { AppHeader } from '../shell/AppHeader'
import { DIFFICULTY_LABELS } from '../../ai/difficulty'
import { BLACK } from '../../core/types'
import { createStoneSound } from '../../lib/sound'
import { canHumanPlay, canUndo, moverAt, shouldAiMove } from '../../store/gameStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useGameStore } from '../../store/useGameStore'
import { describeStatus } from './status'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-faint">{label}</span>
      <span className="font-medium text-fg">{children}</span>
    </div>
  )
}

export function BattleScreen() {
  const settings = useSettingsStore()
  const game = useGameStore((state) => state.game)
  const mode = useGameStore((state) => state.mode)
  const humanColor = useGameStore((state) => state.humanColor)
  const difficulty = useGameStore((state) => state.difficulty)
  const aiThinking = useGameStore((state) => state.aiThinking)
  const aiError = useGameStore((state) => state.aiError)
  const aiInfo = useGameStore((state) => state.aiInfo)
  const newGame = useGameStore((state) => state.newGame)
  const playHuman = useGameStore((state) => state.playHuman)
  const undoMove = useGameStore((state) => state.undoMove)
  const resign = useGameStore((state) => state.resign)
  const setMode = useGameStore((state) => state.setMode)
  const setHumanColor = useGameStore((state) => state.setHumanColor)
  const setDifficulty = useGameStore((state) => state.setDifficulty)
  const retryAiMove = useGameStore((state) => state.retryAiMove)
  const dismissAiError = useGameStore((state) => state.dismissAiError)
  const hint = useGameStore((state) => state.hint)
  const hintUrgency = useGameStore((state) => state.hintUrgency)
  const hintConfidence = useGameStore((state) => state.hintConfidence)
  const hintThinking = useGameStore((state) => state.hintThinking)
  const hintError = useGameStore((state) => state.hintError)
  const requestHint = useGameStore((state) => state.requestHint)
  const clearHint = useGameStore((state) => state.clearHint)

  const sound = useMemo(() => createStoneSound(), [])
  useEffect(() => () => sound.dispose(), [sound])

  const status = describeStatus({ game, mode, humanColor, aiThinking })
  const moveCount = game.moves.length
  const interactive = canHumanPlay({ game, mode, humanColor, aiThinking })
  // AI 欠着一手又没在思考，说明它卡住了（例如引擎报错后停在半路）。
  // 这时必须给出重试入口，否则玩家既不能落子也不能让它继续，只剩重开或认输两条路。
  const aiStuck = shouldAiMove({ game, mode, humanColor }) && !aiThinking

  // 对局结束时自动弹出结果弹窗；玩家关掉后不再自动弹，直到下一次分出胜负。
  // 在渲染期间调整状态而不是放进 effect：effect 里 setState 会白白多触发一轮渲染。
  const [resultDismissed, setResultDismissed] = useState(false)
  const [seenStatus, setSeenStatus] = useState(game.status)
  if (game.status !== seenStatus) {
    setSeenStatus(game.status)
    setResultDismissed(false)
  }
  const resultOpen = game.status !== 'playing' && !resultDismissed

  // 用落子数而不是状态对象来判断「刚刚落了一手」，悔棋与刷新恢复都不会误响。
  const soundedCount = useRef(moveCount)
  useEffect(() => {
    if (moveCount > soundedCount.current && settings.soundEnabled) {
      sound.play(moverAt(moveCount - 1, game.firstPlayer))
    }
    soundedCount.current = moveCount
  }, [moveCount, settings.soundEnabled, game.firstPlayer, sound])

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg lg:h-dvh lg:overflow-hidden">
      <AppHeader>
        <StatusPill status={status} />
      </AppHeader>

      <main className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-[268px_minmax(0,1fr)_344px]">
        <aside className="order-3 px-3 py-4 lg:order-1 lg:overflow-y-auto lg:border-r lg:border-border lg:px-4">
          <SettingsPanel
            mode={mode}
            humanColor={humanColor}
            difficulty={difficulty}
            theme={settings.theme}
            showCoords={settings.showCoords}
            soundEnabled={settings.soundEnabled}
            onModeChange={setMode}
            onHumanColorChange={setHumanColor}
            onDifficultyChange={setDifficulty}
            onThemeChange={settings.setTheme}
            onShowCoordsChange={settings.setShowCoords}
            onSoundEnabledChange={settings.setSoundEnabled}
          />
        </aside>

        <BoardStage>
          <Board
            board={game.board}
            lastMove={game.lastMove}
            winLine={game.winLine}
            nextPlayer={game.current}
            showCoords={settings.showCoords}
            interactive={interactive}
            marks={hint?.map((suggestion) => ({ point: suggestion.move }))}
            onPlay={playHuman}
          />
        </BoardStage>

        <aside className="order-2 space-y-3 px-3 pb-4 lg:order-3 lg:overflow-y-auto lg:border-l lg:border-border lg:px-4 lg:py-4">
          <Panel title="对局" bodyClassName="space-y-1 p-3.5">
            <InfoRow label="模式">{mode === 'pve' ? '人机对战' : '本地双人'}</InfoRow>
            {mode === 'pve' && (
              <>
                <InfoRow label="执子">
                  <span className="inline-flex items-center gap-1.5">
                    <StoneDot player={humanColor} size={11} />
                    {humanColor === BLACK ? '黑棋（先行）' : '白棋（后行）'}
                  </span>
                </InfoRow>
                <InfoRow label="AI 难度">{DIFFICULTY_LABELS[difficulty]}</InfoRow>
              </>
            )}
            <InfoRow label="手数">{moveCount}</InfoRow>

            <div className="pt-3">
              <ControlBar
                canUndo={canUndo({ game, mode, humanColor })}
                canResign={game.status === 'playing'}
                onUndo={undoMove}
                onRestart={() => newGame()}
                onResign={resign}
              />
            </div>
          </Panel>

          {mode === 'pve' && (
            <AiPanel
              thinking={aiThinking}
              info={aiInfo}
              error={aiError}
              canRetry={aiStuck}
              onRetry={retryAiMove}
              onDismissError={dismissAiError}
            />
          )}

          <HintPanel
            candidates={hint}
            urgency={hintUrgency}
            confidence={hintConfidence}
            thinking={hintThinking}
            error={hintError}
            canAsk={interactive}
            onAsk={requestHint}
            onClear={clearHint}
          />

          <Panel title="棋谱" bodyClassName="p-2.5">
            <MoveList moves={game.moves} firstPlayer={game.firstPlayer} lastMove={game.lastMove} />
          </Panel>
        </aside>
      </main>

      <ResultDialog
        open={resultOpen}
        status={status}
        moves={moveCount}
        onRestart={() => newGame()}
        onClose={() => setResultDismissed(true)}
      />
    </div>
  )
}
