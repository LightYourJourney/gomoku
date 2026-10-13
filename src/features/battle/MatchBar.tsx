import { DIFFICULTY_LABELS } from '../../ai/difficulty'
import type { Difficulty } from '../../ai/types'
import { StoneDot } from '../../components/panels/StoneDot'
import { StatusPill } from '../../components/panels/StatusPill'
import type { GameState } from '../../core/game'
import { BLACK, WHITE, type Player } from '../../core/types'
import { cx } from '../../lib/cx'
import type { GameMode } from '../../store/gameStore'
import { describeStatus, playerName } from './status'

export interface MatchBarProps {
  readonly game: GameState
  readonly mode: GameMode
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly aiThinking: boolean
}

/**
 * 对局状态呈现区。棋盘正上方，**双方信息 → 当前回合 → 棋盘** 这条线上的中间一站。
 *
 * 三条设计约束：
 *
 * 1. **左黑右白是固定的空间映射**，与「你」在哪一侧无关。人机模式下玩家的那一侧
 *    标「你」、另一侧标「AI · 难度」；本地双人标「黑方 / 白方」。
 *    任务书点名：双人时**不能沿用单人对 AI 的「你」视角**——同一块屏幕上两个人，
 *    谁是「你」？
 * 2. **状态的标签与色调一律来自 `describeStatus`**，这里一个胜负判断都不复制。
 *    否则界面可见状态与 `BoardAnnouncer` 的读屏播报迟早分叉（任务书要求两者一致）。
 * 3. 行动方用 `bg-accent-soft text-accent` 高亮——`DESIGN_SYSTEM.md` §2.2 里
 *    「当前所在位置」的既定映射（顶栏导航选中项用的就是它）。
 *    **不用 `surface-2`**：它在浅色比 `bg` 深、深色比 `bg` 浅，同一套类名
 *    一张下沉一张浮起，表达不了「当前」。
 */
export function MatchBar({ game, mode, humanColor, difficulty, aiThinking }: MatchBarProps) {
  const status = describeStatus({ game, mode, humanColor, aiThinking })
  // 行动方也用 `status.player`，不自己重推一遍手番——那句「一个判断都不复制」才是真的
  const playing = game.status === 'playing'

  return (
    <section
      aria-label="对局状态"
      /*
       * 两侧按**内容**占宽、中间吃掉剩余并让药丸居中（`justify-self` 在 StatusPill 上）。
       *
       * 原先写的是 `1fr auto 1fr`：两侧各分到固定一半，390 下右侧要同时放下
       * 「AI · 初级」与「12 手」，于是被 `truncate` 切成「A」和「初…」
       * （探针的 `clipped` 量到过）。当时的处置是把窄屏的手数藏掉，但任务书 §三
       * 要求状态区**默认展示当前手数**——改成按内容占宽之后两样都留得住。
       */
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
    >
      <Side player={BLACK} mode={mode} humanColor={humanColor} difficulty={difficulty}
        active={playing && status.player === BLACK} />

      <StatusPill status={status} busy={aiThinking} className="justify-self-center" />

      <div className="flex min-w-0 items-center justify-end gap-2">
        <Side player={WHITE} mode={mode} humanColor={humanColor} difficulty={difficulty}
          active={playing && status.player === WHITE} />
        <span
          data-testid="match-moves"
          className="shrink-0 font-mono text-xs tabular-nums text-faint"
        >
          {game.moves.length} 手
        </span>
      </div>
    </section>
  )
}

interface SideProps {
  readonly player: Player
  readonly mode: GameMode
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly active: boolean
}

function Side({ player, mode, humanColor, difficulty, active }: SideProps) {
  const name = playerName(player, mode, humanColor)
  const detail = mode === 'pve' && player !== humanColor ? DIFFICULTY_LABELS[difficulty] : null

  return (
    <div
      data-testid={`match-side-${player}`}
      data-active={active || undefined}
      className={cx(
        // `w-fit`：高亮只包住这一侧的**内容**，不铺满整格——
        // `grid-cols-[1fr_auto_1fr]` 里的块级元素默认会把整格撑满，
        // 于是「你 · 黑」后面拖出一条 300px 的色带，看着像进度条。
        'flex w-fit min-w-0 items-center gap-2 rounded-lg px-2 py-1',
        active ? 'bg-accent-soft text-accent' : 'text-muted',
      )}
    >
      <StoneDot player={player} />
      <span className="truncate text-xs font-medium">
        {name}
        {mode === 'pve' && player === humanColor && (
          // 执黑还是执白必须说出来：圆点是 aria-hidden 的装饰，光靠它读屏软件读不到
          <span className="font-normal"> · {player === BLACK ? '黑' : '白'}</span>
        )}
      </span>
      {detail !== null && (
        /*
         * **行动方那一侧不能用 `text-faint`。** 探针量到 4.49:1，比 4.5 的线差 0.01——
         * 因为这一侧被 `bg-accent-soft` 点亮了，底色比页面底色浅。
         * 非行动方仍用 faint（那时背景是页面底色，够）。不变量由
         * `yarn ui:probe` 的 `contrastViolations` 守着。
         */
        <span className={cx('truncate text-xs', !active && 'text-faint')}>{detail}</span>
      )}
    </div>
  )
}
