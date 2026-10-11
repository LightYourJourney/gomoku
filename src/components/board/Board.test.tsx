import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../core/board'
import { BLACK, WHITE } from '../../core/types'
import { boardFromLines } from '../../test/board-fixtures'
import { Board, type BoardProps } from './Board'

function setup(overrides: Partial<BoardProps> = {}) {
  const onPlay = vi.fn()
  const props: BoardProps = {
    board: createBoard(),
    lastMove: null,
    winLine: null,
    nextPlayer: BLACK,
    showCoords: false,
    interactive: true,
    onPlay,
    ...overrides,
  }

  return { onPlay, ...render(<Board {...props} />) }
}

describe('Board —— 渲染', () => {
  it('渲染 225 个交叉点', () => {
    setup()

    expect(screen.getAllByTestId(/^intersection-/)).toHaveLength(225)
  })

  it('棋盘上有几颗子就渲染几颗棋子', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])
    setup({ board })

    const stones = screen.getAllByTestId(/^stone-/)
    expect(stones).toHaveLength(3)
    expect(screen.getByTestId('stone-5-7')).toHaveAttribute('data-player', '1')
    expect(screen.getByTestId('stone-6-7')).toHaveAttribute('data-player', '2')
    expect(screen.getByTestId('stone-7-7')).toHaveAttribute('data-player', '1')
  })

  it('空盘不渲染任何棋子', () => {
    setup()

    expect(screen.queryAllByTestId(/^stone-/)).toHaveLength(0)
  })
})

describe('Board —— 交互', () => {
  it('点击空交叉点回调对应坐标', () => {
    const { onPlay } = setup()

    fireEvent.click(screen.getByTestId('intersection-3-9'))

    expect(onPlay).toHaveBeenCalledWith({ x: 3, y: 9 })
  })

  it('点击已有棋子的位置不回调', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])
    const { onPlay } = setup({ board })

    fireEvent.click(screen.getByTestId('intersection-6-7'))

    expect(onPlay).not.toHaveBeenCalled()
  })

  it('interactive 为 false 时点击不回调', () => {
    const { onPlay } = setup({ interactive: false })

    fireEvent.click(screen.getByTestId('intersection-3-9'))

    expect(onPlay).not.toHaveBeenCalled()
  })

  it('interactive 为 false 时不显示悬停预览', () => {
    setup({ interactive: false })

    fireEvent.mouseEnter(screen.getByTestId('intersection-3-9'))

    expect(screen.queryByTestId('hover-stone')).not.toBeInTheDocument()
  })

  it('悬停空位时显示当前手番的落子预览', () => {
    setup({ nextPlayer: WHITE })

    fireEvent.mouseEnter(screen.getByTestId('intersection-3-9'))

    expect(screen.getByTestId('hover-stone')).toHaveAttribute('data-player', '2')
  })

  it('悬停已有棋子的位置不显示预览', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BWB.......',
    ])
    setup({ board })

    fireEvent.mouseEnter(screen.getByTestId('intersection-6-7'))

    expect(screen.queryByTestId('hover-stone')).not.toBeInTheDocument()
  })
})

describe('Board —— 状态标记', () => {
  it('最后一手带 data-last 标记，且只有一颗', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.....BW........',
    ])
    setup({ board, lastMove: { x: 6, y: 7 } })

    const marked = screen.getAllByTestId(/^stone-/).filter((el) => el.hasAttribute('data-last'))
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveAttribute('data-testid', 'stone-6-7')
  })

  it('胜利连线上的每颗棋子都带 data-win 标记', () => {
    const board = boardFromLines([
      '...............',
      '...............',
      '...BBBBB.......',
    ])
    const winLine = [3, 4, 5, 6, 7].map((x) => ({ x, y: 2 }))
    setup({ board, lastMove: { x: 7, y: 2 }, winLine })

    const marked = screen.getAllByTestId(/^stone-/).filter((el) => el.hasAttribute('data-win'))
    expect(marked).toHaveLength(5)
  })

  it('没有连线时不渲染胜利高亮', () => {
    setup()

    expect(screen.queryByTestId('win-line')).not.toBeInTheDocument()
  })
})

