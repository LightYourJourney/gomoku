import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseBoardLines } from '../../lib/board-lines'
import { solveMove } from '../../learn/hints'
import { EMPTY_PROGRESS } from '../../persist/progress'
import { LESSONS } from '../../learn/lessons'
import type { Lesson } from '../../learn/types'
import { PUZZLES } from '../../learn/puzzles'
import { useLearnStore } from '../../store/learnStore'
import { PuzzleScreen } from '../puzzles/PuzzleScreen'
import { LearnScreen } from './LearnScreen'

beforeEach(() => {
  useLearnStore.setState({ progress: EMPTY_PROGRESS, loaded: true, view: 'learn' })
})

const openLesson = (id: string): void => {
  fireEvent.click(screen.getByTestId(`lesson-${id}`))
}

/**
 * 按完讲解的翻页按钮，直到进入练习。
 *
 * **最后一步的按钮是「进入练习 →」**（Phase 04 改的）：原先一律写「下一步」，
 * 可点下去直接跳到练习——动作发生了，按钮却没说实话。所以这里按**标签**点，
 * 顺带把「最后一步换了文案」这件事也测了。
 */
function walkToPractice(lesson: Lesson): void {
  for (let i = 0; i < lesson.steps.length - 1; i++) {
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  }
  fireEvent.click(screen.getByRole('button', { name: '进入练习 →' }))
}

describe.each([
  ['教学页', <LearnScreen key="learn" />],
  ['残局页', <PuzzleScreen key="puzzles" />],
])('%s 的地标', (_name, element) => {
  it('正文包在 main 里——读屏用户靠地标跳转，没有它就只能从头听', () => {
    render(element)

    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})

describe('LearnScreen —— 课程列表', () => {
  it('列出全部 8 节课', () => {
    render(<LearnScreen />)

    for (const lesson of LESSONS) {
      expect(screen.getByTestId(`lesson-${lesson.id}`)).toBeInTheDocument()
    }
  })

  /**
   * F-UI-26：摘要**不套截断样式**。
   *
   * 说明它**不是什么**：jsdom 没有布局，这条断的是类名而不是「真的换行了」。
   * 「390 下摘要完整可读」由 `yarn ui:probe` 的 `overflowing` / `clipped` 与
   * `e2e/mobile.spec.ts` 的溢出判据守（那两处才是量得出来的）。
   * 这里守的是「没人把 `truncate` 加回来」——加回来上面的判据才可能失守。
   */
  it('课程摘要不套 truncate 类', () => {
    render(<LearnScreen />)

    for (const lesson of LESSONS) {
      const summary = screen.getByText(lesson.summary)
      expect(summary.className, `${lesson.id} 的摘要又被截断了`).not.toContain('truncate')
    }
  })

  it('显示完成进度，已完成的打勾', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'] },
      loaded: true,
      view: 'learn',
    })
    render(<LearnScreen />)

    expect(screen.getByTestId('learn-progress')).toHaveTextContent(`1 / ${LESSONS.length}`)
    expect(screen.getByTestId('lesson-rules')).toHaveAttribute('data-done', 'true')
    expect(screen.getByTestId('lesson-two')).toHaveAttribute('data-done', 'false')
  })

  it('点一节课进入它，并从第一页讲解开始', () => {
    render(<LearnScreen />)

    openLesson('three')

    expect(screen.getByText(LESSONS[2]!.steps[0]!.title)).toBeInTheDocument()
    expect(screen.getByText(LESSONS[2]!.steps[0]!.body)).toBeInTheDocument()
  })

  it('翻讲解页直到最后一页之后进入练习', () => {
    render(<LearnScreen />)
    openLesson('rules')

    walkToPractice(LESSONS[0]!)

    expect(screen.getByText(LESSONS[0]!.practice.prompt)).toBeInTheDocument()
  })

  it('做完练习后回到列表，那一节已经打勾', async () => {
    render(<LearnScreen />)
    openLesson('rules')

    walkToPractice(LESSONS[0]!)

    // 这一节的解法是补满横排四子
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    await waitFor(() => expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'true'))

    fireEvent.click(screen.getByRole('button', { name: '← 课程列表' }))

    expect(screen.getByTestId('lesson-rules')).toHaveAttribute('data-done', 'true')
    expect(useLearnStore.getState().progress.completedLessons).toContain('rules')
  })

  it('点「下一节」换课时从头讲起，不会停在上一课的页码', () => {
    // 必须走「下一节」这条路：退回列表再进去会把组件整个卸载，那样即使
    // 不重建实例也看不出问题。真实浏览器里点「下一节」是**不清空实例**的，
    // 内部那个 step 会原样留下来，于是新一课直接跳到练习。
    render(<LearnScreen />)
    openLesson('rules')

    const first = LESSONS[0]!
    walkToPractice(first)
    expect(screen.getByText(first.practice.prompt)).toBeInTheDocument()

    // 「下一节」只在练习做对之后才出现
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    fireEvent.click(screen.getByRole('button', { name: '下一节 →' }))

    expect(screen.getByText(LESSONS[1]!.steps[0]!.title)).toBeInTheDocument()
    expect(screen.queryByText(LESSONS[1]!.practice.prompt)).not.toBeInTheDocument()
  })

  it('存在上次停留的课程时，直接展开那一节', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, lastVisited: { kind: 'lesson', id: 'defense' } },
      loaded: true,
      view: 'learn',
    })

    render(<LearnScreen />)

    const lesson = LESSONS.find((entry) => entry.id === 'defense')!
    expect(screen.getByText(lesson.steps[0]!.title)).toBeInTheDocument()
  })

  it('上次停留的课程 id 已经不存在时，退回列表而不是白屏', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, lastVisited: { kind: 'lesson', id: '已经删掉的课' } },
      loaded: true,
      view: 'learn',
    })

    render(<LearnScreen />)

    expect(screen.getByTestId('lesson-rules')).toBeInTheDocument()
  })
})

