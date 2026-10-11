import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultDialog } from './ResultDialog'
import type { GameStatusDescriptor } from '../../features/battle/status'

const WIN: GameStatusDescriptor = { label: '黑棋获胜', player: 1, tone: 'result' }

function renderDialog(saveState: 'idle' | 'saving' | 'saved' | 'failed') {
  return render(
    <ResultDialog
      open
      status={WIN}
      moves={9}
      saveState={saveState}
      onRestart={vi.fn()}
      onClose={vi.fn()}
    />,
  )
}

describe('ResultDialog 的棋谱保存提示', () => {
  it('保存中显示进行时文案', () => {
    renderDialog('saving')
    expect(screen.getByText(/正在存入棋谱库/)).toBeInTheDocument()
  })

  it('存上了如实说已存入', () => {
    renderDialog('saved')
    expect(screen.getByText(/这局已存入棋谱库/)).toBeInTheDocument()
  })

  it('没存上如实说失败，不假装成功', () => {
    renderDialog('failed')
    expect(screen.getByText(/没能保存这局/)).toBeInTheDocument()
  })

  it('没有入库动作时不显示任何保存文案', () => {
    renderDialog('idle')
    expect(screen.queryByText(/棋谱库/)).not.toBeInTheDocument()
    expect(screen.queryByText(/没能保存/)).not.toBeInTheDocument()
  })
})
