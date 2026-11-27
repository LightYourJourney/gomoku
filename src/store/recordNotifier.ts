import { resignerOf, type GameState } from '../core/game'
import type { GameMode, Player, Point } from '../core/types'
import type { Difficulty } from '../ai/types'
import type { RecordSaveState } from '../lib/record-save'

/**
 * 一局结束时交给外部的信息。形状即棋谱库的入库输入（不含 `winner`——
 * 它由存储层用 `replay` 推导，不信任调用方）。
 */
export interface GameEndInput {
  readonly moves: readonly Point[]
  readonly firstPlayer: Player
  readonly mode: GameMode
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly resignedBy: Player | null
  /** 若这是探索分支，来源棋谱 seq；普通对局为 null。 */
  readonly branchSourceSeq: number | null
  /**
   * 这一条要替换掉的棋谱 seq，`null` 表示新的一条。
   *
   * 终局悔棋是既有行为（回到进行中、可以接着下）。同一局因此可能终局两次，
   * 第二次带着上一次存下的 seq——存储层据此替换，而不是留下两条同一局。
   */
  readonly replacesSeq: number | null
}

/** 入库结果：号拿到了，但可能只进了本次会话的内存兜底。 */
export interface GameEndSaved {
  readonly seq: number
  /** true = 真正写进了 IndexedDB；false = 只在内存里，刷新就没了。 */
  readonly persisted: boolean
}

/**
 * 终局回调：返回 promise 时兑现为入库的 seq（拿不到 seq 时为 `undefined`），
 * 或「号 + 是否落库」。**只在本次会话时才存下的那一局也要把号交出来**——
 * 否则「终局 → 悔棋 → 再终局」拿不到要替换的旧条，列表里会留下两条同一局。
 */
export type GameEndCallback = (input: GameEndInput) => void | Promise<number | GameEndSaved | void>

/** 入库链写回 store 的两个字段。 */
interface RecordSaveFields {
  readonly recordSaveState?: RecordSaveState
  readonly recordedSeq?: number | null
}

/**
 * 判定「刚结束一局」并拼入库输入要读的那几项 store 状态。
 * `branch` 按结构写，不引 `gameStore` 的 `BranchOrigin`——引了就成环。
 */
interface GameEndContext {
  readonly game: GameState
  readonly mode: GameMode
  readonly humanColor: Player
  readonly difficulty: Difficulty
  readonly branch: { readonly sourceSeq: number } | null
}

/**
 * 只在「进行中 → 终局」这一跃迁上回调。落子路径有三条（玩家、AI、认输），
 * 都汇到这里判定，避免各处各写一遍「是不是刚结束」。
 *
 * **入库是串行的，而且要带着配对链接。** 原来的写法从 `before.recordedSeq`
 * 取「这一局上次存成的 seq」，而那个字段要等 promise 兑现才写——于是
 * 「终局 → 悔棋 → 再终局」如果发生在上一次写入还没回来的时候，第二次拿到的
 * `replacesSeq` 是 `null`，存储层的内容匹配又对不上（手顺不同），
 * 同一局在棋谱库里留下两条。
 *
 * 现在改成：把写入排成一条链，`replacesSeq` 在**轮到它执行时**才读
 * （这一局的号那时已经是上一次的结果），号按局隔离，并且配一道只增不减的闸门，
 * 保证迟到的结果不会把新的状态覆盖回去。这与 `analysisStore` 的 `runId` 同一手法。
 */
