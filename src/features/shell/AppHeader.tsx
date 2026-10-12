import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { THEME_LABELS, THEME_PREFERENCES } from '../../lib/theme'
import { useLearnStore, type View } from '../../store/learnStore'
import { useSettingsStore } from '../../store/settingsStore'

/**
 * 品牌标记。
 *
 * 画成内联 SVG，不是几个 `<div>`：**用 div 时那五颗子会溢出底板**——
 * 32px 的底板里塞了 47px 宽的一排圆点，第 4、5 颗压到了「Gomoku Lab」上面
 * （Phase 01 实测：底板 `x=24..56`，圆点一直排到 `x=71`）。
 * SVG 有坐标系，尺寸只有一个来源，不可能再画出去。
 *
 * 五颗子是黑白黑白黑的排列——「连成五个」就是这项运动的胜负判据。
 *
 * 配色**写死，不跟随主题**。它不是界面的一部分，是标识：自带底板、自定对比度，
 * 深浅两套下必须是同一个东西。用主题令牌的后果放大实测过——暗色的木纹令牌是近黑的
 * `#3b3129`，黑子 `#0b0b0d` 压上去直接消失，整个标记只剩两枚白子悬在空处。
 * 取值就是浅色主题的木纹与棋子色：与棋盘同一套观感，只是不随主题翻转。
 * 与 `AppErrorBoundary` 写死颜色是同一种取舍——**自己画底，就不能再继承**。
 */
const BRAND = {
  woodA: '#edd3a6',
  woodB: '#dcbb87',
  grid: 'rgb(72 47 18 / 0.45)',
  black: '#0b0b0d',
  white: '#ffffff',
} as const

function BrandMark() {
  const stones = [
    { x: 4, dark: true },
    { x: 9, dark: true },
    { x: 14, dark: false },
    { x: 19, dark: false },
    { x: 24, dark: true },
  ] as const

  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl shadow-sm"
        style={{ background: `linear-gradient(135deg, ${BRAND.woodA}, ${BRAND.woodB})` }}
      >
        <svg viewBox="0 0 28 28" className="h-7 w-7">
          <g stroke={BRAND.grid} strokeWidth="0.6">
            <line x1="4" y1="4" x2="24" y2="4" />
            <line x1="4" y1="24" x2="24" y2="24" />
            <line x1="4" y1="4" x2="4" y2="24" />
            <line x1="24" y1="4" x2="24" y2="24" />
          </g>
          {stones.map((stone) => (
            <circle
              key={stone.x}
              cx={stone.x}
              cy="14"
              r="2.2"
              fill={stone.dark ? BRAND.black : BRAND.white}
              // 白子压在木色上会糊掉，给它一圈极淡的描边
              stroke={stone.dark ? 'none' : 'rgb(0 0 0 / 0.22)'}
              strokeWidth="0.5"
            />
          ))}
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-fg">Gomoku Lab</div>
        {/* 全站唯一的 11px —— 它是标识的一部分，不是要读的句子 */}
        <div className="text-micro text-faint">五子棋实验室</div>
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
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-border-strong hover:text-fg active:brightness-95"
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
  review: '复盘',
}

const NAV_ORDER: readonly View[] = ['battle', 'learn', 'puzzles', 'review']

/**
 * 顶层导航。四个页面共用同一个顶栏，切换时只换中间那块内容。
 *
 * 选中项用 `text-accent` 而不只是加一点底色：规范里 `accent` 的语义就是
 * 「主要操作与**当前所在位置**」，而「我在哪一页」值得用最强的那个信号。
 * 底色仍然留着——只改文字色的话，深浅两套主题里的对比强度不一样。
 */
function AppNav() {
  const view = useLearnStore((state) => state.view)
  const setView = useLearnStore((state) => state.setView)

  return (
    <nav
      aria-label="主导航"
      // 窄屏铺成等宽四列、占满整行；sm 以上收成贴着文字的横排
      className="grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1 sm:flex sm:items-center"
    >
      {NAV_ORDER.map((entry) => (
        <button
          key={entry}
          type="button"
          onClick={() => setView(entry)}
          aria-current={view === entry ? 'page' : undefined}
          className={cx(
            'min-h-8 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition',
            /*
             * 选中项用**强调色的浅底**，不是「浮起的白底」。
             *
             * 白底那版在浅色下没问题，到深色就反了：令牌的层级在深色里是
             * `surface`(深) → `surface-2`(浅)，于是「浮起」变成「凹陷」。
             * `accent-soft` + `accent` 两套主题里都是「往前一步」，
             * 而且这一对颜色在 `lib/contrast.test.tsx` 的配对表里，
             * 两套主题的对比度都是守着的。
             */
            view === entry
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:text-fg active:brightness-95',
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
 *
 * `sticky` 是为了**统一的滚动策略**：此前教学 / 残局的列表页把顶栏放在滚动容器
 * **里面**，一滚导航就没了；复盘页放在外面，永远都在。同一件事两种行为，
 * 用户在页面之间切换时会以为界面坏了。`min-h` 则保证换行与否都不跳高度。
 */
export function AppHeader({ children }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex min-h-15 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur lg:px-6">
      <BrandMark />
      {/*
        导航紧跟在品牌后面；窄屏上靠 `order-last w-full` 换行到第二行，**铺满整行**。
        只给 `w-full` 而不铺满时，四个按钮挤在左边、右边空出一大片，
        看起来像没排完版。
      */}
      <div className="order-last w-full sm:order-none sm:ml-1 sm:w-auto">
        <AppNav />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {children}
        <ThemeToggle />
      </div>
    </header>
  )
}
