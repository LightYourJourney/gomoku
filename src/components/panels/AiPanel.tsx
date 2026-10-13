import { useId, useState } from 'react'
import type { SearchReason } from '../../ai/types'
import { formatPoint } from '../../lib/coords'
import { cx } from '../../lib/cx'
import type { AiInfo } from '../../store/gameStore'
import { Button } from '../ui/Button'
import { InfoButton } from '../ui/InfoDisclosure'
import { Panel } from '../ui/Panel'

/**
 * 「AI 为什么走了这一手」的**唯一**一张表，两个消费方共用：
 *
 * - `label` —— 技术详情里的短标签（原先的 `REASON_LABELS`）；
 * - `player` —— 默认层的自然语言。
 *
 * **合成一张表是有意的。** 拆成两份就是同一个 `SearchReason` 上的两套穷举映射，
 * 加一档只改一处、漏一处不会报错——那种错误要等到界面上两句话自相矛盾才被发现。
 *
 * `player` 这句话**只能由 `reason` 生成**，不许加任何引擎没说过的推断。
 * `reason` 的含义在 `src/ai/types.ts` 里逐条写着；任务书 §七 明令
 * 「禁止伪造胜率、精确度、绝对最佳着法或 AI 的自然语言推理过程」——
 * 所以这里没有「因为对手有活三」这类话，引擎没这么说，我们就不许这么写。
 */
const REASON_TEXT: Record<SearchReason, { label: string; player: string }> = {
  /*
   * `win` **不等于**「刚补成五子」。它有两个来源（`src/ai/search.ts`）：
   *   1. `:463` 这一步直接成五——那种情况下「补成五子」是实话；
   *   2. `:490` 的 `findForcedWin`（算杀 / VCT）——**首手可以只是活三**，
   *      棋盘上一颗五连都不会出现。
   * 实测过：盘面 `...BBB.........`（黑活三、无四）也返回 `reason: 'win'`。
   * 初稿写的「AI 补成了五子」对第 2 种是**假话**，违反任务书 §七
   * 「禁止伪造……AI 的自然语言推理过程」。改成对两种都成立的说法：
   * 说的是**引擎算出了什么**，不是「棋盘上出现了什么」。
   */
  win: { label: '直接取胜', player: 'AI 看到一条连成五子的必胜路线，走了它的第一步。' },
  block: { label: '必须防守', player: 'AI 在防守：你下一手能连成五子，它先堵住。' },
  search: { label: '搜索结果', player: 'AI 完整搜索后选了这一手。' },
  opening: { label: '开局天元', player: '开局第一手，AI 占了天元。' },
  timeout: { label: '超时回退', player: '时间到了还没搜完，这一手是启发式兜底。' },
  no_move: { label: '无棋可走', player: '棋盘已满，AI 没有可落子的位置。' },
}

const CONFIDENCE_LABELS = {
  exact: '精确',
  heuristic: '启发式',
} as const

export interface AiPanelProps {
  thinking: boolean
  info: AiInfo | null
  error: string | null
  /** AI 还没能落子。此时不给重试入口，玩家就只能重开或认输了。 */
  canRetry: boolean
  onRetry: () => void
  onDismissError: () => void
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-xs text-faint">{label}</div>
      <div className="mt-1 font-mono text-xs tabular-nums text-fg">{value}</div>
    </div>
  )
}

/**
 * AI 引擎面板。**两级信息**（任务书 §七）：
 *
 * - **默认层（玩家视图）**：一句人话，由真实的引擎输出（`reason` / `confidence`）生成，
 *   外加启发式时必须出现的免责说明。不出现任何搜索指标。
 * - **展开层（技术详情）**：深度 / 节点 / 耗时 / 评分 / 判断 / 结论 + 算法说明，
 *   收在标题右侧的「?」后面，**展开状态不持久化**（`DESIGN_SYSTEM.md` §7）。
 *
 * 为什么 `thinking` 那句改掉了「正在 Web Worker 中搜索」：§7 的禁用清单里
 * **第一个例子就是 Web Worker**，而任务书 §七 给默认层举的例是「AI 正在分析局面……」。
 * 实现细节本来就该在展开层。
 */
