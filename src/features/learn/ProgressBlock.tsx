import { Button } from '../../components/ui/Button'

/** 这一块的文案。教学页与残局页用的量词、动词、完成语都不同，一起传。 */
export interface ProgressTexts {
  /** 载入中那行字。 */
  readonly loading: string
  /**
   * 计数的动词：「已完成」/「已通过」。
   *
   * 与 `unit` 分开是因为中文里它们**不是同一个模板的两个槽**——残缺局面的
   * 动词不同（学 vs 通过），换个量词拼不出来。残局那句必须**原样**是
   * `已通过 X / 15 题`：探针三个状态的 boot 绑着逐字文案（`ui.probe.mjs:617`）。
   */
  readonly doneLabel: string
  /** 计数用的量词：「节」/「题」。 */
  readonly unit: string
  /** 主操作的动词：「继续学习」/「继续挑战」。 */
  readonly action: string
  /** 全部完成时那句话。两页想把人送去的地方不同，所以是整句而不是模板。 */
  readonly allDone: string
}

export interface ProgressBlockProps {
  /** 进度是否已从存储载入。**false 时不许出现任何数字**——那是在说一件还不知道的事。 */
  readonly loaded: boolean
  readonly done: number
  readonly total: number
  /**
   * 这一块的 `data-testid` 前缀，同时**是 e2e 的契约**。
   *
   * 四个测试点由它派生：`{testId}`（计数）、`{testId}-block`（真实块）、
   * `{testId}-bar`（进度条填充）、`{testId}-loading`（占位）。
   *
   * 做成参数而不是从 `unit` 推：拿一个文案去生成一个契约，改文案就会断测试。
   * 两页各有一个已经存在的抓手（`learn-progress` / `puzzle-progress`），
   * 各有断言钉着。
   */
  readonly testId: string
  readonly texts: ProgressTexts
  /**
   * 主操作指向的那一项。
   *
   * **是个描述符**（`{ title, run }`），不是「一个对象 + 一个可选回调」：
   * 那样写会出现「`next` 有值而回调没传」的状态，渲染出一颗点了没反应的
   * 主按钮——而类型系统拦不住它。绑成一个值，这种状态就不存在。
   *
   * `null` 有两种含义，用 `loaded` 分开：还没读出来，或者**全部完成了**。
   * 合成一个布尔值会让「加载中」和「全完成」显示成同一句话，那正是
   * `LearnScreen` 原先要避免的错误（载入前显示「已完成 0 节」）。
   */
  readonly next: ProgressTarget | null
}

/** 主操作的目标：显示什么、点了去哪。两件事绑在一起，不允许只出现一半。 */
export interface ProgressTarget {
  readonly title: string
  readonly run: () => void
}

/**
 * 列表页顶部的进度区：进度条 + X / N + 主操作。教学页与残局页共用。
 *
 * **这里是本页唯一的主操作**（`DESIGN_SYSTEM.md` §6.1「一屏最多一个 `primary`」）。
 * 推荐的那张卡片只做弱标记、不再放第二颗按钮——两个控件通向同一节课，
 * 对读屏用户是两个「继续学习」，反而更绕。
 *
 * 抽出来的理由不是「看着像」：进度条实现、载入占位、`progressbar` 的 aria 三件套
 * 会有两份，而这两块 UI **注定要一起演进**（改进度条样式就要改两处）。
 */
export function ProgressBlock({ loaded, done, total, testId, texts, next }: ProgressBlockProps) {
  /*
    载入态要**占位**，不是不渲染。
    原先的做法是 meta 整块 `undefined`：不显示「0 / 8」这件事做对了，但页面上
    什么都没有，进度读出来的一瞬间内容会把页面顶下去。

    **占位与真实块等高这件事，要在各个页面自己的 e2e 里量**（教学页量过 0 / 8
    那一档，差 ≤ 8 px；八节全完成那一档没量——那时第三行是一段文字、比按钮矮，
    那块会**往上缩**而不是把内容推下去）。这段注释不是「已经验过」的意思。
  */
  if (!loaded) {
    return (
      <section
        aria-busy="true"
        data-testid={`${testId}-loading`}
        className="rounded-xl border border-border bg-surface px-4 py-3"
      >
        <p className="text-xs text-faint">{texts.loading}</p>
        <div className="mt-2 h-2 rounded-full bg-surface-2" />
        <div className="mt-3 h-9 rounded-lg bg-surface-2" />
      </section>
    )
  }

  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <section data-testid={`${testId}-block`} className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span data-testid={testId} className="text-xs text-muted">
          {texts.doneLabel} {done} / {total} {texts.unit}
        </span>
        <span className="font-mono text-xs tabular-nums text-faint">{percent}%</span>
      </div>

      <div
        role="progressbar"
        /*
          中性文案：这里是两页共用的块，写死「课程」在残局页就是错的。
          具体是什么的进度由页面标题交代，读屏用户听到的是「完成进度，3 / 8」。
        */
        aria-label="完成进度"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          data-testid={`${testId}-bar`}
          className="h-full rounded-full bg-accent"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 数量由 `total` 推出来，不写死「八」——加了内容这句会撒谎 */}
      {next === null ? (
        <p className="mt-3 text-sm text-good">{texts.allDone}</p>
      ) : (
        <Button variant="primary" block className="mt-3" onClick={next.run}>
          {texts.action}：{next.title}
        </Button>
      )}
    </section>
  )
}
