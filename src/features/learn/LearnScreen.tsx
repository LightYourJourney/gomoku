import { useState } from 'react'
import { PageHeader } from '../../components/ui/PageHeader'
import { cx } from '../../lib/cx'
import { LESSONS } from '../../learn/lessons'
import { useLearnStore } from '../../store/learnStore'
import { PageShell } from '../shell/PageShell'
import { LessonProgress } from './LessonProgress'
import { LessonView } from './LessonView'
import { STAGES, resolveNext } from './courseOutline'

/**
 * 课程页：分阶段的列表与单课之间切换。
 *
 * 进入课程时读 `progress.lastVisited`——上次停在哪节课就展开哪节课，从第一页
 * 重新讲起。**不读它的话，那个字段就是一个只写不读的死字段。**
 *
 * 列表按 `courseOutline` 的**展示层分组**分四段（任务书 §二）。分组不动内容层：
 * 课程顺序、标题、摘要全部照 `LESSONS` 原样。
 */
export function LearnScreen() {
  const loaded = useLearnStore((state) => state.loaded)
  const progress = useLearnStore((state) => state.progress)
  const completeLesson = useLearnStore((state) => state.completeLesson)
  const isLessonDone = useLearnStore((state) => state.isLessonDone)
  const visit = useLearnStore((state) => state.visit)
  const setView = useLearnStore((state) => state.setView)

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
        // 换课时必须重建：`step` 是组件内部状态，复用实例会让新一课直接
        // 停在上一课翻到的页码（从练习页切过去就是直接跳到练习）。
        key={lesson.id}
        lesson={lesson}
        solved={isLessonDone(lesson.id)}
        onExit={() => {
          setOpenId(null)
          visit(null)
        }}
        onSolved={() => completeLesson(lesson.id)}
        /*
          通关后的出口：有下一节就去下一节；**最后一节通向残局挑战**（任务书 §九）。
          用描述符表达，而不是并列两个可选回调——见 `LessonExit` 的注释。
        */
        exit={
          next === undefined
            ? {
                kind: 'puzzles',
                run: () => {
                  setOpenId(null)
                  visit(null)
                  setView('puzzles')
                },
              }
            : { kind: 'next', run: () => open(next.id) }
        }
      />
    )
  }

  const done = LESSONS.filter((entry) => isLessonDone(entry.id)).length
  const nextUp = resolveNext(LESSONS, progress)
  const nextLesson =
    nextUp.kind === 'lesson' ? (LESSONS.find((entry) => entry.id === nextUp.id) ?? null) : null

  return (
    <PageShell>
      <PageHeader
        title="互动教学"
        /* 节数由内容推出来，不写死——加了第 9 节课时这句话不该撒谎 */
        description={`${LESSONS.length} 节课从规则讲到做杀，每节都有一页页的棋盘图解和一道练习。练习的判定看的是棋型而不是固定答案——同一个目标，往往不止一种走法。`}
      />

      <div className="space-y-5">
        <LessonProgress
          loaded={loaded}
          done={done}
          total={LESSONS.length}
          next={nextLesson}
          onContinue={
            nextLesson === null
              ? undefined
              : () => {
                  open(nextLesson.id)
                }
          }
        />

        {STAGES.map((stage) => (
          <section key={stage.id} aria-labelledby={`stage-${stage.id}`}>
            {/*
              分组标题是 h2：不分组时读屏用户听到的是「八个并列按钮」，
              分不清哪些是一类的。层级也要对——h1 是「互动教学」。
            */}
            <h2 id={`stage-${stage.id}`} className="px-1 text-sm font-medium text-muted">
              {stage.title}
            </h2>

            <ol className="mt-2 space-y-2">
              {stage.lessonIds.map((id) => {
                const entry = LESSONS.find((candidate) => candidate.id === id)
                if (entry === undefined) return null

                const index = LESSONS.indexOf(entry)
                const finished = isLessonDone(entry.id)
                const recommended = nextLesson?.id === entry.id

                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => open(entry.id)}
                      data-testid={`lesson-${entry.id}`}
                      data-done={finished}
                      data-recommended={recommended}
                      className={cx(
                        /*
                          点击反馈：`active:` 那档原先没有（只有 hover）——
                          触屏上根本没有 hover，按下时屏幕上什么都不会变。
                        */
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition active:brightness-95',
                        /*
                          已完成不再整片铺 `good-soft`（任务书 §四）：勾与字的颜色
                          足够说明状态，铺色反而让八张卡里五张都在喊。
                          底回到 `surface`——`surface-2` 按 §2.1 不用于大面积背景。
                        */
                        finished ? 'border-good/40 bg-surface' : 'border-border bg-surface hover:border-border-strong',
                        /*
                          推荐那一张只加**边框**权重，不加字、不用 accent：
                          accent 留给顶部那颗「继续学习」按钮（一屏一个主操作）。
                          这里也不加 `aria-*`——它没有任何新信息，
                          「接下来学哪节」已经由顶部那颗按钮说清楚了。
                        */
                        recommended && 'border-border-strong ring-1 ring-border-strong',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                          finished ? 'bg-good text-accent-fg' : 'bg-surface-2 text-muted',
                        )}
                      >
                        {finished ? '✓' : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-fg">{entry.title}</span>
                        {/*
                          不再 `truncate`（F-UI-26）：390 下摘要被截成一行半，
                          而它正是玩家挑课的唯一依据。换行比截断好——
                          卡片高度由内容决定，列表本来就在滚。
                        */}
                        <span className="block text-xs text-muted">{entry.summary}</span>
                      </span>
                      {/* 装饰性的指向符：不 `aria-hidden` 的话读屏会念出那个标点 */}
                      <span aria-hidden="true" className="ml-auto text-xs text-muted">
                        ›
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}

        {/*
          任务书 §二⑥：通往残局的入口。
          原先这里是**一段纯文字**，读起来像说明而不像能点——现在它是真按钮。
          走 `setView('puzzles')`，与顶栏导航同一条路，不新开一层。
        */}
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted">
            课程里的每一个概念，在「残局挑战」里都有对应的题目可以练。做题时判定同样
            看棋型，所以想出别的走法一样算对。
          </p>
          <button
            type="button"
            onClick={() => {
              setView('puzzles')
            }}
            data-testid="learn-to-puzzles"
            className="mt-2 inline-flex min-h-6 items-center gap-1 text-xs font-medium text-accent underline underline-offset-2 transition active:brightness-95"
          >
            去残局挑战 →
          </button>
        </div>
      </div>
    </PageShell>
  )
}
