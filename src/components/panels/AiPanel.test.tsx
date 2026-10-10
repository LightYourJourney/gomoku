import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AiInfo } from '../../store/gameStore'
import { AiPanel, type AiPanelProps } from './AiPanel'

const INFO: AiInfo = {
  depth: 2,
  nodes: 42,
  elapsedMs: 3,
  score: -700,
  confidence: 'exact',
  reason: 'search',
}

function setup(overrides: Partial<AiPanelProps> = {}) {
  const onRetry = vi.fn()
  const onDismissError = vi.fn()
  const props: AiPanelProps = {
    thinking: false,
    info: null,
    error: null,
    canRetry: false,
    onRetry,
    onDismissError,
    ...overrides,
  }

  return { onRetry, onDismissError, ...render(<AiPanel {...props} />) }
}

describe('AiPanel —— 思考与结果', () => {
  it('思考中提示正在搜索', () => {
    setup({ thinking: true })

    expect(screen.getByText(/正在 Web Worker 中搜索/)).toBeInTheDocument()
  })

  it('没有结果时说明尚未分析', () => {
    setup()

    expect(screen.getByText('尚未产生分析结果。')).toBeInTheDocument()
  })

  it('有结果时展示深度、节点、耗时与结论可靠度', () => {
    setup({ info: INFO })

    expect(screen.getByText('2 层')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('3 ms')).toBeInTheDocument()
    expect(screen.getByText('搜索结果')).toBeInTheDocument()
    expect(screen.getByText('精确')).toBeInTheDocument()
  })

  it('启发式结论会额外声明不保证最优', () => {
    setup({ info: { ...INFO, confidence: 'heuristic', reason: 'timeout' } })

    expect(screen.getByText(/不保证最优/)).toBeInTheDocument()
  })
})

describe('AiPanel —— 引擎失败', () => {
  it('报错时显示错误信息', () => {
    setup({ error: 'Worker 挂了' })

    expect(screen.getByRole('alert')).toHaveTextContent('Worker 挂了')
  })

  it('AI 还没落子时提供重试入口，点击触发 onRetry', () => {
    const { onRetry } = setup({ error: 'Worker 挂了', canRetry: true })

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('不该 AI 走的时候不提供重试按钮', () => {
    setup({ error: 'Worker 挂了', canRetry: false })

    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('知道了只负责关掉提示', () => {
    const { onDismissError } = setup({ error: 'Worker 挂了', canRetry: true })

    fireEvent.click(screen.getByRole('button', { name: '知道了' }))

    expect(onDismissError).toHaveBeenCalledTimes(1)
  })
})
