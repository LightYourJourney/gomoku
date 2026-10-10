import { useCallback, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import type { Lesson } from '../../learn/types'
import { PracticeBoard } from './PracticeBoard'
import { StepView } from './StepView'

export interface LessonViewProps {
  /**
   * 顶部外壳，通常是 `AppHeader`。
   *
   * 顶栏是应用外壳，进到课程里也要在——否则从练习页想去对战页，得先退回列表，
   * 导航等于在详情页里消失了。
   */
  readonly header?: ReactNode
  readonly lesson: Lesson
  readonly solved: boolean
  readonly onExit: () => void
  readonly onSolved: () => void
  /** 还有下一节时渲染「下一节」按钮。 */
  readonly onNext?: () => void
}

/**
 * 一节课：先按顺序翻讲解，最后一页之后进入练习。
 *
 * 讲解页本身没有状态可言，所以「上次停在哪儿」只记到课，不记到第几页——
 * 记到页只会让刷新后的位置显得随机。
 */
export function LessonView({
  header,
  lesson,
  solved,
  onExit,
  onSolved,
  onNext,
}: LessonViewProps) {
  const [step, setStep] = useState(0)
  const practiceIndex = lesson.steps.length
  const onPractice = step >= practiceIndex

  // PracticeBoard 在 effect 里回调，这里把它稳定住，免得每帧都重新触发。
  const handleSolved = useCallback(() => onSolved(), [onSolved])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button onClick={onExit}>← 课程列表</Button>
        <span className="truncate text-sm font-medium text-fg">{lesson.title}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-faint">
          {onPractice ? '练习' : `${step + 1} / ${practiceIndex}`}
        </span>
        {!onPractice && (
          <Button variant="primary" onClick={() => setStep((value) => value + 1)}>
            下一步
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_344px] lg:grid-rows-[auto_minmax(0,1fr)]">
        {onPractice ? (
          <PracticeBoard
            // 换课时必须重建：`step` 是组件内部状态，复用实例会让新一课直接
            // 停在上一课翻到的页码（从练习页切过去就是直接跳到练习）。
            key={lesson.id}
            practice={lesson.practice}
            onSolved={handleSolved}
            footer={
              onNext === undefined ? (
                <Button block onClick={onExit}>
                  回到课程列表
                </Button>
              ) : (
                <Button variant="primary" block onClick={onNext}>
                  下一节 →
                </Button>
              )
            }
          />
        ) : (
          <StepView step={lesson.steps[step]!} index={step} total={practiceIndex} />
        )}
      </div>

      {solved && onPractice && (
        <p className="shrink-0 px-3 pb-3 text-xs text-faint">
          这一节已经完成，随时可以从课程列表回来复习。
        </p>
      )}
    </div>
  )
}
