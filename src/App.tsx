import { useEffect, useRef, useState } from 'react'
import { BattleScreen } from './features/battle/BattleScreen'
import { LearnScreen } from './features/learn/LearnScreen'
import { PuzzleScreen } from './features/puzzles/PuzzleScreen'
import { ReviewScreen } from './features/review/ReviewScreen'
import { indexedDbGameRecords } from './persist/gameRecords'
import { indexedDbPositions } from './persist/positions'
import { appEngine, useGameStore } from './store/useGameStore'
import { useLearnStore } from './store/learnStore'
import { useThemeEffect } from './store/settingsStore'
import { useFlushOnHide } from './lib/useFlushOnHide'
import { SharePreview } from './features/sharing/SharePreview'
import { shouldResumeAiAfterHashChange } from './features/sharing/hash'
import { shareTokenFromHash } from './sharing/link'

function currentShareToken(): string | null {
  return shareTokenFromHash(window.location.hash)
}

/** 四个模块页与分享预览共用同一套根容器：安全区、滚动模式只在这里改。 */
const ROOT_CLASS =
  'flex min-h-dvh flex-col bg-bg pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] text-fg wide-layout:h-dvh wide-layout:overflow-hidden'

export default function App() {
  useThemeEffect()
  const [shareToken, setShareToken] = useState<string | null>(currentShareToken)

  useEffect(() => {
    const handleHashChange = () => {
      const next = currentShareToken()
      if (shouldResumeAiAfterHashChange(shareToken, next)) useGameStore.getState().requestAiMove()
      else if (next !== null) useGameStore.getState().suspendAi()
      setShareToken(next)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [shareToken])

  function exitShare(): void {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
    setShareToken(null)
    useGameStore.getState().requestAiMove()
  }

  const view = useLearnStore((state) => state.view)
  const bootstrap = useLearnStore((state) => state.bootstrap)
  const flush = useLearnStore((state) => state.flush)
  const persistState = useLearnStore((state) => state.persistState)
  const retryPersist = useLearnStore((state) => state.retryPersist)

  const learnBootstrapped = useRef(false)
  useEffect(() => {
    // 分享预览不应打开/升级本地数据库；离开分享页后再载入学习进度。
    if (shareToken !== null || learnBootstrapped.current) return
    learnBootstrapped.current = true
    bootstrap()
  }, [bootstrap, shareToken])

  // 切后台 / 关页面前把学习进度尽力冲出去（不是落盘保证，见 hook 注释）
  useFlushOnHide(flush)

  if (shareToken !== null) {
    return (
      <div
        className={ROOT_CLASS}
      >
        <SharePreview
          key={shareToken}
          token={shareToken}
          games={indexedDbGameRecords}
          positions={indexedDbPositions}
          now={Date.now}
          onExit={exitShare}
        />
      </div>
    )
  }

  return (
    <div
      /*
        根容器的滚动模式跟 `wide-layout` 走——**四个页面同一个条件**。

        这里曾经按页面分叉（对战页 `lg:`、其余 `wide-layout:`）。那条分叉让 768–1023
        横屏的对战页停在单列上，而 `BoardStage` 的高度解除条件早已统一成
        `wide-layout`——两边不一致时，`h-auto` 的 `container-type: size` 容器拿不到
        确定高度，**棋盘整块消失**（实测 0×0；`e2e/layout.spec.ts` 的
        「对战页在 768–1023 横屏」钉着它）。

        单列本身也给不出合规棋盘：那一档的固定高是 `min(100vw−1.5rem, 56dvh)`
        减掉 `py-3` 的 24px——900×500 下即 `280 − 24 = 256px`，低于
        `DESIGN_SYSTEM.md` §8.1 的 320px。所以不是把条件收回去，而是让对战页
        和另外三页一样，够宽就两栏、就 `h-dvh`、就各自滚。
      */
      /*
       * 安全区内边距（F-UI-18）。`index.html` 开了 `viewport-fit=cover`，
       * 横屏刘海与底部手势条会压住内容；没有 `env()` 时页面直接铺到屏幕边缘。
       * **四个方向都加**（顶栏也会被刘海压住）——无刘海的设备上 `env()` 等于 0，
       * 没有任何影响。
       * 背景色由根容器自己铺（padding 在背景之内），刘海区仍是主题底色。
       */
      className={ROOT_CLASS}
    >
      {persistState === 'failed' && (
        <div
          role="alert"
          data-testid="progress-persist-error"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          <span>学习进度未能保存到本机，刷新后可能丢失。</span>
          <button
            type="button"
            className="rounded border border-danger/40 px-2 py-1 font-medium"
            onClick={retryPersist}
          >
            重试
          </button>
        </div>
      )}
      {view === 'battle' && <BattleScreen />}
      {view === 'learn' && <LearnScreen />}
      {view === 'puzzles' && <PuzzleScreen />}
      {view === 'review' && (
        <ReviewScreen
          storage={indexedDbGameRecords}
          engine={appEngine}
          onRestoreSession={(session) => useGameStore.getState().restore(session)}
          onStartBranch={(input) => useGameStore.getState().startBranch(input)}
        />
      )}
    </div>
  )
}
