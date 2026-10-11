import { useEffect } from 'react'
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
    <div className="flex min-h-dvh flex-col bg-bg text-fg lg:h-dvh lg:overflow-hidden">
      {view === 'battle' && <BattleScreen />}
      {view === 'learn' && <LearnScreen />}
      {view === 'puzzles' && <PuzzleScreen />}
      {view === 'review' && <ReviewScreen storage={indexedDbGameRecords} engine={appEngine} />}
    </div>
  )
}
