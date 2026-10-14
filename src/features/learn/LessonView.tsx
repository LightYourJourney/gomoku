import { useCallback, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { Lesson } from '../../learn/types'
import { PageShell } from '../shell/PageShell'
import { PracticeBoard } from './PracticeBoard'
import { StepView } from './StepView'

/**
 * 通关之后往哪走。
 *
 * 用一个描述符而不是两个可选回调（`onNext?` + `onEnterPuzzles?`）：
 * 两个都可传时，「哪个优先」就是一条没写下来的隐式规则。
 * 这里它是**一个**值，`LearnScreen` 按「还有没有下一节」决定给哪个。
 */
export type LessonExit =
  | { readonly kind: 'next'; readonly run: () => void }
  | { readonly kind: 'puzzles'; readonly run: () => void }

export interface LessonViewProps {
  readonly lesson: Lesson
  readonly solved: boolean
  readonly onExit: () => void
  readonly onSolved: () => void
  /** 通关后的出口。没有下一节时给 `puzzles`，让最后一课通向残局挑战。 */
  readonly exit?: LessonExit
}

/**
 * 一节课：先按顺序翻讲解，最后一页之后进入练习。
 *
 * 讲解页本身没有状态可言，所以「上次停在哪儿」只记到课，不记到第几页——
 * 记到页只会让刷新后的位置显得随机。**这是刻意的语义**（任务书 §六 也要求保留），
 * 所以这里没有把 `step` 往 store 里搬。
 *
 * 顶栏由 `PageShell` 提供（它也是应用外壳）——进到课程里导航仍然要在，
 * 否则从练习页想去对战页得先退回列表。
 */
export function LessonView({ lesson, solved, onExit, onSolved, exit }: LessonViewProps) {
  const [step, setStep] = useState(0)
  const stepCount = lesson.steps.length
  const lastStep = stepCount - 1
  const onPractice = step >= stepCount

  // PracticeBoard 在 effect 里回调，这里把它稳定住，免得每帧都重新触发。
  const handleSolved = useCallback(() => onSolved(), [onSolved])

  return (
    <PageShell
      variant="flush"
      // 返回 / 翻页工具栏是页面级控件，交给壳渲染在顶栏正下方
      toolbar={
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Button onClick={onExit}>← 课程列表</Button>
          {/*
        课名是这一页的**主标题**，用 `h1`。原先它只是个 `span`，
        于是这节课的页面根本没有一级标题（探针的 `headings` 量得清清楚楚：
        `learn-practice` 整页只有一条 `h2 练习`）。样式一个字没变。
      */}
      <h1 className="truncate text-sm font-medium text-fg">{lesson.title}</h1>
          <span className="ml-auto font-mono text-xs tabular-nums text-faint">
            {onPractice ? '练习' : `${step + 1} / ${stepCount}`}
          </span>

          {onPractice ? (
            /*
              进了练习要能回讲解。回到**最后一页**而不是第一页——
              玩家是从那里过来的，退回首屏等于让他重翻一遍。
              **这个按钮不碰进度**：它只移页码，`completeLesson` 只在 PracticeBoard
              判定通过时由 `onSolved` 触发（有一条用例专门钉这件事）。
            */
            <Button onClick={() => setStep(lastStep)}>回到讲解</Button>
          ) : (
            <>
              {/*
                第一步**禁用**而不是隐藏（任务书 §六 允许「禁用或隐藏」）：
                隐藏会让工具栏左右跳动，而「不能后退」用禁用表达得更准确。
              */}
              <Button disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>
                上一步
              </Button>
              {/*
                最后一步点下去发生的是「进练习」——**按钮就该这么写**。
                写「下一步」时动作发生了却没人说，玩家会以为还有讲解没看完。
              */}
              <Button variant="primary" onClick={() => setStep((value) => value + 1)}>
                {step === lastStep ? '进入练习 →' : '下一步'}
              </Button>
            </>
          )}
        </div>
      }
      footer={
        solved && onPractice ? (
          <p className="shrink-0 px-3 pb-3 text-xs text-faint">
            这一节已经完成，随时可以从课程列表回来复习。
          </p>
        ) : undefined
      }
    >
      {onPractice ? (
        <PracticeBoard
          // 换课时必须重建：`step` 是组件内部状态，复用实例会让新一课直接
          // 停在上一课翻到的页码（从练习页切过去就是直接跳到练习）。
          key={lesson.id}
          practice={lesson.practice}
          onSolved={handleSolved}
          alreadySolved={solved}
          footer={
            exit === undefined ? (
              <Button block onClick={onExit}>
                回到课程列表
              </Button>
            ) : exit.kind === 'next' ? (
              <Button variant="primary" block onClick={exit.run}>
                下一节 →
              </Button>
            ) : (
              <Button variant="primary" block onClick={exit.run}>
                去残局挑战 →
              </Button>
            )
          }
        />
      ) : (
        <StepView step={lesson.steps[step]!} index={step} total={stepCount} />
      )}
    </PageShell>
  )
}
