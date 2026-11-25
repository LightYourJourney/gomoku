import type { ReactNode } from 'react'
import { useFocusOnMount } from '../../lib/useFocusOnMount'
import { AppHeader } from './AppHeader'

/**
 * 棋盘型页面右侧那一栏。
 *
 * 三个调用点（练习 / 讲解 / 回放）除了排列顺序以外**逐字相同**，而顺序只有两种。
 * 抽出来不是为了少打字：**断点条件只该有一个定义**——Phase 05 把「≥1024 两栏」
 * 改成 `wide-layout` 时就有四处类名要一起改，漏一处就是「已经是两栏了，
 * 可那一栏既不滚、也没有分隔线」。
 *
 * **对战页不用它**：它自有三档（`BattleScreen`）。两栏条件与这里同为 `wide-layout`
 * （Phase 05 并过来的），三栏另由 JS 判 ≥1440。
 */
export const SIDE_PANEL_CLASS =
  'wide-layout:overflow-y-auto wide-layout:border-l wide-layout:border-border wide-layout:px-4 wide-layout:py-4'

export type PageVariant =
  /** 阅读型：正文是居中限宽的一列。教学 / 残局 / 复盘的列表页。 */
  | 'reading'
  /** 棋盘型：正文自己管栅格（棋盘 + 侧栏）。课程、练习、残局详情、复盘回放。 */
  | 'flush'

export interface PageShellProps {
  children: ReactNode
  /** 顶栏下方的页面级工具栏（返回按钮、课名、翻页）。 */
  toolbar?: ReactNode
  /** 正文之后、页面底部的说明。 */
  footer?: ReactNode
  variant?: PageVariant
  /** 分享预览等独立页面隐藏四个模块导航。 */
  showNav?: boolean
}

/**
 * 页面外壳。六个页面位置共用，**只有两个模式、没有别的配置**。
 *
 * 抽出来的理由不是「复用」而是**一致性**：原先六处各写了一遍容器，
 * 而且滚动容器放在了不同的层——教学 / 残局的列表页把 `AppHeader` 放进了
 * 滚动容器**里面**，一滚导航就没了；复盘页放在外面，永远都在。
 * 同一件事两种行为，用户在页面之间切换时会以为界面坏了。
 *
 * 现在统一成：外壳 → 顶栏 → 可选工具栏 → 正文（自己滚，或者自己管栅格）。
 *
 * **对战页不用它**——它是棋盘优先布局，三栏的宽度与高度自成一套，
 * 硬套一个「阅读列」的壳只会两边都不像。
 */
export function PageShell({ children, toolbar, footer, variant = 'reading', showNav = true }: PageShellProps) {
  /*
   * 换页时把焦点交给正文。不这么做的话，用户点的那个按钮连同整棵树一起
   * 卸载，焦点掉回 `<body>`——读屏不播报新页面，键盘用户得从头 Tab 一遍。
   * 两个分支共用同一个 ref：条件渲染只会挂上其中一个。
   */
  const mainRef = useFocusOnMount<HTMLElement>()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader showNav={showNav} />
      {toolbar}
      {variant === 'reading' ? (
        <main
          ref={mainRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          {/* 阅读列：768px 是中文长文舒服的行宽上限，再宽视线会来回折返 */}
          <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-4 lg:px-6">{children}</div>
        </main>
      ) : (
        /*
         * 棋盘型正文：两栏条件（`wide-layout`）未命中时纵向堆叠，命中后变成「棋盘 + 侧栏」两栏。
         *
         * **侧栏宽 `clamp(300px,24vw,380px)`**（DESIGN_SYSTEM §10.2 第 2 条：用 `clamp()`，不用固定 px）。
         * 与对战页三栏的右栏同一个式子；下限 300 是 §10.2 写的两栏右栏下限。
         * 1024→300、1280→307、1440→346：1024 / 1280 比原先的固定 344 窄，棋盘列只会更宽；
         * 1440 多出 2px，那一档棋盘被高度卡住，列宽少 2px 不影响棋盘。
         * 768–1023 横屏那一档侧栏取下限 300，比原来省下 44px 给棋盘。
         *
         * **这里刻意没有 `grid-rows`。** 有过一次教训：三处详情页曾经写着
         * `lg:grid-rows-[auto_minmax(0,1fr)]`，那是给「工具栏当网格第一行」写的；
         * 工具栏移出去以后这行模板没删，棋盘于是落进 `auto` 行，行高由侧栏内容
         * 决定——1440 下棋盘被压到 **169×169 px、交叉点命中区 11×11**
         * （FINDINGS 的 F-UI-01）。删掉行模板后只剩一个隐式行，
         * `align-content: normal`（= `stretch`）会把它撑满，棋盘拿到整列高度。
         */
        <main
          ref={mainRef}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col outline-none wide-layout:grid wide-layout:grid-cols-[minmax(0,1fr)_clamp(300px,24vw,380px)] ultra-wide:grid-cols-[minmax(0,1fr)_clamp(380px,26vw,520px)]"
        >
          {children}
        </main>
      )}
      {footer}
    </div>
  )
}