export function AiPanel({ thinking, info, error, canRetry, onRetry, onDismissError }: AiPanelProps) {
  const [showInfo, setShowInfo] = useState(false)
  const infoId = useId()
  const hasResult = info !== null

  return (
    <Panel
      title="AI 引擎"
      actions={
        // 没有结果就没什么可展开的——按钮跟着内容一起出现，不摆一个空壳
        hasResult ? (
          <InfoButton
            open={showInfo}
            onToggle={() => setShowInfo((value) => !value)}
            label="AI 引擎的技术详情"
            controls={showInfo ? infoId : undefined}
          />
        ) : undefined
      }
    >
      {/*
        重试入口的显隐只由 canRetry 决定，不能挂在「有没有错误消息」下面——
        玩家一点「知道了」，错误清了，可 AI 欠着的那一手还在，入口却跟着消失，
        对局就彻底卡死了。
      */}
      {(error !== null || canRetry) && (
        <div
          role="alert"
          className={cx(
            'mb-3 rounded-lg px-3 py-2 text-xs',
            error !== null ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn',
          )}
        >
          <p className="break-words">{error ?? 'AI 还没落子，这一手需要重试。'}</p>
          {/*
            这两个是低权重操作，用 `ghost` 档。此前是裸 `<button>`＋下划线，
            命中区只有 24×16——**低于 WCAG 2.5.8 的 24px 下限**，
            而它们恰恰长在「出错了要恢复」这条路径上。
          */}
          <div className="mt-2 flex items-center gap-2">
            {canRetry && (
              <Button variant="ghost" size="sm" onClick={onRetry}>
                重试
              </Button>
            )}
            {error !== null && (
              <Button variant="ghost" size="sm" onClick={onDismissError}>
                知道了
              </Button>
            )}
          </div>
        </div>
      )}

      {thinking ? (
        <p className="py-2 text-xs text-muted">AI 正在分析局面…</p>
      ) : info === null ? (
        <p className="py-2 text-xs text-faint">尚未产生分析结果。</p>
      ) : (
        <div className="space-y-2">
          {/*
            落点单独成一句：任务书 §七 给玩家视图举的两个例子里就有一个是
            「推荐落点：H8」。`no_move`（棋盘已满）时没有落点，那时不编一个出来。
          */}
          <p className="text-xs leading-relaxed text-fg">
            <span data-testid="ai-player-view">{REASON_TEXT[info.reason].player}</span>
            {info.move !== null && (
              <>
                {' '}落点{' '}
                <span data-testid="ai-move" className="font-mono font-semibold tabular-nums">
                  {formatPoint(info.move)}
                </span>
                。
              </>
            )}
          </p>

          {/*
            启发式的免责说明**恒在默认层**。任务书 §七：「禁止把启发式判断包装成确定性结论」。
            `confidence` 与 `reason` 是 1:1 的（`search.ts:564`：只有 `timeout` 才是启发式），
            所以有这段就够，不需要再加一个「精确」的徽标去说一件没说错的事。
          */}
          {info.confidence === 'heuristic' && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              时间预算内未搜完，这一手是启发式建议，不保证最优。
            </p>
          )}
        </div>
      )}

      {hasResult && showInfo && (
        <div id={infoId} className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="判断" value={REASON_TEXT[info.reason].label} />
            <Stat label="结论" value={CONFIDENCE_LABELS[info.confidence]} />
            <Stat label="搜索深度" value={`${info.depth} 层`} />
            <Stat label="搜索节点" value={String(info.nodes)} />
            <Stat label="耗时" value={`${info.elapsedMs} ms`} />
            <Stat label="局面评分" value={String(info.score)} />
          </div>

          <p className="text-xs leading-relaxed text-faint">
            引擎跑在 Web Worker 里，用 Negamax + Alpha-Beta 迭代加深，配 Zobrist 置换表与
            杀手着法；中级以上还会先跑一遍算杀（连续冲四）。「搜索深度」是已经完整搜完的层数——
            时间预算不够时会退回上一层的结果，所以它不是固定的。
          </p>
        </div>
      )}
    </Panel>
  )
}
