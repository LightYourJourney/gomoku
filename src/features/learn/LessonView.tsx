import { useCallback, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { Lesson } from '../../learn/types'
import { PracticeBoard } from './PracticeBoard'
import { StepView } from './StepView'

export interface LessonViewProps {
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
 * 讲解页本身没有状态可言，所以 `lastVisited` 只记到课，不记到第几页——
 * 记到页只会让刷新后的位置显得随机。
 */
export function LessonView({ lesson, solved, onExit, onSolved, onNext }: LessonViewProps) {
  const [step, setStep] = useState(0)
  const practiceIndex = lesson.steps.length
  const onPractice = step >= practiceIndex

  // PracticeBoard 在 effect 里回调，这里把它稳定住，免得每帧都重新触发。
  const handleSolved = useCallback(() => onSolved(), [onSolved])

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_344px]">
      <div className="order-3 flex items-center gap-2 border-t border-border px-3 py-2 lg:order-1 lg:col-span-2 lg:border-t-0 lg:border-b">
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

      {onPractice ? (
        <PracticeBoard
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

      {solved && onPractice && (
        <p className="order-4 px-3 pb-4 text-xs text-faint lg:col-span-2">
          这一节已经完成，随时可以从课程列表回来复习。
        </p>
      )}
    </div>
  )
}
