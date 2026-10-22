import type { Difficulty } from '../ai/types'
import type { Player, Point } from '../core/types'

/**
 * 一局棋的**内容身份**。
 *
 * 不是 `seq`：自增主键只在本次浏览器/本次库里有效，换设备、清库、导出再导入
 * 都会变。判断「是不是同一局」只能看内容——先手、手顺、模式、执子、难度、
 * 认输方。`winner` 不单独参与：它由手顺与认输方推导，重复放进去只会让同一局
 * 因为推导差异被当成两局。
 */
export interface RecordIdentity {
  readonly firstPlayer: Player
  readonly moves: readonly Point[]
  readonly mode: 'pve' | 'pvp'
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly resignedBy: Player | null
}

/**
 * 规范化键。用数组而不是 `${a}|${b}` 拼接：手顺里没有字符串，数组序列化
 * 不会出现分隔符碰撞；字段顺序固定，所以同一局永远得到同一个键。
 */
export function recordContentKey(record: RecordIdentity): string {
  return JSON.stringify([
    record.firstPlayer,
    record.mode,
    record.humanColor,
    record.difficulty,
    record.resignedBy,
    record.moves.map((point) => [point.x, point.y]),
  ])
}
