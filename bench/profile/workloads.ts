import { candidateMoves } from '../../src/ai/candidates'
import { replay } from '../../src/core/game'
import { BLACK, WHITE, type Board, type Player } from '../../src/core/types'
import { boardFromLines, nearlyFullBoard } from '../../src/test/board-fixtures'
import { POSITIONS, boardOf } from '../strength/positions'

/**
 * 性能剖析用的局面目录（Phase 10B）。
 *
 * 局面全部**复用**已有来源，不在这里另造一套：
 * - `bench/strength/positions.ts`（Phase 10A 的 16 个标准局面）；
 * - `bench/engine.bench.ts` 的五个基准局面；
 * - `src/test/board-fixtures.ts` 的接近满盘。
 *
 * 每个局面记录来源与 `synthetic` 标记。战术局面（子力数不平衡）**不可由真实
 * 对局到达**，只用于观察「捷径是否生效」，不能当成「引擎在真实局面下的表现」。
 */

export interface Workload {
  readonly id: string
  /** 九个类别之一，用于汇总表。 */
  readonly category: WorkloadCategory
  readonly board: Board
  readonly player: Player
  /** 来源文件，报告里原样列出。 */
  readonly source: string
  /** 不可由合法手顺到达的战术局面。 */
  readonly synthetic: boolean
  /** 补充说明（例如为什么把它归到这一类）。 */
  readonly note?: string
}

export type WorkloadCategory =
  | '开局'
  | '安静中盘'
  | '高候选数中盘'
  | '复杂攻防'
  | '直接成五'
  | '必须防守'
  | 'VCF 有杀'
  | 'VCF 无杀'
  | '接近满盘'

function fromPositions(id: string, category: WorkloadCategory, note?: string): Workload {
  const position = POSITIONS.find((p) => p.id === id)
  if (position === undefined) throw new Error(`Phase 10A 局面库里没有 ${id}`)

  return {
    id,
    category,
    board: boardOf(position),
    player: position.player,
    source: `bench/strength/positions.ts:${id}`,
    synthetic: position.synthetic === true,
    ...(note === undefined ? {} : { note }),
  }
}

/**
 * 真实对局前 6 手（来自 `docs/ai-research/runs/` 里归档的 medium-d3 对局）。
 *
 * 为什么要它：Phase 10A 的战术局面大多被算杀或捷径直接判掉，真正进 Negamax 的
 * 局面反而少。这手顺是**真实下出来**的，由 `replay()` 重建，合法性不靠注释保证。
 * 更深的同一局前缀会被算杀命中（实测第 8 手起 `reason: 'win'`），所以取 6 手。
 */
function realGamePrefix(): Workload {
  const state = replay([
    { x: 6, y: 7 },
    { x: 8, y: 7 },
    { x: 6, y: 9 },
    { x: 6, y: 8 },
    { x: 5, y: 8 },
    { x: 8, y: 8 },
  ])

  if (state.status !== 'playing') throw new Error('真实对局前缀已经分出胜负，不能作为剖析局面')

  return {
    id: 'real-game-ply6',
    category: '复杂攻防',
    board: state.board,
    player: state.current,
    source: 'docs/ai-research/runs/ 归档对局的第 1 局前 6 手',
    synthetic: false,
    note: '真实对局局面；更深的同局前缀会被算杀直接判掉',
  }
}