describe('详情页的地标', () => {
  it('课程内页也有 main：讲解与练习都得包在里头', () => {
    render(<LearnScreen />)
    openLesson('rules')

    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('残局内页也有 main', () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})

describe('LearnScreen —— 讲解里的棋盘演示', () => {
  it('有手顺的讲解页显示演示控件，没有的不显示', () => {
    render(<LearnScreen />)
    openLesson('rules')

    // 第一页没有 sequence
    expect(screen.queryByTestId('sequence-progress')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByTestId('sequence-progress')).toHaveTextContent('0 / 9')
  })

  it('点「下一步」逐手摆子，走到末手后禁用', () => {
    render(<LearnScreen />)
    openLesson('rules')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    const stones = (): number => screen.queryAllByTestId(/^stone-/).length
    expect(stones()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '下一手' }))
    expect(stones()).toBe(1)

    for (let i = 0; i < 8; i++) {
      const next = screen.getByRole('button', { name: '下一手' })
      if ((next as HTMLButtonElement).disabled) break
      fireEvent.click(next)
    }

    expect(screen.getByTestId('sequence-progress')).toHaveTextContent('9 / 9')
    expect(screen.getByRole('button', { name: '下一手' })).toBeDisabled()
  })

  it('点「上一手」可以退回去', () => {
    render(<LearnScreen />)
    openLesson('rules')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '下一手' }))
    fireEvent.click(screen.getByRole('button', { name: '下一手' }))
    fireEvent.click(screen.getByRole('button', { name: '下一手' }))

    fireEvent.click(screen.getByRole('button', { name: '上一手' }))

    expect(screen.getByTestId('sequence-progress')).toHaveTextContent('2 / 9')
  })
})

describe('PuzzleScreen —— 残局列表', () => {
  it('按分类列出全部题目', () => {
    render(<PuzzleScreen />)

    for (const puzzle of PUZZLES) {
      expect(screen.getByTestId(`puzzle-${puzzle.id}`)).toBeInTheDocument()
    }
  })

  it('显示通过进度', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: ['win-h', 'win-diag'] },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)

    expect(screen.getByTestId('puzzle-progress')).toHaveTextContent(`2 / ${PUZZLES.length}`)
    expect(screen.getByTestId('puzzle-win-h')).toHaveAttribute('data-done', 'true')
  })

  it('做对一题之后标记为已通过，进度加一', async () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    fireEvent.click(screen.getByTestId('intersection-4-7'))

    await waitFor(() =>
      expect(useLearnStore.getState().progress.solvedPuzzles).toContain('win-h'),
    )
    expect(await screen.findByText('第一次做对这道题。')).toBeInTheDocument()
  })

  it('「再做一次」把棋盘清回初始局面', async () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    await screen.findByText('第一次做对这道题。')

    fireEvent.click(screen.getByRole('button', { name: '再做一次' }))

    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId(/^board-mark-/)).toHaveLength(0)
  })

  it('存在上次停留的题目时，直接展开那一题', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, lastVisited: { kind: 'puzzle', id: 'vcf-basic' } },
      loaded: true,
      view: 'puzzles',
    })

    render(<PuzzleScreen />)

    const puzzle = PUZZLES.find((entry) => entry.id === 'vcf-basic')!
    expect(screen.getByText(puzzle.prompt)).toBeInTheDocument()
  })

  it('上次停留的题目 id 已经不存在时，退回列表而不是白屏', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, lastVisited: { kind: 'puzzle', id: '已经删掉的题' } },
      loaded: true,
      view: 'puzzles',
    })

    render(<PuzzleScreen />)

    expect(screen.getByTestId('puzzle-win-h')).toBeInTheDocument()
  })

  it('「← 残局列表」回到列表', () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    fireEvent.click(screen.getByRole('button', { name: '← 残局列表' }))

    expect(screen.getByTestId('puzzle-progress')).toBeInTheDocument()
  })
})

