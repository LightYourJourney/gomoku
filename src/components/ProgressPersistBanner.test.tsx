import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgressPersistBanner } from './ProgressPersistBanner'

describe('ProgressPersistBanner', () => {
  it('失败时显示错误条，重试按钮可点', () => {
    const retry = vi.fn()
    render(<ProgressPersistBanner failed onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('学习进度未能保存')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('未失败时不渲染', () => {
    const { container } = render(<ProgressPersistBanner failed={false} onRetry={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
