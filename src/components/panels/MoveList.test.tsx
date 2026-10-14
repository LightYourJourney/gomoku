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

  it('没有最后一手时（空盘）谁都不高亮，只给空状态文案', () => {
    render(<MoveList moves={[]} firstPlayer={BLACK} lastMove={null} />)

    expect(screen.getByText('尚未落子')).toBeInTheDocument()
  })

})
