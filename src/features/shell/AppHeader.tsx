import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { THEME_LABELS, THEME_PREFERENCES } from '../../lib/theme'
import { useLearnStore, type View } from '../../store/learnStore'
import { useSettingsStore } from '../../store/settingsStore'

function BrandMark() {
  const stones = [1, 1, 2, 2, 1] as const

  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] shadow-sm"
        style={{ background: 'linear-gradient(135deg, var(--c-board-a), var(--c-board-b))' }}
      >
        <div className="flex gap-[3px]">
          {stones.map((player, index) => (
            <span
              key={index}
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background:
                  player === 1
                    ? 'radial-gradient(circle at 35% 30%, var(--c-stone-black-a), var(--c-stone-black-b))'
                    : 'radial-gradient(circle at 35% 30%, var(--c-stone-white-a), var(--c-stone-white-b))',
              }}
            />
          ))}
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-fg">Gomoku Lab</div>
        <div className="text-[11px] text-faint">五子棋实验室</div>
      </div>
    </div>
  )
}

function ThemeToggle() {
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)

  const index = THEME_PREFERENCES.indexOf(theme)
  const next = THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length]

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`主题：${THEME_LABELS[theme]}（点击切换为${THEME_LABELS[next]}）`}
      aria-label={`主题：${THEME_LABELS[theme]}，点击切换为${THEME_LABELS[next]}`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-border-strong hover:text-fg"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        {theme === 'dark' ? (
          <path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        ) : theme === 'light' ? (
          <>
            <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 5v14" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 5a7 7 0 0 1 0 14Z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  )
}

const NAV_LABELS: Record<View, string> = {
  battle: '对战',
  learn: '教学',
  puzzles: '残局',
}

const NAV_ORDER: readonly View[] = ['battle', 'learn', 'puzzles']

/** 顶层导航。三个页面共用同一个顶栏，切换时只换中间那块内容。 */
function AppNav() {
  const view = useLearnStore((state) => state.view)
  const setView = useLearnStore((state) => state.setView)

  return (
    <nav aria-label="主导航" className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
      {NAV_ORDER.map((entry) => (
        <button
          key={entry}
          type="button"
          onClick={() => setView(entry)}
          aria-current={view === entry ? 'page' : undefined}
          className={cx(
            'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition',
            view === entry ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {NAV_LABELS[entry]}
        </button>
      ))}
    </nav>
  )
}

export interface AppHeaderProps {
  /** 右侧额外内容，例如对战页的局面状态。 */
  readonly children?: ReactNode
}

/**
 * 应用顶栏。对战页原本自带一份，课程页与残局页进来之后抽出来共用——
 * 三个页面各写一份「品牌 + 导航 + 主题」迟早会长歪。
 */
export function AppHeader({ children }: AppHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface/70 px-4 py-3 backdrop-blur lg:px-6">
      <BrandMark />
      <div className="ml-auto flex items-center gap-2">
        {children}
        <ThemeToggle />
      </div>
      {/*
        窄屏上导航换行到第二行整行铺开。挤在同一行会横向溢出——
        品牌、状态、主题、导航四样东西在 390px 里塞不下。
      */}
      <div className="w-full sm:order-first sm:ml-2 sm:w-auto">
        <AppNav />
      </div>
    </header>
  )
}