/**
 * Phase 04：分阶段、进度、推荐、步骤导航（任务书 §二 / §三 / §六 / §九）。
 *
 * **进度全部来自 store 的真实状态**，所以这些用例的摆法都是「先 setState 造进度，
 * 再看界面说了什么」——没有一处是断言写死的文案。
 */
describe('LearnScreen —— 进度与推荐（Phase 04）', () => {
  it('进度还没读出来时给占位，而且一个数字都不出现', () => {
    useLearnStore.setState({ loaded: false })
    render(<LearnScreen />)

    // 任务书 §三：未加载时要显示加载/占位……
    expect(screen.getByText('正在读取学习进度…')).toBeInTheDocument()
    // ……而且**不能**错误地显示「已完成 0 节」——那是在说一件还不知道的事
    expect(screen.queryByTestId('learn-progress')).not.toBeInTheDocument()
  })

  it('读出来之后，计数与进度条都来自真实状态', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, completedLessons: ['rules', 'two', 'three'] },
    })
    render(<LearnScreen />)

    expect(screen.getByTestId('learn-progress')).toHaveTextContent('已完成 3 / 8 节')

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '8')
  })

  it('推荐的是第一节没做完的课，顶上那颗按钮直接进它', () => {
    useLearnStore.setState({ progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'] } })
    render(<LearnScreen />)

    fireEvent.click(screen.getByRole('button', { name: '继续学习：活二与眠二' }))

    expect(screen.getByText(LESSONS[1]!.steps[0]!.title)).toBeInTheDocument()
  })

  /*
   * **这里刻意没有「推荐上次停留那一节」的用例。**
   *
   * 那条路在这层根本走不到：`lastVisited` 是一节有效的课时，`LearnScreen`
   * 装载就会把那一节展开（见下面「存在上次停留的课程时，直接展开那一节」），
   * 列表压根不渲染。`resolveNext` 因此不看 `lastVisited`——
   * 这条判断连同一个「它是什么都不影响推荐」的用例，记在 `courseOutline.test.ts`。
   * 写一条测不到的用例，等于给一个不存在的状态写断言。
   */

  it('八节全做完时给完成状态，不再推荐任何一节', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, completedLessons: LESSONS.map((lesson) => lesson.id) },
    })
    render(<LearnScreen />)

    /*
      节数按 `LESSONS.length` 断言，**不写死「八」**：
      这句文案本身也是从 `total` 推出来的，用例跟着内容走才对得上——
      否则加了第 9 节课，用例会替那句已经撒谎的文案背书。
    */
    expect(screen.getByText(new RegExp(`${LESSONS.length} 节课都完成了`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /继续学习/ })).not.toBeInTheDocument()
  })

  it('已完成的卡片对读屏也说得清状态——走描述，不走名称', () => {
    useLearnStore.setState({ progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'] } })
    render(<LearnScreen />)

    /*
      初版断的是 `getByText('已完成：')`——那只证明「DOM 里有这句话」，
      对读屏**拿不拿得到**一个字都没说。实际当时它放在按钮外面，
      浏览模式读得到、**Tab 到按钮时读不到**（子代理审计发现，见 PHASE_04 §20.3 第 5 条）。

      改成量无障碍树算出来的两个字段，与读屏同源。三条缺一不可：
      描述里有状态；名称里**没有**它（否则语音控制说「点击基本规则」
      在完成后就点不中了）；没做完的那节不该有这条描述。
    */
    const rules = screen.getByTestId('lesson-rules')
    expect(rules).toHaveAccessibleDescription('已完成')
    expect(rules).toHaveAccessibleName(/基本规则/)
    expect(rules).not.toHaveAccessibleName(/已完成/)

    expect(screen.getByTestId('lesson-two')).not.toHaveAccessibleDescription(/已完成/)
  })

  it('课程详情页有一级标题，而且就是课名（讲解页的小标题是二级）', () => {
    render(<LearnScreen />)
    openLesson('rules')

    expect(screen.getByRole('heading', { level: 1, name: LESSONS[0]!.title })).toBeInTheDocument()
    // 第 1 页的讲解小标题是 h2——它原先是个 h1，层级会倒着走
    expect(
      screen.getByRole('heading', { level: 2, name: LESSONS[0]!.steps[0]!.title }),
    ).toBeInTheDocument()
  })

  it('按四段渲染，每段一个二级标题——读屏用户才知道哪些是一类', () => {
    render(<LearnScreen />)

    for (const title of ['基础入门', '棋型进阶', '攻防策略', '综合实战']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
  })

  it('推荐那张卡只做弱标记，不在卡里再放一颗通向同一节课的按钮', () => {
    useLearnStore.setState({ progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'] } })
    const { container } = render(<LearnScreen />)

    expect(screen.getByTestId('lesson-two')).toHaveAttribute('data-recommended', 'true')
    expect(screen.getByTestId('lesson-three')).toHaveAttribute('data-recommended', 'false')

    /*
      「一屏一个 accent 动作」：整页只有顶部那颗「继续学习」是实心 accent 的**按钮**。
      进度条的填充也是 `bg-accent`，但它是数据可视化不是可点的东西——
      `DESIGN_SYSTEM.md` §6.1 把这条写成了明确的例外，所以这里限定到 `button`。
    */
    expect(container.querySelectorAll('button.bg-accent')).toHaveLength(1)
    // 残局入口是次要入口，走 `ghost`（`text-muted`），不抢那颗主操作
    expect(screen.getByTestId('learn-to-puzzles').className).not.toContain('text-accent')
  })

  it('列表末尾有去残局挑战的入口，点了就切到残局视图', () => {
    render(<LearnScreen />)

    fireEvent.click(screen.getByTestId('learn-to-puzzles'))

    expect(useLearnStore.getState().view).toBe('puzzles')
  })

  it('简介里的节数由内容推出来，不是写死的「八」', () => {
    render(<LearnScreen />)

    expect(screen.getByText(new RegExp(`^${LESSONS.length} 节课`))).toBeInTheDocument()
  })
})

describe('LearnScreen —— 课程详情的步骤导航（Phase 04）', () => {
  it('第一步的「上一步」是禁用状态，而不是消失', () => {
    render(<LearnScreen />)
    openLesson('rules')

    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
  })

  it('来回翻讲解页，计数跟着走，也不会退到第 0 页之前', () => {
    render(<LearnScreen />)
    openLesson('rules')

    const up = screen.getByRole('button', { name: '上一步' })
    fireEvent.click(up) // 第 0 步上再点一次：被 clamp 住，不该出现 0 / N
    expect(screen.getByText(`1 / ${LESSONS[0]!.steps.length}`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText(`2 / ${LESSONS[0]!.steps.length}`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText(`1 / ${LESSONS[0]!.steps.length}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
  })

  it('练习态能回到讲解——回到的是最后一页，而且**不算完成**', () => {
    render(<LearnScreen />)
    openLesson('rules')
    walkToPractice(LESSONS[0]!)

    fireEvent.click(screen.getByRole('button', { name: '回到讲解' }))

    const steps = LESSONS[0]!.steps
    expect(screen.getByText(steps[steps.length - 1]!.title)).toBeInTheDocument()
    // 任务书 §六 点名：「返回讲解不能意外把课程标为完成」
    expect(useLearnStore.getState().progress.completedLessons).not.toContain('rules')
    expect(useLearnStore.getState().isLessonDone('rules')).toBe(false)
  })

  /**
   * 两轴评审抓出来的**真行为缺陷**：出口原先只由 `PracticeBoard` **内部**的
   * 「本次判对了没」把关，于是重进一节已通过的课时，出口一直藏着，
   * 直到玩家把这道题再做一遍。这与任务书 §九「允许再次进入已经完成的课程」冲突。
   *
   * 修法：把进度里那个「此前已通过」也接进闸门（`PracticeBoard` 的 `alreadySolved`）。
   */
  it('重进已通过的课时，一次都没做也看得见出口', () => {
    useLearnStore.setState({ progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'] } })

    render(<LearnScreen />)
    openLesson('rules')
    walkToPractice(LESSONS[0]!)

    // 本次会话还没落任何子，但这一节此前已通过 → 出口应当立刻在
    expect(screen.getByRole('button', { name: '下一节 →' })).toBeInTheDocument()
  })

  it('已通过的课可以重新学一遍，完成计数不会因此涨', async () => {
    useLearnStore.setState({ progress: { ...EMPTY_PROGRESS, completedLessons: ['rules'] } })
    render(<LearnScreen />)

    openLesson('rules')
    walkToPractice(LESSONS[0]!)
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    await waitFor(() => expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'true'))

    fireEvent.click(screen.getByRole('button', { name: '← 课程列表' }))
    expect(screen.getByTestId('learn-progress')).toHaveTextContent('已完成 1 / 8 节')
  })
})

/**
 * 任务书 §九：**最后一课完成后引导到残局挑战**。
 *
 * 通关那一手由**引擎算出来**，不写死坐标——内容层的题只声明目标、不声明答案
 * （`learn/types.ts` 的 `PuzzleGoal`），测试也不该反过来把答案抄一遍：
 * 抄的那份一旦与题面不符，用例会跟着错，而不是发现问题。
 */
describe('LearnScreen —— 最后一节的出口（Phase 04）', () => {
  it('八节课里最后一节通关后，出口通向残局挑战', async () => {
    const last = LESSONS[LESSONS.length - 1]!
    useLearnStore.setState({
      progress: {
        ...EMPTY_PROGRESS,
        completedLessons: LESSONS.slice(0, -1).map((lesson) => lesson.id),
      },
    })

    render(<LearnScreen />)
    openLesson(last.id)
    walkToPractice(last)

    const solution = solveMove(
      parseBoardLines(last.practice.board.lines),
      last.practice.player,
      last.practice.goal,
      Date.now,
    )
    expect(solution).not.toBeNull()

    fireEvent.click(screen.getByTestId(`intersection-${solution!.x}-${solution!.y}`))
    await waitFor(() => expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'true'))

    fireEvent.click(screen.getByRole('button', { name: /去残局挑战/ }))

    expect(useLearnStore.getState().view).toBe('puzzles')
  })

  it('不是最后一节时，出口仍然是「下一节 →」', async () => {
    render(<LearnScreen />)
    openLesson('rules')
    walkToPractice(LESSONS[0]!)
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    await waitFor(() => expect(screen.getByTestId('feedback')).toHaveAttribute('data-ok', 'true'))

    expect(screen.getByRole('button', { name: '下一节 →' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /去残局挑战/ })).not.toBeInTheDocument()
  })
})

/**
 * **残局页那个「此前已通过」的调用点**。
 *
 * 两轴评审修 `PracticeBoard` 的出口闸门时，课程页与残局页都传了 `alreadySolved`——
 * 但当时的用例只覆盖了课程页那个。独立验收时被指出：**把 `PuzzleScreen` 那行删掉，
 * 一条用例都不会红**。这条就是来补这个洞的（删掉那行它必须红）。
 */
describe('PuzzleScreen —— 重进已通过的题（Phase 04 验收补）', () => {
  it('重进一道已通过的题，一次都没做也看得见出口', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: [PUZZLES[0]!.id] },
      loaded: true,
      view: 'puzzles',
    })

    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId(`puzzle-${PUZZLES[0]!.id}`))

    expect(screen.getByText('这一题已经通过。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再做一次' })).toBeInTheDocument()
  })
})

/**
 * Phase 05：残局列表页的信息架构。
 *
 * 这一组守的是「首页说的每一句话都来自真实数据」——分类计数、推荐、卡片类别
 * 全部由 `PUZZLES` × `solvedPuzzles` 派生，没有一份额外的状态。
 * 播种进度而不是真做题：这里验的是**读出来的东西对不对**，
 * 「真做完一道题之后进度会不会变」由上面那组和 e2e 负责。
 */
describe('PuzzleScreen —— 首页信息（Phase 05）', () => {
  const seedSolved = (ids: readonly string[]): void => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: [...ids] },
      loaded: true,
      view: 'puzzles',
    })
  }

  it('每个分类标题旁边有该类自己的 X / Y，而且 X / Y 不在标题文字里', () => {
    seedSolved(['win-h', 'win-diag'])
    render(<PuzzleScreen />)

    const heading = screen.getByRole('heading', { name: '一步获胜' })
    /*
      **整段文字只有分类名**。这条不是排版洁癖：覆盖率基线按 `level:text`
      钉着 `h2:一步获胜` 这些键，把计数塞进标题里就会让旧键消失、
      棘轮按「丢了标题」报红（D2 的硬约束）。
    */
    expect(heading.textContent).toBe('一步获胜')

    expect(screen.getByTestId('category-winInOne-progress')).toHaveTextContent('2 / 3')
    expect(screen.getByTestId('category-blockFive-progress')).toHaveTextContent('0 / 3')
  })

  it('卡片上写着它属于哪一类', () => {
    render(<PuzzleScreen />)

    const card = screen.getByTestId('puzzle-win-h')
    expect(card).toHaveTextContent('横向补满')
    expect(card).toHaveTextContent('一步获胜')
  })

  it('「继续挑战」指向第一道没做的，跳着做也一样', () => {
    seedSolved(['win-h', 'block-h'])
    render(<PuzzleScreen />)

    expect(screen.getByRole('button', { name: /继续挑战/ })).toHaveTextContent('斜向补满')
  })

  /**
   * 跳着练的人不该被弹回最前面。
   *
   * 场景：用户直接去做「连续冲四」（题库里它在第六类），做完回列表——
   * 若「继续挑战」还指「题库里最早那道没做的」，他会被送回「一步获胜」，
   * 那不是「继续」，是「回到」。偏好只活在本次会话里（刷新即丢），
   * 理由见 `puzzleOutline.ts` 的注释。
   */
  it('打开过某一类之后回列表，「继续挑战」跟着那一类走', () => {
    render(<PuzzleScreen />)

    // 一开始指向题库里最早那道没做的
    expect(screen.getByRole('button', { name: /继续挑战/ })).toHaveTextContent('横向补满')

    fireEvent.click(screen.getByTestId('puzzle-vcf-basic'))
    fireEvent.click(screen.getByRole('button', { name: '← 残局列表' }))

    /*
      给的是「连续冲四」里第一道**还没做的**——也就是刚刚打开、还没做的这一道
      （初稿在这里断的是「冲四连击」，那是把「打开过」当成了「做过」：
      偏好只决定**从哪一类里挑**，挑的仍然是那一类里第一道没做的）。
    */
    expect(screen.getByRole('button', { name: /继续挑战/ })).toHaveTextContent('冲四开场')
  })

  it('全做完时不给「继续挑战」，只给完成文案', () => {
    seedSolved(PUZZLES.map((puzzle) => puzzle.id))
    render(<PuzzleScreen />)

    expect(screen.queryByRole('button', { name: /继续挑战/ })).not.toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${PUZZLES.length} 道题都通过了`))).toBeInTheDocument()
  })
})

/**
 * Phase 05：通关之后的出口。
 *
 * 此前只有「再来一次」一个——做对一题之后想接着练，得自己退回列表再点下一道。
 * 这一组守的是「出口指的是**题库里真实存在的**下一道」，以及切过去之后
 * 上一题的临时状态不许跟过来。
 */
describe('PuzzleScreen —— 出口（Phase 05）', () => {
  it('做对之后能直接进下一题，而且上一题的反馈没有跟过来', async () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    await screen.findByText('第一次做对这道题。')

    fireEvent.click(screen.getByRole('button', { name: '下一题 →' }))

    // 换到了题库里的下一道，而且是它自己那个干净的局面
    expect(screen.getByRole('heading', { name: '斜向补满' })).toBeInTheDocument()
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId(/^board-mark-/)).toHaveLength(0)
    expect(screen.queryByTestId('hint')).not.toBeInTheDocument()
  })

  it('最后一题给结束状态与实战出口，不给「下一题」', () => {
    const last = PUZZLES[PUZZLES.length - 1]!
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: PUZZLES.map((puzzle) => puzzle.id) },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId(`puzzle-${last.id}`))

    expect(screen.getByText(new RegExp(`${PUZZLES.length} 道题都通过了`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去实战试试 →' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一题 →' })).not.toBeInTheDocument()
  })

  /**
   * **列表不锁顺序**（任务书 §四 / §七 明确要求），所以「走到最后一道」与
   * 「前面的都做完了」是两件事。混成一件的后果是一句假话——
   * Phase 04 在教学页上抓到过同形的缺陷（出口只由「是不是最后一节」决定），
   * 这一条守的是残局这边不要再犯。
   */
  it('只是走到最后一道、前面还有没做的——不能说「都通过了」', () => {
    const last = PUZZLES[PUZZLES.length - 1]!
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: [last.id] },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId(`puzzle-${last.id}`))

    expect(screen.queryByText(/道题都通过了/)).not.toBeInTheDocument()
    expect(screen.getByText(/这是题库里的最后一道/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回到残局列表' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '去实战试试 →' })).not.toBeInTheDocument()
  })

  it('首次做对与重进已通过的题，说的不是同一句话', async () => {
    const first = render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    expect(await screen.findByText('第一次做对这道题。')).toBeInTheDocument()
    first.unmount()

    // 重进一道已经通过的
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: ['win-h'] },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    expect(screen.getByText('这一题已经通过。')).toBeInTheDocument()
    expect(screen.queryByText('第一次做对这道题。')).not.toBeInTheDocument()
  })

  /**
   * **末题同时是某一类的最后一题**，分类完成提示也要在。
   *
   * 提示此前只挂在「还有下一题」那一支上，而题库最后一道（`forced-counter`）
   * 恰好是「强制获胜路线」的第二道——线性做完十五道的人**永远看不到**
   * 最后一类通过。走 allDone 分支时它必须还在（唯一的例外是「全部通过」：
   * 那句话已经蕴含了它）。
   */
  it('末题同时是某一类的最后一题时，分类完成提示也在', () => {
    const last = PUZZLES[PUZZLES.length - 1]!
    useLearnStore.setState({
      // 该类两道全通，但全局只有 2 / 15 —— 走的是 allDone 而**不是** allSolved
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: ['forced-deep', last.id] },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId(`puzzle-${last.id}`))

    expect(screen.getByText('「强制获胜路线」这一类全部通过了。')).toBeInTheDocument()
    expect(screen.getByText(/这是题库里的最后一道/)).toBeInTheDocument()
    expect(screen.queryByText(/道题都通过了/)).not.toBeInTheDocument()
  })

  it('「再做一次」之后又做对，不再说「第一次做对」', async () => {
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))
    fireEvent.click(screen.getByTestId('intersection-4-7'))
    expect(await screen.findByText('第一次做对这道题。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '再做一次' }))
    fireEvent.click(screen.getByTestId('intersection-4-7'))

    await waitFor(() => expect(screen.getByText('这一题已经通过。')).toBeInTheDocument())
    expect(screen.queryByText('第一次做对这道题。')).not.toBeInTheDocument()
  })

  /**
   * **重进一道已通过的题**时，同屏只能有一颗实心 accent 按钮。
   *
   * 那时页脚里的出口（「下一题 →」）已经在了，而棋盘那边的「要提示」默认也是
   * `primary`——两颗可用的主按钮并排，违反 `DESIGN_SYSTEM.md` §6.1，
   * 读的人也不知道该按哪颗。（判对之后由 `disabled` 接管，不必再区分。）
   */
  it('重进已通过的题：「要提示」不再是实心主色', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: ['win-h'] },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    // 这一屏唯一的主操作是出口那一颗
    expect(screen.getByRole('button', { name: '下一题 →' }).className).toContain('bg-accent')
    expect(screen.getByTestId('ask-hint').className).not.toContain('bg-accent')
  })

  it('这一类全通了就给分类完成提示', () => {
    // 「一步获胜」三道全通，重进其中一道
    useLearnStore.setState({
      progress: {
        ...EMPTY_PROGRESS,
        solvedPuzzles: ['win-h', 'win-diag', 'win-vertical'],
      },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    expect(screen.getByText('「一步获胜」这一类全部通过了。')).toBeInTheDocument()
  })

  it('这一类还没做完就不说那句', () => {
    useLearnStore.setState({
      progress: { ...EMPTY_PROGRESS, solvedPuzzles: ['win-h'] },
      loaded: true,
      view: 'puzzles',
    })
    render(<PuzzleScreen />)
    fireEvent.click(screen.getByTestId('puzzle-win-h'))

    expect(screen.queryByText(/这一类全部通过了/)).not.toBeInTheDocument()
  })
})