export function createRecordNotifier(
  onGameEnd: GameEndCallback | undefined,
  set: (partial: RecordSaveFields) => void,
) {
  /**
   * **这一局**上一次成功入库的 seq（`null` 表示这一局还没存过）。
   *
   * 按局隔离成一个持有者对象，而不是一个共用变量：`reset()` 换一个新的持有者，
   * 旧局排在链上的写入仍握着旧局那一个。共用变量时，旧局的第二次写入
   * （悔棋重下后再终局）在 `reset()` 之后才轮到执行，读到的是被清空的 null，
   * 于是不替换第一次那条、新增一条——同一局在库里留两条。
   */
  type SeqHolder = { seq: number | null }
  let current: SeqHolder = { seq: null }
  /** 还没跑完的入库次数。0 表示队列空闲。 */
  let pending = 0
  /** 入库链的尾巴。 */
  let tail: Promise<void> = Promise.resolve()
  /**
   * 现在是第几局。`reset()` 时自增——这就是上面说的那道闸门。
   *
   * 少了它，**在飞的那次写入并不知情**：「终局 → 立刻重开」时它兑现后照样写回
   * 界面状态，新局于是被标成「已存入」、`recordedSeq` 拿到上一局的 seq；
   * 新局下完再把它当 `replacesSeq` 交出去，
   * 而存储层拿到它就会**按号删掉那一条**（`gameRecords.ts` 的 `putReplacing`）——
   * 上一局的棋谱直接没了，比原本要修的「多一条」更重。
   */
  let generation = 0

  async function runSave(build: () => GameEndInput, gen: number, holder: SeqHolder): Promise<void> {
    try {
      // `build()` 在**轮到它执行时**才求值——那时持有者里已经是上一次的结果了。
      // 排队时就求值等于回到原来那个 bug（第二次终局拿到 null）。
      const result = onGameEnd?.(build())

      // **同步**返回 undefined（连 promise 都没返回）＝这个回调什么也没做。
      // `f9d8061` 之前的那版在这里直接 return、`recordSaveState` 保持 idle；
      // 这里把上面那句 `saving` 退回去，等效。注意与「promise 兑现为 undefined」
      // 区分开——后者是「存过了、只是没拿到 seq」，仍然算 saved（有测试钉着）。
      if (result === undefined) {
        if (gen !== generation) return
        set({ recordSaveState: 'idle' })
        return
      }

      const saved = await result
      let seq: number | null = null
      let sessionOnly = false
      if (typeof saved === 'number') {
        seq = saved
      } else if (typeof saved === 'object' && saved !== null) {
        seq = saved.seq
        sessionOnly = !saved.persisted
      }

      // 号记在**这一局自己的**持有者上：即使这一局已经翻篇，它排在链上的后续写入
      // 仍要拿这个号去替换，否则会多出一条。新局用的是另一个持有者，不受影响。
      // 只存进内存的那一局同样记——兜底号在存储层里改道到库号（`drainedSeqs`）。
      if (seq !== null) holder.seq = seq

      // 这一局已经翻篇了（开了新局 / 恢复了存档）：**界面状态不许写**——它现在属于新局。
      if (gen !== generation) return

      set({ recordSaveState: sessionOnly ? 'session' : 'saved', recordedSeq: holder.seq })
    } catch {
      if (gen !== generation) return
      // 失败要如实说，而且**不动持有者里的号**——这一局还是没进库
      set({ recordSaveState: 'failed' })
    }
  }

  return {
    notifyGameEnd(before: GameEndContext, after: GameState): void {
      if (before.game.status !== 'playing' || after.status === 'playing') return
      // 没装配回调时什么状态都不该动（`recordSaveState` 保持 idle）
      if (onGameEnd === undefined) return

      const base = {
        moves: after.moves,
        firstPlayer: after.firstPlayer,
        mode: before.mode,
        humanColor: before.humanColor,
        difficulty: before.difficulty,
        resignedBy: resignerOf(after),
        branchSourceSeq: before.branch?.sourceSeq ?? null,
      }

      // 存储是异步的，界面需要知道最终成没成
      set({ recordSaveState: 'saving' })

      pending++
      // 局号在**发起时**记下，不在执行时读：排队期间可能已经开了新局，
      // 那时读到的会是新局号，这次写入就认不出自己已经过期了。
      const gen = generation
      // 持有者同理：发起时记下的是**这一局的**，`build()` 执行时再从它读号。
      const holder = current
      const step = (): Promise<void> =>
        runSave(() => ({ ...base, replacesSeq: holder.seq }), gen, holder).then(() => {
          pending--
        })

      if (pending === 1) {
        // 队列本来空着：**立刻跑**。`runSave` 是 async 函数，函数体会同步执行到
        // 第一个 await，所以 `onGameEnd` 仍然是同步被调用的——这是既有行为，
        // 有测试钉着，不该因为要排队就顺手改掉。
        tail = step()
        return
      }

      tail = tail.then(step)
    },

    /**
     * 开新局 / 恢复存档时调用：上一局的入库链接与这一局无关。
     *
     * 自增局号，让在飞的那次写入兑现时认得出「我已经不是当前这一局了」。
     * `pending` 与 `tail` **不动**：那几次写入本身还是要落库的（玩家确实把那一局
     * 下完了），只是不许再写回状态。
     */
    reset(): void {
      generation++
      current = { seq: null }
    },
  }
}
