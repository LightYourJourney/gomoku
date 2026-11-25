import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BLACK } from '../../core/types'
import { SettingsPanel, type SettingsPanelProps } from './SettingsPanel'

const noop = () => {}
const base: SettingsPanelProps = {
  mode: 'pve',
  humanColor: BLACK,
  difficulty: 'easy',
  theme: 'system',
  showCoords: true,
  soundEnabled: true,
  onModeChange: noop,
  onHumanColorChange: noop,
  onDifficultyChange: noop,
  onThemeChange: noop,
  onShowCoordsChange: noop,
  onSoundEnabledChange: noop,
}

describe('SettingsPanel —— 偏好写入失败的提示', () => {
  it('写入失败时在「显示与声音」里如实说明刷新后会恢复', async () => {
    render(<SettingsPanel {...base} preferencesSaveFailed />)
    await userEvent.click(screen.getByRole('button', { name: /显示与声音/ }))

    expect(screen.getByRole('status')).toHaveTextContent('刷新后会恢复原样')
  })

  it('没有失败时不出现这条提示', async () => {
    render(<SettingsPanel {...base} />)
    await userEvent.click(screen.getByRole('button', { name: /显示与声音/ }))

    expect(screen.queryByText(/刷新后会恢复原样/)).toBeNull()
  })
})
