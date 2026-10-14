import { Button } from '../../components/ui/Button'
import type { Lesson } from '../../learn/types'

export interface LessonProgressProps {
  /** 进度是否已从存储载入。**false 时不许出现任何数字**——那是在说一件还不知道的事。 */
  readonly loaded: boolean
  readonly done: number
  readonly total: number
  /**
   * 「继续学习」指向的那节课。
   *
   * `null` 有两种含义，用 `loaded` 分开：还没读出来，或者**八节都做完了**。
   * 合成一个布尔值会让「加载中」和「全完成」显示成同一句话，那正是
   * `LearnScreen` 原先要避免的错误（载入前显示「已完成 0 节」）。
   */
  readonly next: Lesson | null
  readonly onContinue?: () => void
}

/**
 * 列表页顶部的进度区：进度条 + X / N + 继续学习。
 *
 * **这里是本页唯一的主操作**（`DESIGN_SYSTEM.md` §6.1「一屏最多一个 `primary`」）。
 * 推荐的那张卡片只做弱标记、不再放第二颗按钮——两个控件通向同一节课，
 * 对读屏用户是两个「继续学习」，反而更绕。
 */
export function LessonProgress({ loaded, done, total, next, onContinue }: LessonProgressProps) {
  /*
    载入态要**占位**，不是不渲染。
    原先的做法是 meta 整块 `undefined`：不显示「0 / 8」这件事做对了，但页面上
    什么都没有，进度读出来的一瞬间内容会把页面顶下去。

    **这里与真实块的高度是量过的，但只量了一档**：`e2e/learn.spec.ts` 在
    1440×900、0 / 8 那一档比过 —— 差 ≤ 8 px。**八节全完成那一档没量**：
    那时第三行是一段文字（比按钮矮约 16 px），所以那块会**往上缩**一点，
    而不是把下面的内容推下去。要覆盖它得在 e2e 里播一份 8 / 8 的进度
    （套件里没有现成的播种手法），收益不值那些代码——**写在这里，免得被当成已验过**。
  */
  if (!loaded) {
    return (
      <section
        aria-busy="true"
        data-testid="learn-loading"
        className="rounded-xl border border-border bg-surface px-4 py-3"
      >
        <p className="text-xs text-faint">正在读取学习进度…</p>
        <div className="mt-2 h-2 rounded-full bg-surface-2" />
        <div className="mt-3 h-9 rounded-lg bg-surface-2" />
      </section>
    )
  }

  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <section data-testid="learn-progress-block" className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span data-testid="learn-progress" className="text-xs text-muted">
          已完成 {done} / {total} 节
        </span>
        <span className="font-mono text-xs tabular-nums text-faint">{percent}%</span>
      </div>

      <div
        role="progressbar"
        aria-label="课程完成进度"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          data-testid="learn-progress-bar"
          className="h-full rounded-full bg-accent"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 节数由 `total` 推出来，不写死「八」——加了第 9 节课这句会撒谎 */}
      {next === null ? (
        <p className="mt-3 text-sm text-good">
          {total} 节课都完成了。去「残局挑战」把那些棋型再练一遍吧。
        </p>
      ) : (
        <Button variant="primary" block className="mt-3" onClick={onContinue}>
          继续学习：{next.title}
        </Button>
      )}
    </section>
  )
}
