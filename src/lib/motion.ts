/**
 * 动效类名。
 *
 * **降级不在这里判**：`prefers-reduced-motion` 由 `index.css` 的媒体查询兜底
 * （`animation: none`）。用 JS 判 `matchMedia` 有两个坑——用户中途改系统设置时
 * 分支不会更新；jsdom 里 `matchMedia` 缺失，靠它判定会让测试与真实行为脱节。
 * 所以这里恒返回类名，是否播动画留给 CSS，也留给了浏览器。
 */
export const MOTION = {
  /** 刚落下的那颗子。只加给最新一手——225 颗每颗都播会让整盘闪。 */
  stoneDrop: 'motion-stone-drop',
  /** 最后一手的朱砂环。 */
  lastMovePulse: 'motion-last-move-pulse',
  /** 弹窗淡入。 */
  panelIn: 'motion-panel-in',
  /** 判题反馈条滑入。 */
  bannerIn: 'motion-banner-in',
} as const

export type MotionKey = keyof typeof MOTION

export function motionClass(key: MotionKey): string {
  return MOTION[key]
}
