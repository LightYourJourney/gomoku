import { useEffect, useMemo, useRef, useState } from 'react'
import { Board, type BoardMark } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { FeedbackBanner } from '../../components/panels/FeedbackBanner'
import { Panel } from '../../components/ui/Panel'
import { Button } from '../../components/ui/Button'
import { parseBoardLines } from '../../lib/board-lines'
import { goalHint, HINT_LEVELS, solveMove } from '../../learn/hints'
import type { Practice } from '../../learn/types'
import { applyToBoard, judgeMove, type Verdict } from '../../learn/verify'
import type { Point } from '../../core/types'

export interface PracticeBoardProps {
  readonly practice: Practice
  /** 判定通过时回调一次。 */
  readonly onSolved: () => void
  /** 通过之后额外渲染的内容，例如「下一节」按钮。 */
  readonly footer?: React.ReactNode
}

/**
 * 练习交互：棋盘 + 判定 + 反馈 + 三级提示。课程与残局共用。
 *
 * 三处约定值得留意：
 *
 * 1. **判错后锁盘**，必须点「重试」才能再走。不锁的话玩家会乱点，
 *    反馈条也会一直闪，看不出哪一手被判错了。
 * 2. **提示逐级揭示**：前两级是文案（题目自带的点拨、目标复述），
 *    第三级才由引擎算出具体点位。提前给点位等于剥夺思考的机会。
 * 3. **点位是算出来的**，不是题目里写死的——所以出一道题不必附带答案表，
 *    多解也天然成立。
 */
export function PracticeBoard({ practice, onSolved, footer }: PracticeBoardProps) {
  const base = useMemo(() => parseBoardLines(practice.board.lines), [practice])
  const [attempt, setAttempt] = useState<{ move: Point; verdict: Verdict } | null>(null)
  const [hintLevel, setHintLevel] = useState(0)

  const solution = useMemo(
    () => (hintLevel >= HINT_LEVELS ? solveMove(base, practice.player, practice.goal, Date.now) : null),
    [base, hintLevel, practice],
  )

  const solved = attempt?.verdict.ok === true
  const board = attempt === null ? base : applyToBoard(base, attempt.move, practice.player)

  const marks: BoardMark[] = []
  if (attempt !== null) {
    // 判题标记带明确符号（F-UI-12）：只给 tone 不给 label 时，`Board` 会走
    // `String(index + 1)` 的兜底，棋盘上于是出现一个**写着「1」、含义不明**的圆。
    // 回放编号靠那个兜底，判题反馈不该也靠它。
    marks.push({ point: attempt.move, tone: solved ? 'good' : 'bad', label: solved ? '对' : '错' })
  } else if (solution !== null) {
    marks.push({ point: solution, label: '解' })
  }

  const handlePlay = (point: Point): void => {
    setAttempt({ move: point, verdict: judgeMove(base, practice.player, point, practice.goal, Date.now) })
  }

  const retry = (): void => setAttempt(null)

  const askHint = (): void => {
    setHintLevel((level) => Math.min(level + 1, HINT_LEVELS))
  }

  /**
   * 已经为**哪一道题**回调过 `onSolved`。
   *
   * 这道闸门不能少：`onSolved` 由父组件传入，父组件每次渲染都可能给出新的函数
   * 引用，effect 于是反复执行；就算 store 那边幂等，每次 setState 都会让父组件
   * 再渲染一次，两边合起来就是一个无限循环。
   *
   * 存的是 `practice` 而不是布尔值：换题时它自然对不上，**不需要显式复位**，
   * 也就不会出现在渲染期写 ref 这种违反 React 约定的写法。
   */
  const notifiedFor = useRef<unknown>(null)

  // 判定通过时通知外面。放 effect 而不是渲染期间直接调：渲染中触发父组件
  // setState 会让 React 报警。
  useEffect(() => {
    if (!solved || notifiedFor.current === practice) return
    notifiedFor.current = practice
    onSolved()
  }, [solved, practice, onSolved])

  /**
   * 换题（`practice` 换了）时把这一题的状态清干净。
   *
   * `attempt` / `hintLevel` 都是**上一题的**状态：不复位的话，上一题的判定结果
   * 会继续挂在反馈条上。（`notifiedFor` 不用管——它存的是题目本身，换题后
   * 天然对不上。）
   *
   * **渲染期间调整，不放进 effect**：effect 里 setState 会多跑一轮渲染，
   * 而那一帧看到的还是上一题的结果。React 给「props 变了要调 state」这个场景
   * 的写法就是渲染期调整，本仓另有两处同样写法（`BattleScreen.tsx` 的
   * seenStatus、`LearnScreen.tsx` 的 restored）。
   *
   * 两个调用点目前都靠外层换 `key` 强制重建组件，所以这段在生产路径上不会走到
   * （`LessonView.tsx` 用 `key={lesson.id}`、`PuzzleScreen.tsx` 用
   * `key={puzzle.id}:{round}`）。但那是**调用方的写法**，不该是组件正确性的前提——
   * 组件测试里直接用新 `practice` 重渲染就走到这里，见 `PracticeBoard.test.tsx`。
   */
  const [seenPractice, setSeenPractice] = useState(practice)
  if (practice !== seenPractice) {
    setSeenPractice(practice)
    setAttempt(null)
    setHintLevel(0)
  }

  const hintText =
    hintLevel === 0
      ? null
      : hintLevel === 1
        ? practice.hints[0]
        : hintLevel === 2
          ? (practice.hints[1] ?? goalHint(practice.goal))
          : goalHint(practice.goal)

  return (
    <>
      <BoardStage>
        <Board
          board={board}
          lastMove={attempt?.move ?? null}
          winLine={null}
          nextPlayer={practice.player}
          showCoords={false}
          interactive={attempt === null && !solved}
          marks={marks}
          onPlay={handlePlay}
        />
      </BoardStage>

      <aside className="order-2 space-y-3 px-3 pb-4 lg:order-3 lg:overflow-y-auto lg:border-l lg:border-border lg:px-4 lg:py-4">
        <Panel title="练习">
          <p className="text-sm leading-relaxed text-fg">{practice.prompt}</p>
          <p className="mt-2 flex items-center gap-2 text-xs text-faint">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background:
                  practice.player === 1
                    ? 'var(--c-stone-black-b)'
                    : 'var(--c-stone-white-a)'
              }}
            />
            轮到你走{practice.player === 1 ? '黑棋' : '白棋'}
          </p>
        </Panel>

        {attempt !== null && (
          <FeedbackBanner
            ok={attempt.verdict.ok}
            message={attempt.verdict.ok ? practice.solution : attempt.verdict.reason}
          />
        )}

        <div className="flex items-center gap-2">
          {attempt !== null && !solved && (
            <Button onClick={retry} block>
              重试
            </Button>
          )}
          <Button
            variant="primary"
            block
            disabled={solved || hintLevel >= HINT_LEVELS}
            onClick={askHint}
          >
            {hintLevel === 0 ? '要提示' : `再具体一点（${hintLevel}/${HINT_LEVELS}）`}
          </Button>
        </div>

        {hintText !== null && (
          <Panel title="提示">
            <p data-testid="hint" className="text-xs leading-relaxed text-muted">
              {hintText}
            </p>
            {hintLevel >= HINT_LEVELS && (
              <p className="mt-2 text-xs text-faint">
                棋盘上标出了其中一种解法。走上去试试——判定看的是棋型，别的走法同样算对。
              </p>
            )}
          </Panel>
        )}

        {solved && footer}
      </aside>
    </>
  )
}
