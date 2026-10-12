import type { ReactNode } from 'react'
import { AVAILABLE_DIFFICULTIES, DIFFICULTY_LABELS } from '../../ai/difficulty'
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
  /**
   * 变更前的拦截钩子（防误触确认）。返回 `false` = 这次不算数：不换选中、
   * 也不搬焦点；**打开确认弹窗的副作用由它自己完成**（`onChange` 不会被调用）。
   *
   * **只给模式与执子**——`setMode` / `setHumanColor` 会重建棋局（`newGame`），
   * 而 `setDifficulty` 只改一个字段、不重开（仓库既定语义，任务书点名不许改）。
   */
  beforeModeChange?: (mode: GameMode) => boolean
  beforeHumanColorChange?: (color: Player) => boolean
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {hint !== undefined && <span className="text-xs text-faint">{hint}</span>}
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
    beforeModeChange,
    beforeHumanColorChange,
  } = props

  return (
    <div className="space-y-3">
      {/*
        这一组**默认展开**：模式 / 执子 / 难度是「需要经常调整的基础对战设置」
        （任务书 §六 对左栏的定位），把它们折起来等于给高频操作加一次点击。
        要折的是下面那组显示偏好。
      */}
      <Panel title="对局设置" collapsible defaultOpen bodyClassName="space-y-4">
        <Field label="模式">
          <Segmented
            label="对战模式"
            value={mode}
            onChange={onModeChange}
            beforeChange={beforeModeChange}
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
                beforeChange={(value) =>
                  beforeHumanColorChange?.(value === '1' ? BLACK : WHITE) ?? true
                }
                options={[
                  { value: '1', label: '执黑先行' },
                  { value: '2', label: '执白后行' },
                ]}
              />
            </Field>

            <Field label="AI 难度" hint="越高越强，也越慢">
              <Segmented
                label="AI 难度"
                columns={3}
                value={difficulty}
                onChange={onDifficultyChange}
                options={AVAILABLE_DIFFICULTIES.map((value) => ({
                  value,
                  label: DIFFICULTY_LABELS[value],
                }))}
              />
            </Field>
          </>
        )}
      </Panel>

      <Panel title="显示与声音" collapsible padding="tight" bodyClassName="space-y-1">
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
