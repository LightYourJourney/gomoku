import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Board } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { AiPanel } from '../../components/panels/AiPanel'
import { ControlBar } from '../../components/panels/ControlBar'
import { HintPanel } from '../../components/panels/HintPanel'
import { MoveList } from '../../components/panels/MoveList'
import { ResultDialog } from '../../components/panels/ResultDialog'
import { SettingsPanel } from '../../components/panels/SettingsPanel'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Panel } from '../../components/ui/Panel'
import { opponentOf } from '../../core/board'
import type { Player } from '../../core/types'
import { cx } from '../../lib/cx'
import { createStoneSound, type StoneSound } from '../../lib/sound'
import { useMediaQuery } from '../../lib/useMediaQuery'
import {
  canHumanPlay,
  canUndo,
  moverAt,
  resignerFor,
  shouldAiMove,
  type GameMode,
} from '../../store/gameStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useGameStore } from '../../store/useGameStore'
import { AppHeader } from '../shell/AppHeader'
import { BoardAnnouncer } from './BoardAnnouncer'
import { MatchBar } from './MatchBar'
import { describeStatus, playerName } from './status'

/**
 * 三栏的起点。**这个值全仓只允许出现在这里一处**——CSS 里再写一个 1440 的媒体查询，
 * 两处就会分叉。为什么布局这件事要用 JS 判媒体查询（而 `lib/motion.ts` 明令不许），
 * 理由写在 `lib/useMediaQuery.ts` 与 `docs/ui-redesign/PHASE_02.md` §2.2。
 */
const WIDE_QUERY = '(min-width: 1440px)'
/**
 * **两个栅格模板必须互斥，用三元择一。**
 *
 * 不能写成 `cx(base, wide && THREE)`——Tailwind 的同名工具类之间没有优先级，
 * 谁在生成的 CSS 里靠后谁赢，实测两栏那条排在后面：两条同时挂上去，
 * ≥1440 会**静默**退回两栏，而 JS 以为自己在宽档，左栏就不见了。
 * 先例见 `Panel.tsx` 的 `bodyClassName` 注释。
 */
const THREE_COLUMNS =
  'lg:grid-cols-[clamp(240px,18vw,300px)_minmax(0,1fr)_clamp(300px,24vw,380px)]'
const TWO_COLUMNS = 'lg:grid-cols-[minmax(0,1fr)_clamp(300px,24vw,380px)]'

/** 待确认的操作。同一时刻只可能有一个——弹窗是模态的。 */
type PendingConfirm =
  | { readonly kind: 'restart' }
  | { readonly kind: 'resign' }
  | { readonly kind: 'mode'; readonly next: GameMode }
  | { readonly kind: 'color'; readonly next: Player }

export interface BattleScreenProps {
  /**
   * 注入音效实例（测试用）。生产不传，组件自己建——
   * 预热绑的就是这个实例的音频上下文，所以注入点必须在这一层。
   */
  readonly sound?: StoneSound
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    // 限宽：768 下通栏有 744px，两个短词被 justify-between 顶到两端，
    // 视线要横跨 700px 才能把它们对上（F-UI-16）
    <div className="flex max-w-sm items-center justify-between gap-2 py-1 text-xs">
      <span className="text-faint">{label}</span>
      <span className="font-medium text-fg">{children}</span>
    </div>
  )
}

