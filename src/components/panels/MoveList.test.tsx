import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BLACK, type Point } from '../../core/types'
import { MoveList } from './MoveList'

const FIRST: Point = { x: 7, y: 7 }
const SECOND: Point = { x: 8, y: 8 }

/**
 * 最后一手的高亮用 **accent**，不是 danger（Phase 03 补的一处漏网）。
 *
 * `--c-danger` 是「认输 / 错误 / 判错反馈」的颜色；「最后一手」只是**列表里的当前项**，
 * 归 accent（`DESIGN_SYSTEM.md` §2.2：「主操作、当前选中项」）。
 * 棋盘上那圈红环在同阶段被换掉了，这一处当时漏了——两轴代码评审也没抓到，
 * 因为它不在 diff 的行上，是自查「danger 还用在哪」时翻出来的。
 *
 * **这里断的是类名，不是颜色**——jsdom 不解析样式表，`getComputedStyle` 读不出 `var()`
 * 的值，在这一层断颜色只会得到空串。「屏幕上真的是 accent」由真浏览器那条守着：
 * `e2e/battle.spec.ts` 的「棋谱高亮的最后一手是 accent 色，不是 danger 色」，
 * 它读的是算出来的 `rgb()`，改样式表就会红。
 * 这一层管的是**哪一格**被选中——那是 jsdom 能准确回答的问题。
 */
describe('MoveList —— 最后一手的高亮', () => {
  it('用 accent 而不是 danger（danger 是认输 / 错误 / 判错的颜色）', () => {
    render(<MoveList moves={[FIRST, SECOND]} firstPlayer={BLACK} lastMove={SECOND} />)

    const cell = screen.getByTestId(`move-${SECOND.x}-${SECOND.y}`)
    expect(cell.className).toContain('bg-accent-soft')
    expect(cell.className).toContain('text-accent')
    expect(cell.className).not.toContain('danger')
  })

  it('非最后一手的格子不带高亮底色', () => {
    render(<MoveList moves={[FIRST, SECOND]} firstPlayer={BLACK} lastMove={SECOND} />)

    const cell = screen.getByTestId(`move-${FIRST.x}-${FIRST.y}`)
    expect(cell.className).not.toContain('bg-accent-soft')
    expect(cell.className).not.toContain('danger')
  })

  /*
   * 这一条和下面那条**必须分开**。原先它们是一条，标题写着「谁都不高亮」，
   * 但传的是 `moves: []`——那会走空状态的短路返回，一个格子都不渲染，
   * 「谁都不高亮」于是无从谈起（一个格子都没有，当然没有高亮）。
   * 把 `lastMove: null` 和 `moves: []` 拆开，两条才各自测得到东西。
   */
  it('有落子但没有最后一手时，谁都不高亮', () => {
    render(<MoveList moves={[FIRST, SECOND]} firstPlayer={BLACK} lastMove={null} />)

    expect(screen.getByTestId(`move-${FIRST.x}-${FIRST.y}`).className).not.toContain('bg-accent-soft')
    expect(screen.getByTestId(`move-${SECOND.x}-${SECOND.y}`).className).not.toContain('bg-accent-soft')
  })

  it('一手都没有时只给空状态文案，不渲染任何格子', () => {
    render(<MoveList moves={[]} firstPlayer={BLACK} lastMove={null} />)

    expect(screen.getByText('尚未落子')).toBeInTheDocument()
    expect(screen.queryByTestId(`move-${FIRST.x}-${FIRST.y}`)).not.toBeInTheDocument()
  })
})
