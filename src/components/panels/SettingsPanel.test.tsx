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

/*
 * 偏好写入失败的提示原先是「显示与声音」折叠区里的一行 `role="status"`：默认折叠看不见，
 * 又让对战页多出一个 live region。现在由全站提示条（`AppHeader`）负责，断言也挪到了
 * `AppHeader.test.tsx`；这里只守住「面板自己不再说一遍、不再自带播报区」。
 */
describe('SettingsPanel —— 偏好写入失败不在面板里重复', () => {
  it('展开「显示与声音」后没有这条提示，也没有自己的播报区', async () => {
    render(<SettingsPanel {...base} />)
    await userEvent.click(screen.getByRole('button', { name: /显示与声音/ }))

    expect(screen.queryByText(/刷新后会恢复原样/)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
