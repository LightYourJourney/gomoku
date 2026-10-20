import { CELL_COUNT, type Board, type Player, type Point } from '../core/types'
import { countCall } from './metrics'

/**
 * 局面哈希，用两个 32 位分量表示。
 *
 * 不用 BigInt 拼成一个 64 位数：BigInt 的算术比 Number 慢一到两个数量级，
 * 而哈希要在搜索的每个节点增量更新，那里省不得。两个 32 位分量配合
 * 「主键取 hi、校验用 lo」的置换表，碰撞概率足够低而代价足够小。
 */
export interface ZobristKey {
  readonly hi: number
  readonly lo: number
}

/**
 * 用确定性 PRNG（xorshift32）生成随机表，而不是 Math.random。
 *
 * 同一份代码在任何环境、任何次运行都得到同一张表，调试时哈希值可复现；
 * Math.random 每次启动都不一样，出了哈希相关的问题将无从对照。
 */
function createRandomTable(): { hi: Uint32Array; lo: Uint32Array } {
  let state = 0x9e3779b9

  const next = (): number => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state
  }

  // 两种颜色各一份，每格一个。
  const hi = new Uint32Array(CELL_COUNT * 2)
  const lo = new Uint32Array(CELL_COUNT * 2)
  for (let i = 0; i < hi.length; i++) {
    hi[i] = next()
    lo[i] = next()
  }

  return { hi, lo }
}

const CELL_RANDOM = createRandomTable()
/** 「轮到谁走」也要进哈希，否则同一棋盘上双方视角的局面会撞在一起。 */
const TURN_HI = 0x1b873593
const TURN_LO = 0xcc9e2d51

function slotOf(index: number, player: Player): number {
  return (player === 1 ? 0 : 1) * CELL_COUNT + index
}

/** 从零算一遍整盘哈希。搜索里请用 toggleStone 增量维护。 */
export function computeKey(board: Board, player: Player): ZobristKey {
  let hi = 0
  let lo = 0

  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = board[i]
    if (cell === 0) continue

    const slot = slotOf(i, cell as Player)
    hi ^= CELL_RANDOM.hi[slot]
    lo ^= CELL_RANDOM.lo[slot]
  }

  if (player === 2) {
    hi ^= TURN_HI
    lo ^= TURN_LO
  }

  return { hi: hi >>> 0, lo: lo >>> 0 }
}

/**
 * 在某格上放入或拿走一颗棋子。异或天然可逆，落子与撤销是同一个操作，
 * 这是增量维护能与一次性计算保持一致的根本原因。
 */
export function toggleStone(key: ZobristKey, index: number, player: Player): ZobristKey {
  const slot = slotOf(index, player)
  return {
    hi: (key.hi ^ CELL_RANDOM.hi[slot]) >>> 0,
    lo: (key.lo ^ CELL_RANDOM.lo[slot]) >>> 0,
  }
}

export function toggleTurn(key: ZobristKey): ZobristKey {
  return { hi: (key.hi ^ TURN_HI) >>> 0, lo: (key.lo ^ TURN_LO) >>> 0 }
}

export type TtFlag = 'exact' | 'lower' | 'upper'

export interface TtEntry {
  /** 校验分量。查到条目后必须与查询键的 lo 比对，一致才算真命中。 */
  readonly lo: number
  readonly depth: number
  readonly score: number
  readonly flag: TtFlag
  /** 该局面下搜到的最佳着法，可用于优先排序 */
  readonly move: Point | null
}

export interface TranspositionTable {
  /** 深度不足视为未命中。 */
  probe(key: ZobristKey, depth: number): TtEntry | null
  store(key: ZobristKey, entry: TtEntry): void
  readonly size: number
  clear(): void
}

/**
 * 置换表：用 `key.hi` 做主键，命中后再用 `lo` 校验。
 *
 * 十万级条目下 32 位主键会撞上个位数次，`lo` 校验把它们挡掉。相比用字符串
 * 拼两个分量做键，这样快得多；相比只用 32 位，又安全得多。
 *
 * 替换策略：同一主键冲突时保留深度更大的条目——浅层结果的价值低，
 * 丢掉它比丢掉深层结果划算。
 */
export function createTranspositionTable(): TranspositionTable {
  const slots = new Map<number, TtEntry>()

  return {
    probe(key, depth) {
      countCall('ttProbe')
      const found = slots.get(key.hi)
      if (found === undefined) return null
      if (found.lo !== key.lo) return null
      if (found.depth < depth) return null
      return found
    },

    store(key, entry) {
      countCall('ttStore')
      const existing = slots.get(key.hi)
      if (existing !== undefined && existing.lo === key.lo && existing.depth > entry.depth) return
      slots.set(key.hi, entry)
    },

    get size() {
      return slots.size
    },

    clear() {
      slots.clear()
    },
  }
}
