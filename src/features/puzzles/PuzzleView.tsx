import { useCallback, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CATEGORY_LABELS } from '../../learn/puzzles'
import { allDoneText } from './puzzleOutline'
import type { Puzzle } from '../../learn/types'
import { useLearnStore } from '../../store/learnStore'
import { PracticeBoard } from '../learn/PracticeBoard'
import { PageShell } from '../shell/PageShell'

/**
 * 通关之后往哪走。
 *
 * 用一个描述符而不是并列两个可选回调（`onNext?` + `onAllDone?`）：
 * 两个都可传时「哪个优先」就是一条没写下来的隐式规则。这里它是**一个**值，
 * `PuzzleScreen` 按「还有没有下一题」决定给哪个——与 `LessonExit` 同一套做法。
 */
export type PuzzleExit =
  | {
      readonly kind: 'next'
      readonly run: () => void
      /** 通过之后，这一类是不是全通了。是的话多给一句完成提示。 */
      readonly categoryDone: boolean
    }
  | {
      readonly kind: 'allDone'
      readonly run: () => void
      /** 这一类是不是全通了。**末题也可能是某一类的最后一题**，所以这里也要有。 */
      readonly categoryDone: boolean
      /**
       * 是不是**真的**全通过了，而不只是「走到了题库的最后一道」。
       *
       * 这两件事必须分开：列表**不锁顺序**（任务书 §四 / §七 明确要求），
       * 玩家可以直接进去做最后一道题。那时说「十五道题都通过了」是假话
       * ——Phase 04 在教学页上抓到过一模一样的缺陷（出口只由「是不是最后一节」
       * 决定，于是做对最后一节就显示「全部课程讲完了」），这次在写 e2e 时
       * 又踩了一次，所以它现在是一个**显式的字段**，不是能顺手推出来的东西。
       */
      readonly allSolved: boolean
      readonly total: number
    }

export interface PuzzleViewProps {
  readonly puzzle: Puzzle
  readonly exit: PuzzleExit
  readonly onExit: () => void
}

/**
 * 一道残局题：棋盘 + 判定 + 反馈 + 提示，全部复用课程那套 `PracticeBoard`。
 *
 * 这一页与课程练习页的差别只有三处，都是「残局是一道题而不是一节课」带来的：
 * 没有讲解页要翻、工具栏右侧显示的是**类别**而不是页码、通关之后通向
 * **下一题**（末题通向实战）而不是下一节。
 */
export function PuzzleView({ puzzle, exit, onExit }: PuzzleViewProps) {
  const solved = useLearnStore((state) => state.isPuzzleDone(puzzle.id))
  const solvePuzzle = useLearnStore((state) => state.solvePuzzle)
  const [round, setRound] = useState(0)

  /*
    **进入这道题时**它是否已经通过。

    与 `solved` 不是一回事：那是 store 的当前状态，这次做对之后同样为真——
    用它分不出「头一回做对」与「重进一道做过的」。所以挂载时取一次快照。
    组件必须按题重建（`PuzzleScreen` 给了 `key={puzzle.id}`），
    否则换题时这份快照会跟着串到下一道题上。
  */
  const [alreadySolvedOnEntry] = useState(() => useLearnStore.getState().isPuzzleDone(puzzle.id))

  // 引用要稳定：练习组件把它放进 effect 的依赖里。
  const handleSolved = useCallback(() => solvePuzzle(puzzle.id), [puzzle.id, solvePuzzle])

  return (
    <PageShell
      variant="flush"
      // 返回 / 标题工具栏是页面级控件，交给壳渲染在顶栏正下方
      toolbar={
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Button onClick={onExit}>← 残局列表</Button>
          {/*
            题名是这一页的**主标题**，用 `h1`（§3.2 的「页面标题」档 20/28/600）。
            它原先只是个 `span`，于是整页没有一级标题——`learn-practice`
            在 Phase 04 修过一模一样的毛病，这里是同一个。
          */}
          <h1 className="truncate text-xl font-semibold text-fg">{puzzle.title}</h1>
          <span className="ml-auto shrink-0 text-xs text-faint">
            {CATEGORY_LABELS[puzzle.category]}
          </span>
        </div>
      }
      footer={
        solved ? (
          <p className="shrink-0 px-3 pb-3 text-xs text-faint">
            做对的题会记在进度里，刷新也不会丢。
          </p>
        ) : undefined
      }
    >
      <PracticeBoard
        // 换 key 强制重建，用来实现「再做一次」以及换题时的状态清理
        key={`${puzzle.id}:${round}`}
        practice={puzzle}
        onSolved={handleSolved}
        alreadySolved={solved}
        footer={
          <div className="space-y-2">
            <p className="text-xs text-good">
              {/*
                `round > 0` 也要算进去：「再做一次」只重建棋盘（`key` 里带 round），
                这个快照不会变——第二次做对若还说「第一次做对」，那是**假话**。
              */}
              {alreadySolvedOnEntry || round > 0 ? '这一题已经通过。' : '第一次做对这道题。'}
            </p>

            {/*
              完成提示只给**跨越了一次状态边界**的两条：
              做完某一类、做完全部。这两句都携带新信息。
              「首次完成」刻意不做——卡片上的 ✓ 与上一句已经说了同一件事，
              再加一句「恭喜首次通过」只是噪音（任务书 §九 要的是「轻量」）。
            */}
            {exit.kind === 'allDone' ? (
              exit.allSolved ? (
                <p className="text-xs text-good">{allDoneText(exit.total)}</p>
              ) : (
                <p className="text-xs text-muted">
                  这是题库里的最后一道。前面还有没做的，随时回列表接着练。
                </p>
              )
            ) : null}

            {/*
              分类完成提示**不挂在「还有下一题」那一支上**。
              末题恰好也是某一类的最后一题（`forced-counter` 就是），
              那时走的是 allDone 分支——线性做完十五道的人会**永远看不到**
              「强制获胜路线」这一类通过了。唯一的例外是「全部通过」：
              那句话已经蕴含了它，不必再说一遍。
            */}
            {exit.categoryDone && !(exit.kind === 'allDone' && exit.allSolved) && (
              <p className="text-xs text-good">
                「{CATEGORY_LABELS[puzzle.category]}」这一类全部通过了。
              </p>
            )}

            {exit.kind === 'next' ? (
              <Button variant="primary" block onClick={exit.run}>
                下一题 →
              </Button>
            ) : (
              /* 真的全做完了才把人送去实战；只是做到最后一道的话，下一步是回列表接着练 */
              <Button variant="primary" block onClick={exit.run}>
                {exit.allSolved ? '去实战试试 →' : '回到残局列表'}
              </Button>
            )}

            <Button block onClick={() => setRound((value) => value + 1)}>
              再做一次
            </Button>
          </div>
        }
      />
    </PageShell>
  )
}