export function BattleScreen({ sound: injectedSound }: BattleScreenProps = {}) {
  const settings = useSettingsStore()
  const game = useGameStore((state) => state.game)
  const mode = useGameStore((state) => state.mode)
  const humanColor = useGameStore((state) => state.humanColor)
  const difficulty = useGameStore((state) => state.difficulty)
  const aiThinking = useGameStore((state) => state.aiThinking)
  const aiError = useGameStore((state) => state.aiError)
  const aiInfo = useGameStore((state) => state.aiInfo)
  const recordSaveState = useGameStore((state) => state.recordSaveState)
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

  const wide = useMediaQuery(WIDE_QUERY)

  /**
   * 「重新开始」按钮。终局弹窗关闭时把焦点送到它——对局结束后它是唯一还有意义的
   * 操作，而在此之前焦点会掉到 `<body>`，键盘用户得从页面最开头重新 Tab。
   * 为什么不能「还给打开弹窗的那个元素」：见 `Modal` 的 `focusAfterClose` 注释。
   */
  const restartRef = useRef<HTMLButtonElement>(null)

  const ownSound = useMemo(() => createStoneSound(), [])
  const sound = injectedSound ?? ownSound
  useEffect(() => () => sound.dispose(), [sound])

  // 浏览器不允许在手势之前启动音频，所以第一次 pointerdown 时就把上下文
  // 创建并 resume 好，别等落子那一下才现造（那一下已经晚了）。
  useEffect(() => sound.arm(window), [sound])

  const status = describeStatus({ game, mode, humanColor, aiThinking })
  const moveCount = game.moves.length
  const interactive = canHumanPlay({ game, mode, humanColor, aiThinking })
  // AI 欠着一手又没在思考，说明它卡住了（例如引擎报错后停在半路）。
  // 这时必须给出重试入口，否则玩家既不能落子也不能让它继续，只剩重开或认输两条路。
  const aiStuck = shouldAiMove({ game, mode, humanColor }) && !aiThinking

  // 对局结束时自动弹出结果弹窗；玩家关掉后不再自动弹，直到下一次分出胜负。
  // 在渲染期间调整状态而不是放进 effect：effect 里 setState 会白白多触发一轮渲染。
  const [resultDismissed, setResultDismissed] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [seenStatus, setSeenStatus] = useState(game.status)
  if (game.status !== seenStatus) {
    setSeenStatus(game.status)
    setResultDismissed(false)
    // 对局在别处结束了（AI 应手赢下、或引擎那手把局面走完），
    // 挂着的确认框问的已经是一局不存在的棋——收掉它，
    // 否则结果弹窗会叠在它上面，关掉之后底下还留着一个措辞过时的框。
    setConfirm(null)
  }
  const resultOpen = game.status !== 'playing' && !resultDismissed

  // 终局音效：只在「进行中 → 终局」这条边上响一次。
  // 判据必须是 `game.status`——上面那个 `status` 是显示描述对象，拿它比字符串
  // 恒为真，会在每次状态变化时都放一遍。
  const soundedStatus = useRef(game.status)
  useEffect(() => {
    const previous = soundedStatus.current
    soundedStatus.current = game.status
    if (previous === game.status) return
    if (game.status === 'playing' || game.status === 'draw') return
    if (!settings.soundEnabled) return

    // 本地双人是同一块屏幕上的两个人，没有「玩家视角」可言：
    // 有人赢了就报「终局落定」的上行音。
    const won = mode === 'pvp' || game.winner === humanColor
    if (won) sound.win()
    else sound.lose()
  }, [game.status, game.winner, mode, humanColor, settings.soundEnabled, sound])

  // 用落子数而不是状态对象来判断「刚刚落了一手」，悔棋与刷新恢复都不会误响。
  const soundedCount = useRef(moveCount)
  useEffect(() => {
    if (moveCount > soundedCount.current && settings.soundEnabled) {
      sound.play(moverAt(moveCount - 1, game.firstPlayer))
    }
    soundedCount.current = moveCount
  }, [moveCount, settings.soundEnabled, game.firstPlayer, sound])

  /*
   * ── 防误触确认 ───────────────────────────────────────────────
   *
   * 拦截条件只跟「有没有东西可丢」有关：
   * - 重新开始 / 切模式 / 切执子：进行中**且已有落子**（空盘没什么可丢的，
   *   任务书对重新开始明确写了「空棋盘无需不必要的二次确认」）；
   * - 认输：只要进行中就拦。任务书对认输没有豁免，空盘点认输照样是在结束一局。
   *
   * **被拦下时一次都不碰 store。** 选中项由 store 驱动，所以「取消后选中项不变」
   * 与「取消不打断 AI 请求」都是结构性成立的，不靠回滚。
   */
  const playing = game.status === 'playing'
  const hasMoves = moveCount > 0
  const guardSwitch = playing && hasMoves

  /**
   * 拦截钩子：**「拦下」这件事整个写在这里**。
   *
   * 它返回 `false` 时 `Segmented` 不会调 `onChange`，所以「顺手打开确认弹窗」
   * 必须由它自己完成——一半写在这里、一半写在 `onChange` 里的话，
   * 被拦下时两边都不动，点下去什么都不会发生。
   */
  function beforeModeChange(next: GameMode): boolean {
    if (!guardSwitch) return true
    setConfirm({ kind: 'mode', next })
    return false
  }

  function beforeHumanColorChange(next: Player): boolean {
    if (!guardSwitch) return true
    setConfirm({ kind: 'color', next })
    return false
  }

  function handleRestart(): void {
    if (!playing || !hasMoves) {
      // 空盘、以及终局后的「再来一局」，直接开新局
      newGame()
      return
    }
    setConfirm({ kind: 'restart' })
  }

  function runConfirm(): void {
    const pending = confirm
    setConfirm(null)
    if (pending === null) return

    // 确认之后走的就是原来那条 store action——requestId / gameVersion
    // 的安全语义一行没动（「旧响应不得进入新棋局」由 newGame 清 pendingRequestId 保证）。
    switch (pending.kind) {
      case 'restart':
        newGame()
        break
      case 'resign':
        resign()
        break
      case 'mode':
        setMode(pending.next)
        break
      case 'color':
        setHumanColor(pending.next)
        break
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        药丸**不在顶栏里**：任务书要求「状态紧邻」棋盘，而顶栏是全站共用的导航。
        挪下来之后顶栏在四个页面之间长得一样，状态也不跟导航抢位置。
      */}
      <AppHeader />

      <main
        className={cx(
          'flex min-h-0 flex-1 flex-col lg:grid',
          wide ? THREE_COLUMNS : TWO_COLUMNS,
        )}
      >
        {/*
          左栏**只在宽桌面存在**。窄档把设置并进右栏底部，靠 JS 决定渲染在哪一边，
          而不是 CSS 各写一份——两份 DOM 意味着两组 `radiogroup`，
          而 jsdom 里没有样式表，`hidden` 根本不生效（见 `useMediaQuery` 的注释）。
        */}
        {wide && (
          <aside
            data-testid="battle-settings-column"
            className="overflow-y-auto border-r border-border px-4 py-4"
          >
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
              beforeModeChange={beforeModeChange}
              beforeHumanColorChange={beforeHumanColorChange}
            />
          </aside>
        )}

        {/*
          中列：状态 → 棋盘 → 操作。棋盘吃掉剩余高度。

          **`gap-1.5` / `py-1.5` 不是随手定的**：中列的纵向开销直接压棋盘，
          而棋盘在 ≥1440 是被高度卡住的。实测 1440×700 下每多 15px 开销，
          棋盘就跌破判据要求的 35%（`DESIGN_SYSTEM.md` §12 第 3 条）。
          当前五处分寸是量出来的——列上下的 6、间隙 6、状态条 34、
          工具栏 38、棋盘容器自身的 8（在 `BoardStage` 里）——
          **改任何一个都要重跑 `yarn ui:probe`**。
        */}
        <div
          data-testid="battle-center-column"
          className="flex min-h-0 flex-col gap-1.5 px-3 py-1.5 lg:px-4"
        >
          <MatchBar
            game={game}
            mode={mode}
            humanColor={humanColor}
            difficulty={difficulty}
            aiThinking={aiThinking}
          />

          <BoardStage className="lg:flex-1">
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

          <ControlBar
            canUndo={canUndo({ game, mode, humanColor })}
            canHint={interactive}
            hintThinking={hintThinking}
            canResign={playing}
            onUndo={undoMove}
            onHint={requestHint}
            onRestart={handleRestart}
            onResign={() => setConfirm({ kind: 'resign' })}
            restartButtonRef={restartRef}
          />
        </div>

        <BoardAnnouncer game={game} mode={mode} humanColor={humanColor} aiThinking={aiThinking} />

        {/* 右栏：按信息优先级 —— 概要 → 提示 → 分析 → 棋谱 →（窄档的）设置 */}
        <aside className="order-2 space-y-3 px-3 pb-4 lg:order-3 lg:overflow-y-auto lg:border-l lg:border-border lg:px-4 lg:py-4">
          <Panel title="对局概要" bodyClassName="space-y-1">
            <InfoRow label="模式">{mode === 'pve' ? '人机对战' : '本地双人'}</InfoRow>
            <InfoRow label="手数">{moveCount}</InfoRow>
          </Panel>

          <HintPanel
            candidates={hint}
            urgency={hintUrgency}
            confidence={hintConfidence}
            thinking={hintThinking}
            error={hintError}
            onClear={clearHint}
          />

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

          <Panel title="棋谱" padding="tight">
            <MoveList moves={game.moves} firstPlayer={game.firstPlayer} lastMove={game.lastMove} />
          </Panel>

          {/*
            窄档（<1440）的设置并进右栏底部。它**不再按宽度改默认展开状态**：
            折叠的对象是「显示与声音」那组显示偏好——任务书 §二 要求低频设置
            「移至可打开的侧边面板、折叠区域或类似控件」，而模式/执子/难度按 §六
            是「需要经常调整的基础对战设置」，折起来等于给高频操作加一次点击。
          */}
          {!wide && (
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
              beforeModeChange={beforeModeChange}
              beforeHumanColorChange={beforeHumanColorChange}
            />
          )}
        </aside>
      </main>

      <ConfirmDialog
        open={confirm !== null}
        title={confirmTitle(confirm)}
        description={confirmDescription(confirm, {
          moves: moveCount,
          mode,
          humanColor,
          // **与 store 同源**：认输的是谁由 `resignerFor` 判，这里不自己推一遍
          resigner: resignerFor({ mode, humanColor, game }),
        })}
        confirmLabel={confirm ? CONFIRM_LABEL[confirm.kind] : ''}
        tone={confirm?.kind === 'resign' ? 'danger' : 'default'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />

      <ResultDialog
        open={resultOpen}
        status={status}
        moves={moveCount}
        saveState={recordSaveState}
        // 终局后的「再来一局」直接开新局，不再问一次——已经结束了，没有可丢的东西
        onRestart={() => newGame()}
        onClose={() => setResultDismissed(true)}
        focusAfterClose={restartRef}
      />
    </div>
  )
}

const CONFIRM_TITLE: Record<PendingConfirm['kind'], string> = {
  restart: '重新开始？',
  resign: '认输？',
  mode: '切换对战模式？',
  color: '切换执子？',
}

/**
 * 确认按钮的文案**必须与工具栏那颗不同名**：`Modal` 不设 `aria-hidden`，
 * 底下的工具栏按钮仍在无障碍树里，同名会让 `getByRole` 直接撞上两个。
 * 顺带也更清楚——按钮自己说出了后果。
 */
const CONFIRM_LABEL: Record<PendingConfirm['kind'], string> = {
  restart: '确认重新开始',
  resign: '确认认输',
  mode: '确认切换',
  color: '确认切换',
}

function confirmTitle(pending: PendingConfirm | null): string {
  return pending === null ? '' : CONFIRM_TITLE[pending.kind]
}

interface ConfirmFacts {
  readonly moves: number
  readonly mode: GameMode
  readonly humanColor: Player
  readonly resigner: Player
}

/** 后果描述：说清「会丢掉什么 / 会记成什么」，不是「你确定吗」。 */
function confirmDescription(pending: PendingConfirm | null, facts: ConfirmFacts): string {
  if (pending === null) return ''

  if (pending.kind === 'resign') {
    const winner = playerName(opponentOf(facts.resigner), facts.mode, facts.humanColor)
    return `这一局会立刻结束，记为${winner}获胜。认输不能撤销。`
  }

  const what =
    pending.kind === 'restart'
      ? '重新开始会开一局新的'
      : pending.kind === 'mode'
        ? '切换对战模式会开一局新的'
        : '切换执子会开一局新的'
  return `当前这局还没结束，${what}，已经下的 ${facts.moves} 手会被清空。`
}
