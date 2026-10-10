import type { ThreatKind } from '../ai/patterns'
import type { ShapeKind } from '../learn/types'

/**
 * 棋型的中文名。
 *
 * 一套词汇，两个消费方：AI 提示面板显示「进攻 活四 / 防守 冲四」，判题的理由
 * 显示「这一手做出的是冲四，题目要求活四」。**两处必须用同一套说法**——
 * 玩家在同一局里看到两个名字指同一种棋型，只会以为自己在看两种东西。
 *
 * `ShapeKind` 是 `ThreatKind` 加上活二与眠二（教学要讲，但引擎的威胁判断里
 * 用不到），所以这张表覆盖两者。
 */
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  five: '成五',
  openFour: '活四',
  four: '冲四',
  openThree: '活三',
  three: '眠三',
  openTwo: '活二',
  two: '眠二',
}

/**
 * 供 `ThreatKind` 使用。
 *
 * `ThreatKind` 比 `ShapeKind` 多一个 `'none'`（引擎的威胁判断需要一个「什么都
 * 没做出」的取值），它不是一种棋型，所以不在这张表里。
 */
export function threatLabel(kind: ThreatKind): string {
  return kind === 'none' ? '无' : SHAPE_LABELS[kind]
}
