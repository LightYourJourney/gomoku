export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** 把「跟随系统」偏好与实际生效的主题分开，纯函数，便于测试。 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

/** 主题只体现在 <html> 的一个类上，组件的样式全部来自 CSS 变量。 */
export function applyTheme(
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  /*
   * 移动端浏览器的地址栏 / 状态栏取这个值。`index.html` 里写死的是浅色，
   * 深色主题下不更新它，手机会一直挂一条浅色横条（F-UI-17）。
   * 两个值与 `index.css` 里 `--c-bg` 的两套令牌同源，改令牌时要一起改。
   * 从 `root` 的 ownerDocument 取，测试可以传任意根元素。
   */
  root.ownerDocument
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0f1115' : '#f6f4f0')
}
