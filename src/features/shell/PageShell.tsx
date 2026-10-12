import type { ReactNode } from 'react'
import { AppHeader } from './AppHeader'

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
export function PageShell({ children, toolbar, footer, variant = 'reading' }: PageShellProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader />
      {toolbar}
      {variant === 'reading' ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* 阅读列：768px 是中文长文舒服的行宽上限，再宽视线会来回折返 */}
          <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-4 lg:px-6">{children}</div>
        </main>
      ) : (
        /*
         * 棋盘型正文：窄屏纵向堆叠，lg 起变成「棋盘 + 344px 侧栏」两栏。
         *
         * **这里刻意没有 `grid-rows`。** 有过一次教训：三处详情页曾经写着
         * `lg:grid-rows-[auto_minmax(0,1fr)]`，那是给「工具栏当网格第一行」写的；
         * 工具栏移出去以后这行模板没删，棋盘于是落进 `auto` 行，行高由侧栏内容
         * 决定——1440 下棋盘被压到 **169×169 px、交叉点命中区 11×11**
         * （FINDINGS 的 F-UI-01）。删掉行模板后只剩一个隐式行，
         * `align-content: normal`（= `stretch`）会把它撑满，棋盘拿到整列高度。
         */
        <main className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_344px]">
          {children}
        </main>
      )}
      {footer}
    </div>
  )
}
