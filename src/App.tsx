import { useEffect } from 'react'
import { cx } from './lib/cx'
import { BattleScreen } from './features/battle/BattleScreen'
import { LearnScreen } from './features/learn/LearnScreen'
import { PuzzleScreen } from './features/puzzles/PuzzleScreen'
import { ReviewScreen } from './features/review/ReviewScreen'
import { indexedDbGameRecords } from './persist/gameRecords'
import { appEngine } from './store/useGameStore'
import { useLearnStore } from './store/learnStore'
import { useThemeEffect } from './store/settingsStore'

export default function App() {
  useThemeEffect()

  const view = useLearnStore((state) => state.view)
  const bootstrap = useLearnStore((state) => state.bootstrap)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  return (
    <div
      className={cx(
        'flex min-h-dvh flex-col bg-bg text-fg',
        /*
          根容器的滚动模式**要跟页面走**，不能按宽度一刀切。

          对战页自有三档（`BattleScreen`，断点在 `lg`）：768–1023 横屏那一带它是
          **单列**，那时若给 `h-dvh overflow-hidden`，内容会被直接截断。
          其余页面走 `wide-layout`——它们的两栏就是按这个条件开的，根容器不跟上的话，
          768–1023 横屏会出现「两栏了，但整页一起滚、侧栏的 `overflow-y-auto` 没有边界」，
          而 ≥1024 下是「棋盘固定、只有侧栏滚」。同一个布局两种滚动行为，用户拖一下
          窗口宽度就会发现。
        */
        view === 'battle'
          ? 'lg:h-dvh lg:overflow-hidden'
          : 'wide-layout:h-dvh wide-layout:overflow-hidden',
      )}
    >
      {view === 'battle' && <BattleScreen />}
      {view === 'learn' && <LearnScreen />}
      {view === 'puzzles' && <PuzzleScreen />}
      {view === 'review' && <ReviewScreen storage={indexedDbGameRecords} engine={appEngine} />}
    </div>
  )
}
