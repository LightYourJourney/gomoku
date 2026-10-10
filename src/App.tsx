import { useEffect } from 'react'
import { BattleScreen } from './features/battle/BattleScreen'
import { LearnScreen } from './features/learn/LearnScreen'
import { PuzzleScreen } from './features/puzzles/PuzzleScreen'
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
    <>
      {view === 'battle' && <BattleScreen />}
      {view === 'learn' && <LearnScreen />}
      {view === 'puzzles' && <PuzzleScreen />}
    </>
  )
}
