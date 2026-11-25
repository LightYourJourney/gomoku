import type { Ref } from 'react'
import { Button } from '../ui/Button'

export interface ControlBarProps {
  canUndo: boolean
  /** 此刻能不能求提示：轮到自己、对局进行中（= `canHumanPlay`）。 */
  canHint: boolean
  /** 已经有一个提示请求在飞。 */
  hintThinking: boolean
  canResign: boolean
  onUndo: () => void
  onHint: () => void
  onRestart: () => void
  onResign: () => void
  /**
   * 「重新开始」按钮的 ref。
   *
   * 对局结束后它是棋盘上唯一还有意义的操作，所以终局弹窗关闭时把焦点送到这里
   * （见 `ResultDialog` 的 `focusAfterClose`）——键盘用户不必从页面最开头重新 Tab。
   */
  restartButtonRef?: Ref<HTMLButtonElement>
  /** 「求提示」按钮的 ref。提示面板的「收起」把焦点交还到这里（见 `HintPanel` 的 `focusAfterClear`）。 */
  hintButtonRef?: Ref<HTMLButtonElement>
}

/**
 * 对战工具栏。棋盘正下方，**常用操作都在这一个地方**。
 *
 * 它此前是缩在右栏「对局」面板里的三颗按钮，而「求提示」另在「AI 提示」面板里——
 * 同一个请求两个入口，同一个功能两处散落。任务书 §四 要求收拢到棋盘附近，
 * 并明确「不得导致同一请求被多个入口重复触发」，所以提示的入口**只在这里**，
 * 结果与说明仍留在右栏的 `HintPanel`。
 *
 * 认输是破坏性操作：`ml-auto` 推到行的另一端，窄屏（`flex-wrap`）换行时落在
 * 自己那一行的右端——**可发现，但不与日常操作挤在一起**。
 */
export function ControlBar({
  canUndo,
  canHint,
  hintThinking,
  canResign,
  onUndo,
  onHint,
  onRestart,
  onResign,
  restartButtonRef,
  hintButtonRef,
}: ControlBarProps) {
  return (
    <div role="group" aria-label="对局操作" className="flex flex-wrap items-center gap-2">
      <Button onClick={onUndo} disabled={!canUndo}>
        悔棋
      </Button>
      {/*
        `primary`：它是「主动去问引擎」的那一颗，也是这一屏唯一的下一步。
        提示正在算的时候必须不可用——否则能连点，而提示与落子共用同一只引擎。

        「正在算」用 `aria-disabled` 而不是原生 `disabled`：原生禁用的那一刻焦点掉到
        `<body>`（生产构建 Chrome 实测），按回车求提示的键盘用户当场丢了位置。
        `aria-disabled` 让读屏照样说「不可用」、焦点留在原处，连点由 onClick 挡掉。
        轮不到自己（`!canHint`）仍用原生禁用——那不是按这颗按钮造成的。
      */}
      <Button
        ref={hintButtonRef}
        variant="primary"
        onClick={hintThinking ? undefined : onHint}
        disabled={!canHint}
        aria-disabled={hintThinking || undefined}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
      >
        求提示
      </Button>
      <Button ref={restartButtonRef} onClick={onRestart}>
        重新开始
      </Button>
      <Button variant="danger" className="ml-auto" onClick={onResign} disabled={!canResign}>
        认输
      </Button>
    </div>
  )
}