export const WORKLOADS: readonly Workload[] = [
  fromPositions('opening-adjacent', '开局', '白贴身应手'),
  fromPositions('opening-diagonal', '开局', '白斜向应手'),
  fromPositions('opening-knight', '开局', '白马步应手'),
  {
    id: 'bench-opening',
    category: '开局',
    board: boardFromLines(['...............', '...............', '...............', '......WB.......']),
    player: BLACK,
    source: 'bench/engine.bench.ts:开局',
    synthetic: false,
  },

  {
    id: 'bench-midgame',
    category: '安静中盘',
    board: boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '......WB.......',
      '.....BWB.......',
      '......BW.......',
      '.......B.......',
    ]),
    player: WHITE,
    source: 'bench/engine.bench.ts:中盘',
    synthetic: false,
  },

  fromPositions('quiet-midgame', '高候选数中盘', '81 个候选点，候选数最高的安静局面'),
  {
    id: 'bench-double-three',
    category: '高候选数中盘',
    board: boardFromLines([
      '...............',
      '...............',
      '...............',
      '..........B....',
      '.......B.......',
      '......B........',
      '.....W.W.......',
      '......W........',
    ]),
    player: WHITE,
    source: 'bench/engine.bench.ts:双三',
    synthetic: false,
    note: '62 个候选点，分支多、剪枝效率低',
  },

  fromPositions('double-threat', '复杂攻防', '十字双三：攻防同时存在'),
  fromPositions('threat-not-win', '复杂攻防', '我方活三 + 对方冲四：威胁不构成必胜'),
  realGamePrefix(),

  fromPositions('direct-win-open', '直接成五', '两处成五点'),
  fromPositions('rush-four', '直接成五', '冲四：唯一成五点'),
  fromPositions('multi-win', '直接成五', '四个成五点'),
  {
    id: 'bench-four-threat',
    category: '直接成五',
    board: boardFromLines([
      '...............',
      '...............',
      '..........WWWW.',
      '.......B.......',
      '......B........',
      '.....B.........',
    ]),
    player: WHITE,
    source: 'bench/engine.bench.ts:四连威胁',
    synthetic: false,
  },

  fromPositions('must-block-single', '必须防守', '对手唯一成五点'),
  fromPositions('must-block-double', '必须防守', '对手活四：堵不住'),

  fromPositions('open-three', 'VCF 有杀', '活三，3 手强制胜'),
  {
    id: 'bench-vcf-win',
    category: 'VCF 有杀',
    board: boardFromLines(['...............', '...............', '...............', '...BBB.........']),
    player: BLACK,
    source: 'bench/engine.bench.ts:活三（3 手胜）',
    synthetic: true,
  },
  {
    id: 'bench-vcf-counters',
    category: 'VCF 无杀',
    board: boardFromLines([
      '...............',
      '...............',
      '...............',
      '...BBB.........',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...WWWW........',
    ]),
    player: BLACK,
    source: 'bench/engine.bench.ts:有活三但被反先',
    synthetic: true,
    note: '看似有活三，白棋已能成五反先——正确结论是「无杀」',
  },
  {
    id: 'bench-vcf-quiet',
    category: 'VCF 无杀',
    board: boardFromLines(['...............', '...............', '...............', '...B.B.........']),
    player: BLACK,
    source: 'bench/engine.bench.ts:散子安静局面',
    synthetic: true,
  },

  fromPositions('endgame-eight-holes', '接近满盘', '只剩 8 个空位'),
  {
    id: 'nearly-full',
    category: '接近满盘',
    board: nearlyFullBoard(),
    player: WHITE,
    source: 'src/test/board-fixtures.ts:nearlyFullBoard',
    synthetic: true,
  },
]

/** 按 id 取局面（剖析脚本命中的第一个错误通常就是这里写错了 id）。 */
export function workloadBoard(id: string): Board {
  const workload = WORKLOADS.find((w) => w.id === id)
  if (workload === undefined) throw new Error(`没有局面 ${id}`)
  return workload.board
}

/** 候选点数量：解释「为什么这个局面贵」的第一个线索。 */
export function candidateCount(workload: Workload): number {
  return candidateMoves(workload.board).length
}

/** 只保留会真正进入搜索的局面（捷径局面拿来对照，不参与耗时汇总）。 */
export function searchWorkloads(): readonly Workload[] {
  return WORKLOADS.filter((w) => w.category !== '直接成五' && w.category !== '必须防守')
}

/** VCF 直接测 `findForcedWin`，与 `searchBoard` 的路径分开。 */
export function vcfWorkloads(): readonly Workload[] {
  return WORKLOADS.filter((w) => w.category === 'VCF 有杀' || w.category === 'VCF 无杀')
}

