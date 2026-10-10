import { BattleScreen } from './features/battle/BattleScreen'
import { useThemeEffect } from './store/settingsStore'

export default function App() {
  useThemeEffect()

  return <BattleScreen />
}