describe('Board —— 标记', () => {
  const MARKS = [
    { point: { x: 7, y: 7 } },
    { point: { x: 6, y: 6 } },
    { point: { x: 8, y: 8 } },
  ]

  it('传入 marks 时按顺序渲染编号标记', () => {
    setup({ marks: MARKS })

    const markers = screen.getAllByTestId(/^board-mark-/)
    expect(markers).toHaveLength(3)
    expect(markers.map((el) => el.getAttribute('data-testid'))).toEqual([
      'board-mark-7-7',
      'board-mark-6-6',
      'board-mark-8-8',
    ])
    // 没给 label 时按数组下标显示序号，顺序就是推荐顺序
    expect(markers.map((el) => el.textContent)).toEqual(['1', '2', '3'])
  })

  it('自己带 label 的标记原样显示，不显示序号', () => {
    setup({ marks: [{ point: { x: 7, y: 7 }, label: '两端' }] })

    expect(screen.getByTestId('board-mark-7-7')).toHaveTextContent('两端')
  })

  it('三种色调都能区分开，默认是强调色', () => {
    setup({
      marks: [
        { point: { x: 1, y: 1 }, tone: 'good' },
        { point: { x: 2, y: 2 }, tone: 'bad' },
        { point: { x: 3, y: 3 } },
      ],
    })

    expect(screen.getByTestId('board-mark-1-1')).toHaveAttribute('data-tone', 'good')
    expect(screen.getByTestId('board-mark-2-2')).toHaveAttribute('data-tone', 'bad')
    expect(screen.getByTestId('board-mark-3-3')).toHaveAttribute('data-tone', 'accent')
  })

  it('marks 为空时不渲染标记', () => {
    setup({ marks: [] })

    expect(screen.queryAllByTestId(/^board-mark-/)).toHaveLength(0)
  })

  it('不传 marks 时不渲染标记', () => {
    setup()

    expect(screen.queryAllByTestId(/^board-mark-/)).toHaveLength(0)
  })

  it('标记原样渲染，画在已有棋子上也不跳过', () => {
    // 判题反馈要的正是「把标记打在这颗刚落下的子上」。这里曾经有一条
    // 「跳过已占用点」的兜底，结果是反馈标记被静默吃掉、什么错都不报。
    const board = boardFromLines([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
    ])
    setup({
      board,
      marks: [{ point: { x: 5, y: 7 } }, { point: { x: 7, y: 7 } }, { point: { x: 4, y: 7 } }],
    })

    const markers = screen.getAllByTestId(/^board-mark-/)
    expect(markers.map((el) => el.getAttribute('data-testid'))).toEqual([
      'board-mark-5-7',
      'board-mark-7-7',
      'board-mark-4-7',
    ])
    // 编号按数组下标，与是否落在棋子上无关
    expect(markers.map((el) => el.textContent)).toEqual(['1', '2', '3'])
  })

  it('标记不拦截点击', () => {
    const { onPlay } = setup({ marks: MARKS })

    fireEvent.click(screen.getByTestId('intersection-7-7'))

    expect(onPlay).toHaveBeenCalledWith({ x: 7, y: 7 })
  })
})

describe('Board —— 坐标', () => {
  it('showCoords 打开时渲染坐标标签', () => {
    setup({ showCoords: true })

    const labels = screen.getAllByTestId('coord')
    // 上下各 15 个列标 + 左右各 15 个行号，四条边都有标注，棋盘外框才是均衡的。
    expect(labels).toHaveLength(60)
    expect(labels.map((el) => el.textContent)).toContain('A')
    expect(labels.map((el) => el.textContent)).toContain('O')
    expect(labels.map((el) => el.textContent)).toContain('15')
    expect(labels.map((el) => el.textContent)).toContain('1')
  })

  it('showCoords 关闭时不渲染坐标标签', () => {
    setup({ showCoords: false })

    expect(screen.queryAllByTestId('coord')).toHaveLength(0)
  })
})

describe('Board —— 标记的紧凑尺寸', () => {
  it('radius 自定义时圆与小字号同步缩放（回放编号用，不遮住棋子）', () => {
    const { container } = render(
      <Board
        board={boardFromLines(['...............', '...............', '...............', '...............', '...............', '...............', '...............', '.....B.........'])}
        lastMove={null}
        winLine={null}
        nextPlayer={BLACK}
        showCoords={false}
        interactive={false}
        onPlay={() => {}}
        marks={[{ point: { x: 7, y: 7 }, radius: 0.26 }]}
      />,
    )

    const mark = container.querySelector('[data-testid="board-mark-7-7"]')
    const circle = mark?.querySelector('circle')
    const text = mark?.querySelector('text')

    expect(Number(circle?.getAttribute('r'))).toBeCloseTo(0.26)
    // 字号跟着半径走：0.26 * 1.25 = 0.325
    expect(Number(text?.getAttribute('font-size'))).toBeCloseTo(0.325)
  })

  it('不传 radius 时保持默认 0.4', () => {
    const { container } = render(
      <Board
        board={boardFromLines(['...............', '...............', '...............', '...............', '...............', '...............', '...............', '.....B.........'])}
        lastMove={null}
        winLine={null}
        nextPlayer={BLACK}
        showCoords={false}
        interactive={false}
        onPlay={() => {}}
        marks={[{ point: { x: 7, y: 7 } }]}
      />,
    )

    const circle = container.querySelector('[data-testid="board-mark-7-7"] circle')
    expect(Number(circle?.getAttribute('r'))).toBeCloseTo(0.4)
  })
})
