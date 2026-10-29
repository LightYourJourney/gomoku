export interface ProgressPersistBannerProps {
  readonly failed: boolean
  readonly onRetry: () => void
}

/** 学习进度落盘失败时的全局提示；成功或重试成功后由调用方卸载。 */
export function ProgressPersistBanner({ failed, onRetry }: ProgressPersistBannerProps) {
  if (!failed) return null
  return (
    <div
      role="alert"
      data-testid="progress-persist-error"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      <span>学习进度未能保存到本机，刷新后可能丢失。</span>
      <button
        type="button"
        className="rounded border border-danger/40 px-2 py-1 font-medium"
        onClick={onRetry}
      >
        重试
      </button>
    </div>
  )
}
