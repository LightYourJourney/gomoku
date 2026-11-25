import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShareLinkDialog } from './ShareLinkDialog'

afterEach(() => {
  Object.defineProperty(window.navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  })
})

describe('ShareLinkDialog —— 生成、复制与失败提示', () => {
  it('选择分享范围后显示链接，并可以复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const onClose = vi.fn()
    render(
      <ShareLinkDialog
        open
        title="分享棋谱"
        onClose={onClose}
        options={[
          {
            id: 'game',
            label: '分享整盘',
            description: '完整棋谱',
            generate: () => ({ ok: true, link: 'https://example.test/#share=abc' }),
          },
          {
            id: 'current',
            label: '分享当前局面',
            description: '当前回合',
            generate: () => ({ ok: false, message: '太长了' }),
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '分享整盘' }))
    const input = screen.getByTestId('share-link')
    expect(input).toHaveValue('https://example.test/#share=abc')
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
    expect(writeText).toHaveBeenCalledWith('https://example.test/#share=abc')
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('关闭后重置，重新打开不会显示上一次链接', () => {
    const onClose = vi.fn()
    const generate = vi.fn(() => ({ ok: true as const, link: 'https://example.test/#share=old' }))
    render(
      <ShareLinkDialog
        open
        title="分享棋谱"
        onClose={onClose}
        options={[
          {
            id: 'game',
            label: '分享整盘',
            description: '完整棋谱',
            generate,
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '分享整盘' }))
    expect(screen.getByTestId('share-link')).toHaveValue('https://example.test/#share=old')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByTestId('share-link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '分享整盘' })).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('复制失败时给出手动复制方式', async () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
      configurable: true,
    })
    render(
      <ShareLinkDialog
        open
        title="分享局面"
        onClose={vi.fn()}
        options={[
          {
            id: 'position',
            label: '分享当前局面',
            description: '自由摆盘',
            generate: () => ({ ok: true, link: 'https://example.test/#share=xyz' }),
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '分享当前局面' }))
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
    expect(await screen.findByTestId('share-manual')).toHaveTextContent('手动选择')
  })

  /*
   * 选完选项，选项列表整块换成链接框：不移焦的话焦点跟着被卸载的按钮掉到 `<body>`。
   * 「重新选择」同理，它自己也会被换掉。
   */
  it('选完选项焦点到链接框；点「重新选择」焦点回到第一个选项', () => {
    render(
      <ShareLinkDialog
        open
        title="分享棋谱"
        onClose={vi.fn()}
        options={[
          {
            id: 'game',
            label: '分享整盘',
            description: '完整棋谱',
            generate: () => ({ ok: true, link: 'https://example.test/#share=abc' }),
          },
          {
            id: 'current',
            label: '分享当前局面',
            description: '当前回合',
            generate: () => ({ ok: true, link: 'https://example.test/#share=def' }),
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '分享当前局面' }))
    expect(screen.getByTestId('share-link')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '重新选择' }))
    expect(screen.getByRole('button', { name: '分享整盘' })).toHaveFocus()
  })

  /*
   * 选项的说明是用户做选择的依据。原先 `aria-label` 只写了标题，把按钮里的说明盖掉了——
   * 读屏只念「分享整盘」，「完整棋谱」听不到。
   */
  it('选项的说明进入可访问描述', () => {
    render(
      <ShareLinkDialog
        open
        title="分享棋谱"
        onClose={vi.fn()}
        options={[
          {
            id: 'game',
            label: '分享整盘',
            description: '完整棋谱，含全部手顺',
            generate: () => ({ ok: true, link: 'https://example.test/#share=abc' }),
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: '分享整盘' })).toHaveAccessibleDescription('完整棋谱，含全部手顺')
  })

  it('生成失败显示原因', () => {
    render(
      <ShareLinkDialog
        open
        title="分享棋谱"
        onClose={vi.fn()}
        options={[
          {
            id: 'game',
            label: '分享整盘',
            description: '完整棋谱',
            generate: () => ({ ok: false, message: '内容超过上限' }),
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '分享整盘' }))
    expect(screen.getByTestId('share-error')).toHaveTextContent('内容超过上限')
  })
})
