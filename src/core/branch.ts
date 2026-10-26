import { replay, type GameState } from './game'
import type { Player, Point } from './types'

/**
 * 一条棋谱中可用于创建分支的原始信息。
 *
 * **不携带完整 GameRecord**：分支只需要前缀与先手方，原棋谱由持久层按 seq
 * 另取。这样分支起点检查不会把“记录是否入库”与“局面是否合法”混在一起。
 */
export interface BranchSource {
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
}

export interface BranchBuildOk {
  readonly ok: true
  readonly game: GameState
}

export interface BranchBuildError {
  readonly ok: false
  readonly error: string
}

export type BranchBuild = BranchBuildOk | BranchBuildError

/**
 * 从棋谱的第 `cursor` 手之后建立可继续对弈的局面。
 *
 * `cursor` 与回放器同一语义：0 是空盘，N 是第 N 手之后。**只用前缀**，绝不
 * 把后面的手顺带进新局。重放必须完整消费前缀——`replay()` 会静默截断非法手顺，
 * 这里把它变成明确拒绝，避免用损坏棋谱创建“正式”对局。
 *
 * 认输不是棋盘终局：`resignedBy` 不参与这里的判断。若前面的手顺没有五连/和棋，
 * 即使原局在最后一手后认输，也可以从该盘面继续探索；新局不会继承认输标记。
 */
export function buildBranchGame(source: BranchSource, cursor: number): BranchBuild {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > source.moves.length) {
    return { ok: false, error: '分支手数必须位于 0 到棋谱总手数之间' }
  }

  const prefix = source.moves.slice(0, cursor)
  const game = replay(prefix, source.firstPlayer)
  if (game.moves.length !== prefix.length) {
    return { ok: false, error: '棋谱手顺无法完整重放，不能创建分支' }
  }
  if (game.status === 'won') {
    return { ok: false, error: `第 ${cursor} 手已有五连终局，请回到终局之前` }
  }
  if (game.status === 'draw') {
    return { ok: false, error: `第 ${cursor} 手已是满盘和棋，不能继续落子` }
  }

  return { ok: true, game }
}
