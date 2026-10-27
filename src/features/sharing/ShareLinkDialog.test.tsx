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
