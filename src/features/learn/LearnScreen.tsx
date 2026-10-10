import { useState } from 'react'
import { Panel } from '../../components/ui/Panel'
import { AppHeader } from '../shell/AppHeader'
import { cx } from '../../lib/cx'
import { LESSONS } from '../../learn/lessons'
import { useLearnStore } from '../../store/learnStore'
import { LessonView } from './LessonView'

/**
 * 课程页：列表与单课之间切换。
 *
 * 进入课程时读 `progress.lastVisited`——上次停在哪节课就展开哪节课，从第一页
 * 重新讲起。**不读它的话，那个字段就是一个只写不读的死字段。**
 */
export function LearnScreen() {
  const loaded = useLearnStore((state) => state.loaded)
  const progress = useLearnStore((state) => state.progress)
  const completeLesson = useLearnStore((state) => state.completeLesson)
  const visit = useLearnStore((state) => state.visit)

  const [openId, setOpenId] = useState<string | null>(null)

  // 进度载入之后恢复上次那节课。在**渲染期间**调整状态而不是放进 effect：
  // effect 里 setState 会白白多触发一轮渲染，而且 lint 也会拦。
  const [restored, setRestored] = useState(false)
  if (!restored && loaded) {
    setRestored(true)

    const last = progress.lastVisited
    if (last?.kind === 'lesson' && LESSONS.some((lesson) => lesson.id === last.id)) {
      setOpenId(last.id)
    }
  }

  const open = (id: string): void => {
    setOpenId(id)
    visit('lesson', id)
  }

  const lesson = LESSONS.find((entry) => entry.id === openId) ?? null

  if (lesson !== null) {
    const index = LESSONS.indexOf(lesson)
    const next = LESSONS[index + 1]

    return (
      <LessonView
        lesson={lesson}
        solved={progress.completedLessons.includes(lesson.id)}
        onExit={() => {
          setOpenId(null)
          visit(null)
        }}
        onSolved={() => completeLesson(lesson.id)}
        onNext={next === undefined ? undefined : () => open(next.id)}
      />
    )
  }

  const done = LESSONS.filter((entry) => progress.completedLessons.includes(entry.id)).length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppHeader />

      <div className="mx-auto w-full max-w-3xl px-3 py-5 lg:px-6">
        <header className="mb-4 flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-fg">互动教学</h1>
          <span data-testid="learn-progress" className="text-xs text-faint">
            已完成 {done} / {LESSONS.length} 节
          </span>
        </header>

        <p className="mb-4 text-sm leading-relaxed text-muted">
          八节课从规则讲到做杀，每节都有一页页的棋盘图解和一道练习。
          练习的判定看的是棋型而不是固定答案——同一个目标，往往不止一种走法。
        </p>

        <ol className="space-y-2">
          {LESSONS.map((entry, index) => {
            const finished = progress.completedLessons.includes(entry.id)

            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => open(entry.id)}
                  data-testid={`lesson-${entry.id}`}
                  data-done={finished}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition',
                    finished
                      ? 'border-good/40 bg-good-soft'
                      : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                      finished ? 'bg-good text-accent-fg' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {finished ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{entry.title}</span>
                    <span className="block truncate text-xs text-faint">{entry.summary}</span>
                  </span>
                  <span className="ml-auto text-xs text-faint">›</span>
                </button>
              </li>
            )
          })}
        </ol>

        <Panel title="学完之后" className="mt-4" bodyClassName="p-3.5">
          <p className="text-xs leading-relaxed text-muted">
            课程里的每一个概念，在「残局挑战」里都有对应的题目可以练。做题时判定同样
            看棋型，所以想出别的走法一样算对。
          </p>
        </Panel>
      </div>
    </div>
  )
}
