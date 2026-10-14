import { useState } from 'react'
import { PageHeader } from '../../components/ui/PageHeader'
import { cx } from '../../lib/cx'
import { CATEGORY_LABELS, CATEGORY_ORDER, PUZZLES } from '../../learn/puzzles'
import type { PuzzleCategory } from '../../learn/types'
import { useLearnStore } from '../../store/learnStore'
import { ProgressBlock } from '../learn/ProgressBlock'
import { PageShell } from '../shell/PageShell'
import { PuzzleView } from './PuzzleView'
import {
  allDoneText,
  categoryProgress,
  nextPuzzleAfter,
  resolveNextPuzzle,
} from './puzzleOutline'

/**
 * 进度块的文案。模块级常量，理由同 `LearnScreen` 的同名常量。
 *
 * **`doneLabel` 与 `unit` 拼出来的那句必须原样是 `已通过 X / 15 题`**：
 * 探针三个残局状态的 boot 绑着这条逐字文案（`ui.probe.mjs:617`），
 * 改了它 boot 会超时——而超时比报错更难查。
 */
const PROGRESS_TEXTS = {
  loading: '正在读取挑战进度…',
  doneLabel: '已通过',
  unit: '题',
  action: '继续挑战',
  allDone: allDoneText(PUZZLES.length),
} as const

