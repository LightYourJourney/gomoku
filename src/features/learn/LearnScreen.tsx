import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import { cx } from '../../lib/cx'
import { LESSONS } from '../../learn/lessons'
import { useLearnStore } from '../../store/learnStore'
import { PageShell } from '../shell/PageShell'
import { ProgressBlock } from './ProgressBlock'
import { LessonView } from './LessonView'
import { STAGES, resolveNext } from './courseOutline'

/**
 * 进度块的文案。放在模块级而不是渲染里现写：一个渲染期新建的对象字面量
 * 每次都是新引用，将来谁给它加一层 `memo` 就会被无声地打穿。
 */
const PROGRESS_TEXTS = {
  loading: '正在读取学习进度…',
  doneLabel: '已完成',
  unit: '节',
  action: '继续学习',
  allDone: `${LESSONS.length} 节课都完成了。去「残局挑战」把那些棋型再练一遍吧。`,
} as const

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

      <div className="space-y-6">
        <ProgressBlock
          loaded={loaded}
          done={done}
          total={LESSONS.length}
          testId="learn-progress"
          texts={PROGRESS_TEXTS}
          next={
            nextLesson === null
              ? null
              : {
                  title: nextLesson.title,
                  run: () => {
                    open(nextLesson.id)
                  },
                }
          }
        />

        {STAGES.map((stage) => (
          <section key={stage.id} aria-labelledby={`stage-${stage.id}`}>
            {/*
              分组标题是 h2：不分组时读屏用户听到的是「八个并列按钮」，
              分不清哪些是一类的。层级也要对——h1 是「互动教学」。
            */}
            <h2 id={`stage-${stage.id}`} className="px-1 text-sm font-semibold text-muted">
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
                    {/*
                      完成状态对读屏也得可读：✓ 徽标是 `aria-hidden`，
                      而 `data-done` 是给测试用的、读屏不认。

                      **走描述、不走名称**（`aria-describedby` 指过来，而不是把这句话
                      塞进按钮里）：
                      - 名称答「这是什么」，描述答「它现在什么样」，本来就是两个字段；
                      - 塞进按钮会**改写可访问名**，而状态是会变的——语音控制的用户
                        说「点击基本规则」，在那节课做完之后就点不中了
                        （WCAG 2.5.3 的反面：名字不该随状态漂移）。

                      初版只把这句话放在按钮**外面**，理由写的是「别动覆盖率的按钮键」——
                      那是拿门禁的便利换功能：浏览模式读得到，**Tab 到按钮时读不到**。
                      改由 `aria-describedby` 引用之后两条通路都有了，
                      按钮的可访问名仍然一个字没变。
                    */}
                    {finished && (
                      <span id={`lesson-done-${entry.id}`} className="sr-only">
                        已完成
                      </span>
                    )}
                    <button
                      type="button"
                      aria-describedby={finished ? `lesson-done-${entry.id}` : undefined}
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
                        finished ? 'border-good/40' : 'border-border hover:border-border-strong',
                        /*
                          推荐那一张用**底色上一档**加权重：`surface-2` 按 §2.1 正是
                          「面板内的次级块、悬停底色」那一档，读起来就是「当前这条」。
                          **不用 accent**（留给顶部那颗「继续学习」），
                          **也不用 `border-strong`**——按 §2.2 它只属于 hover 描边与开关关闭态，
                          常态用它是越档（初稿就是这么写的，两轴评审指出后改掉）。
                          这里也不加 `aria-*`：它没有新信息，
                          「接下来学哪节」已经由顶部那颗按钮说清楚了。
                        */
                        recommended ? 'bg-surface-2' : 'bg-surface',
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
          {/*
            用 `ghost` 档，不手搓：`DESIGN_SYSTEM.md` §6.1 说这一档就是为收编
            散落的裸 `<button>` 而加的，而手搓的那版**漏了 hover 反馈**；
            颜色也走 `text-muted` 而不是 `text-accent`——§2.2 的 accent 只给
            「主操作、当前选中项」，这一条是次要入口，不抢那颗「继续学习」。
          */}
          <Button
            variant="ghost"
            size="sm"
            data-testid="learn-to-puzzles"
            className="mt-2"
            onClick={() => {
              setView('puzzles')
            }}
          >
            去残局挑战 →
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
