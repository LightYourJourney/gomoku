import { cx } from '../../lib/cx'
import { motionClass } from '../../lib/motion'

export interface FeedbackBannerProps {
  readonly ok: boolean
  readonly message: string
}

/**
 * 判题反馈条。
 *
 * 对错各用一种色调，并且**都要给出理由**——只说「不对」等于没教，
 * 所以 `message` 由判定器算出来（对手的成五点在哪、这一手实际做出了什么棋型），
 * 不是写死的文案。
 */
export function FeedbackBanner({ ok, message }: FeedbackBannerProps) {
  return (
    <p
      role="status"
      data-testid="feedback"
      data-ok={ok}
      className={cx(
        motionClass('bannerIn'),
        'rounded-lg px-3 py-2 text-xs leading-relaxed',
        ok ? 'bg-good-soft text-good' : 'bg-danger-soft text-danger',
      )}
    >
      <span className="font-medium">{ok ? '做得对。' : '还不对。'}</span>
      {ok ? null : ' '}
      {message}
    </p>
  )
}
