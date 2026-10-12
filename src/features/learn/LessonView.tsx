import { useCallback, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { Lesson } from '../../learn/types'
import { PageShell } from '../shell/PageShell'
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
 * 讲解页本身没有状态可言，所以「上次停在哪儿」只记到课，不记到第几页——
 * 记到页只会让刷新后的位置显得随机。
 *
 * 顶栏由 `PageShell` 提供（它也是应用外壳）——进到课程里导航仍然要在，
 * 否则从练习页想去对战页得先退回列表。
 */
export function LessonView({ lesson, solved, onExit, onSolved, onNext }: LessonViewProps) {
  const [step, setStep] = useState(0)
  const practiceIndex = lesson.steps.length
  const onPractice = step >= practiceIndex

  // PracticeBoard 在 effect 里回调，这里把它稳定住，免得每帧都重新触发。
  const handleSolved = useCallback(() => onSolved(), [onSolved])

  return (
    <PageShell
      variant="flush"
      // 返回 / 翻页工具栏是页面级控件，交给壳渲染在顶栏正下方
      toolbar={
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
    </PageShell>
  )
}
