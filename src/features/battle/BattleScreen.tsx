import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Board } from '../../components/board/Board'
import { AiPanel } from '../../components/panels/AiPanel'
import { ControlBar } from '../../components/panels/ControlBar'
import { MoveList } from '../../components/panels/MoveList'
import { ResultDialog } from '../../components/panels/ResultDialog'
import { SettingsPanel } from '../../components/panels/SettingsPanel'
import { StatusPill } from '../../components/panels/StatusPill'
import { StoneDot } from '../../components/panels/StoneDot'
import { Panel } from '../../components/ui/Panel'
import { DIFFICULTY_LABELS } from '../../ai/difficulty'
import { BLACK } from '../../core/types'
import { createStoneSound } from '../../lib/sound'
import { THEME_LABELS, THEME_PREFERENCES } from '../../lib/theme'
import { canHumanPlay, canUndo, moverAt } from '../../store/gameStore'
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

function BrandMark() {
  const stones = [1, 1, 2, 2, 1] as const

  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] shadow-sm"
        style={{ background: 'linear-gradient(135deg, var(--c-board-a), var(--c-board-b))' }}
      >
        <div className="flex gap-[3px]">
          {stones.map((player, index) => (
            <span
              key={index}
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background:
                  player === 1
                    ? 'radial-gradient(circle at 35% 30%, var(--c-stone-black-a), var(--c-stone-black-b))'
                    : 'radial-gradient(circle at 35% 30%, var(--c-stone-white-a), var(--c-stone-white-b))',
              }}
            />
          ))}
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-fg">Gomoku Lab</div>
        <div className="text-[11px] text-faint">五子棋实验室</div>
      </div>
    </div>
  )
}

function ThemeToggle() {
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)

  const index = THEME_PREFERENCES.indexOf(theme)
  const next = THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length]

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`主题：${THEME_LABELS[theme]}（点击切换为${THEME_LABELS[next]}）`}
      aria-label={`主题：${THEME_LABELS[theme]}，点击切换为${THEME_LABELS[next]}`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-border-strong hover:text-fg"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        {theme === 'dark' ? (
          <path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        ) : theme === 'light' ? (
          <>
            <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 5v14" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 5a7 7 0 0 1 0 14Z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
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

  const sound = useMemo(() => createStoneSound(), [])
  useEffect(() => () => sound.dispose(), [sound])

  const status = describeStatus({ game, mode, humanColor, aiThinking })
  const moveCount = game.moves.length
  const interactive = canHumanPlay({ game, mode, humanColor, aiThinking })
  // AI 欠着一手没走（例如引擎报错后停在半路）——这时必须给出重试入口，
  // 否则玩家既不能落子也不能让它继续，只剩重开或认输两条路。
  const aiOwesMove = mode === 'pve' && game.status === 'playing' && game.current !== humanColor

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
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface/70 px-4 py-3 backdrop-blur lg:px-6">
        <BrandMark />
        <div className="ml-auto flex items-center gap-2">
          <StatusPill status={status} />
          <ThemeToggle />
        </div>
      </header>

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

        <section
          className="order-1 flex h-[min(calc(100vw-1.5rem),56dvh)] items-center justify-center px-3 py-3 lg:order-2 lg:h-auto lg:min-h-0 lg:px-6 lg:py-6"
          style={{ containerType: 'size' }}
        >
          <div className="aspect-square w-[min(100cqw,100cqh)] overflow-hidden rounded-2xl border border-board-edge/40 shadow-panel">
            <Board
              board={game.board}
              lastMove={game.lastMove}
              winLine={game.winLine}
              nextPlayer={game.current}
              showCoords={settings.showCoords}
              interactive={interactive}
              onPlay={playHuman}
            />
          </div>
        </section>

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
              canRetry={aiOwesMove}
              onRetry={retryAiMove}
              onDismissError={dismissAiError}
            />
          )}

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