/** 残局挑战：按战术分类列题，进去之后用与课程同一套练习交互。 */
export function PuzzleScreen() {
  const loaded = useLearnStore((state) => state.loaded)
  const progress = useLearnStore((state) => state.progress)
  const isPuzzleDone = useLearnStore((state) => state.isPuzzleDone)
  const visit = useLearnStore((state) => state.visit)
  const setView = useLearnStore((state) => state.setView)

  const [openId, setOpenId] = useState<string | null>(null)
  /*
    「本次会话里打开过哪一类」。

    **只能记在这里，不能读 `lastVisited`**：点「← 残局列表」会把它清成 null，
    而列表页能显示的前提正是它不是一道有效的题——那条路到不了。
    代价是刷新之后偏好丢失，回退成「第一道没做的」。
  */
  const [lastCategory, setLastCategory] = useState<PuzzleCategory | null>(null)

  // 进度载入之后恢复上次那道题。**不读它的话，visit('puzzle', …) 写的那个
  // 位置就是一个只写不读的死字段**——刷新残局会退回列表。
  const [restored, setRestored] = useState(false)
  if (!restored && loaded) {
    setRestored(true)

    const last = progress.lastVisited
    if (last?.kind === 'puzzle' && PUZZLES.some((entry) => entry.id === last.id)) {
      setOpenId(last.id)
    }
  }

  const puzzle = PUZZLES.find((entry) => entry.id === openId) ?? null

  const open = (id: string): void => {
    const entry = PUZZLES.find((puzzle) => puzzle.id === id)
    if (entry !== undefined) setLastCategory(entry.category)
    setOpenId(id)
    visit('puzzle', id)
  }

  const backToList = (): void => {
    setOpenId(null)
    visit(null)
  }

  if (puzzle !== null) {
    const next = nextPuzzleAfter(PUZZLES, puzzle.id)
    const mine = categoryProgress(PUZZLES, progress.solvedPuzzles).find(
      (entry) => entry.category === puzzle.category,
    )
    // 题库**不锁顺序**：做到最后一道 ≠ 前面的都做过了。这两个状态得分开，
    // 否则文案会说一句「十五道题都通过了」的假话（Phase 04 的同形缺陷）。
    const allSolved = PUZZLES.every((entry) => isPuzzleDone(entry.id))

    return (
      <PuzzleView
        // 换题必须重建：`alreadySolvedOnEntry` 是挂载时取的快照，复用实例会串题
        key={puzzle.id}
        puzzle={puzzle}
        onExit={backToList}
        exit={
          next === null
            ? {
                kind: 'allDone',
                allSolved,
                total: PUZZLES.length,
                // 真的全做完了，这条链就到头了：教学 → 残局 → 实战。
                // 只是走到最后一道的话，出口是**回列表**接前面没做的题。
                run: () => {
                  backToList()
                  if (allSolved) setView('battle')
                },
              }
            : {
                kind: 'next',
                // 「这一类做完了」要在**做过之后**判：`solvePuzzle` 是同步写 store 的，
                // 所以这次渲染读到的已完成列表里已经含当前这道题，
                // 不需要手工把它加进去（手工加就是第二份真相）。
                // `mine` 为 undefined 只在题库里没有这一分类时出现，那时不该说「全通过」。
                categoryDone: mine !== undefined && mine.done === mine.puzzles.length,
                run: () => {
                  open(next.id)
                },
              }
        }
      />
    )
  }

  // 按题库里分类出现的顺序列，一处都不重排——分类表本身已经在 `puzzles.ts` 里
  // 定过顺序了，这里再造一条就是第二个真相。
  const groups = categoryProgress(PUZZLES, progress.solvedPuzzles)
  const done = PUZZLES.filter((entry) => isPuzzleDone(entry.id)).length
  const nextUp = resolveNextPuzzle(PUZZLES, progress.solvedPuzzles, lastCategory)

  return (
    <PageShell>
      <PageHeader
        title="残局挑战"
        description={`${PUZZLES.length} 道题按战术分成 ${CATEGORY_ORDER.length} 类。分类的先后是教学上的由浅入深，不是难度评级——每题只给局面和目标，解法由引擎现场算出来，所以走出别的取胜着法一样算对。`}
      />

      <div className="space-y-6">
        <ProgressBlock
          loaded={loaded}
          done={done}
          total={PUZZLES.length}
          testId="puzzle-progress"
          texts={PROGRESS_TEXTS}
          next={
            nextUp === null
              ? null
              : {
                  title: nextUp.title,
                  run: () => {
                    open(nextUp.id)
                  },
                }
          }
        />

        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`category-${group.category}`}>
            <div className="flex items-baseline justify-between gap-3 px-1">
              {/*
                分类标题是 h2：不分组时读屏用户听到的是「十五个并列按钮」。
                层级也要对——h1 是「残局挑战」。
              */}
              <h2 id={`category-${group.category}`} className="text-sm font-semibold text-muted">
                {CATEGORY_LABELS[group.category]}
              </h2>
              {/*
                `X / Y` 必须在 h2 的**外面**：塞进标题文字里，覆盖率基线里
                `h2:一步获胜` 这些键就会变成 `h2:一步获胜 3 / 3`，旧键消失、
                棘轮按「丢了标题」报红（`quality/coverage.baseline.json` 里
                这一组实测有 6 条这样的键）。
              */}
              <span
                data-testid={`category-${group.category}-progress`}
                className="font-mono text-xs tabular-nums text-faint"
              >
                {group.done} / {group.puzzles.length}
              </span>
            </div>

            <ul className="mt-2 space-y-2">
              {group.puzzles.map((entry, index) => {
                const solved = isPuzzleDone(entry.id)
                const recommended = nextUp?.id === entry.id

                return (
                  <li key={entry.id}>
                    {/*
                      完成状态对读屏也得可读，而且要走**描述**、不走名称——
                      理由与课程卡片逐字相同（`LearnScreen.tsx` 的同一处注释：
                      名称答「这是什么」、描述答「它现在什么样」，
                      而名字随状态漂移会让语音控制点不中）。
                    */}
                    {solved && (
                      <span id={`puzzle-done-${entry.id}`} className="sr-only">
                        已完成
                      </span>
                    )}
                    <button
                      type="button"
                      aria-describedby={solved ? `puzzle-done-${entry.id}` : undefined}
                      onClick={() => open(entry.id)}
                      data-testid={`puzzle-${entry.id}`}
                      data-done={solved}
                      data-recommended={recommended}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition active:brightness-95',
                        solved ? 'border-good/40' : 'border-border hover:border-border-strong',
                        // 推荐那一张只用**底色上一档**加权重，不铺 accent：
                        // 顶部那颗「继续挑战」才是本页唯一的主操作（§6.1）
                        recommended ? 'bg-surface-2' : 'bg-surface',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                          solved ? 'bg-good text-accent-fg' : 'bg-surface-2 text-muted',
                        )}
                      >
                        {solved ? '✓' : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-fg">{entry.title}</span>
                        {/*
                          类别。分组标题上已经有了，这里再来一遍不是冗余：
                          列表滚起来之后分组标题会滚出视野，卡片自己答得了
                          「这题是哪一类」——任务书 §三 也是这么要求的。
                          做成 12px 的次要文字，不加徽标、不加图标。
                        */}
                        <span className="block text-xs text-muted">
                          {CATEGORY_LABELS[entry.category]}
                        </span>
                      </span>
                      <span aria-hidden="true" className="ml-auto text-xs text-muted">
                        ›
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  )
}
