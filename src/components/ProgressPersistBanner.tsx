import { Button } from './ui/Button'

export interface ProgressPersistBannerProps {
  readonly failed: boolean
  readonly onRetry: () => void
}

/**
 * 学习进度落盘失败时的全局提示；成功或重试成功后由调用方卸载。
 *
 * 配色走 `danger-soft` 映射、「重试」走 `ghost` 档（DESIGN_SYSTEM §2.2 / §6.1）——
 * 与其它错误条里的「重试」同一套反馈，不手写一颗没有 hover/active 的裸按钮。
 */
export function ProgressPersistBanner({ failed, onRetry }: ProgressPersistBannerProps) {
  if (!failed) return null
  return (
    <div
      role="alert"
      data-testid="progress-persist-error"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-danger-soft px-3 py-2 text-xs text-danger"
    >
      <span>学习进度未能保存到本机，刷新后可能丢失。</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
