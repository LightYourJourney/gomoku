import type { Ref } from 'react'
import { cx } from '../../lib/cx'
import { motionClass } from '../../lib/motion'

export interface FeedbackBannerProps {
  readonly ok: boolean
  readonly message: string
  /**
   * 判题**没算完**（超时）。这时既不能说对也不能说错：用中性色调、不写「还不对。」。
   * 只在 `ok` 为 false 时有意义。
   */
  readonly inconclusive?: boolean
  /** 判题之后焦点没处去时，调用方把焦点接到这里（所以 `tabIndex={-1}`）。 */
  readonly ref?: Ref<HTMLParagraphElement>
}

/**
 * 判题反馈条。
 *
 * 对、错、未定各用一种色调，并且**都要给出理由**——只说「不对」等于没教，
 * 所以 `message` 由判定器算出来（对手的成五点在哪、这一手实际做出了什么棋型），
 * 不是写死的文案。
 *
 * 它**自己不是 live region**：`role="status"` 若随内容一起挂载，部分读屏软件
 * 不播报第一次出现的内容。播报区由调用方常驻渲染，本组件只是往里填的内容。
 */
export function FeedbackBanner({ ok, message, inconclusive = false, ref }: FeedbackBannerProps) {
  const pending = !ok && inconclusive

  return (
    <p
      ref={ref}
      tabIndex={-1}
      data-testid="feedback"
      data-ok={ok}
      data-inconclusive={pending ? true : undefined}
      className={cx(
        motionClass('bannerIn'),
        'rounded-lg px-3 py-2 text-body outline-none',
        ok ? 'bg-good-soft text-good' : pending ? 'bg-surface-2 text-fg' : 'bg-danger-soft text-danger',
      )}
    >
      <span className="font-medium">{ok ? '做得对。' : pending ? '暂无结论。' : '还不对。'}</span>
      {ok ? null : ' '}
      {message}
    </p>
  )
}
