import type { ReactNode } from 'react'
import { AVAILABLE_DIFFICULTIES, DIFFICULTIES, DIFFICULTY_LABELS } from '../../ai/difficulty'
import type { Difficulty } from '../../ai/types'
import { BLACK, WHITE, type Player } from '../../core/types'
import { THEME_LABELS, THEME_PREFERENCES, type ThemePreference } from '../../lib/theme'
import type { GameMode } from '../../store/gameStore'
import { Panel } from '../ui/Panel'
import { Segmented } from '../ui/Segmented'
import { Switch } from '../ui/Switch'

export interface SettingsPanelProps {
  mode: GameMode
  humanColor: Player
  difficulty: Difficulty
  theme: ThemePreference
  showCoords: boolean
  soundEnabled: boolean
  onModeChange: (mode: GameMode) => void
  onHumanColorChange: (color: Player) => void
  onDifficultyChange: (difficulty: Difficulty) => void
  onThemeChange: (theme: ThemePreference) => void
  onShowCoordsChange: (value: boolean) => void
  onSoundEnabledChange: (value: boolean) => void
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {hint !== undefined && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    mode,
    humanColor,
    difficulty,
    theme,
    showCoords,
    soundEnabled,
    onModeChange,
    onHumanColorChange,
    onDifficultyChange,
    onThemeChange,
    onShowCoordsChange,
    onSoundEnabledChange,
  } = props

  return (
    <div className="space-y-3">
      <Panel title="对战" bodyClassName="space-y-4 p-3.5">
        <Field label="模式">
          <Segmented
            label="对战模式"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: 'pve', label: '人机对战' },
              { value: 'pvp', label: '本地双人' },
            ]}
          />
        </Field>

        {mode === 'pve' && (
          <>
            <Field label="执子" hint="切换会开新局">
              <Segmented
                label="玩家执子"
                value={humanColor === BLACK ? '1' : '2'}
                onChange={(value) => onHumanColorChange(value === '1' ? BLACK : WHITE)}
                options={[
                  { value: '1', label: '执黑先行' },
                  { value: '2', label: '执白后行' },
                ]}
              />
            </Field>

            <Field label="AI 难度" hint="Phase 1 开放两档">
              <Segmented
                label="AI 难度"
                columns={3}
                value={difficulty}
                onChange={onDifficultyChange}
                options={DIFFICULTIES.map((value) => {
                  const available = AVAILABLE_DIFFICULTIES.includes(value)
                  return {
                    value,
                    label: DIFFICULTY_LABELS[value],
                    disabled: !available,
                    hint: available ? undefined : '强化 AI 完成后开放',
                  }
                })}
              />
            </Field>
          </>
        )}
      </Panel>

      <Panel title="显示与声音" bodyClassName="space-y-1 p-2.5">
        <Field label="主题">
          <Segmented
            label="主题"
            value={theme}
            onChange={onThemeChange}
            options={THEME_PREFERENCES.map((value) => ({
              value,
              label: THEME_LABELS[value],
            }))}
          />
        </Field>
        <div className="pt-2">
          <Switch
            label="显示坐标"
            description="棋盘四周标注 A–O / 1–15"
            checked={showCoords}
            onChange={onShowCoordsChange}
          />
          <Switch
            label="落子音效"
            description="使用 WebAudio 实时合成，无需联网"
            checked={soundEnabled}
            onChange={onSoundEnabledChange}
          />
        </div>
      </Panel>
    </div>
  )
}
