import type { PositionProvenance } from '../core/position'
import type { Player } from '../core/types'

/** 局面内容身份：标题不参与；盘面/下一手/已知手顺相同即同一局面。 */
export function positionContentKey(input: {
  readonly cells: readonly number[]
  readonly nextPlayer: Player
  readonly provenance: PositionProvenance | null
}): string {
  return JSON.stringify([input.cells, input.nextPlayer, input.provenance])
}
