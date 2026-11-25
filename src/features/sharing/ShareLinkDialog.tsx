import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'

import type { ShareLinkResult } from '../../sharing/link'

export interface ShareOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly generate: () => ShareLinkResult
}

export interface ShareLinkDialogProps {
  readonly open: boolean
  readonly title: string
  readonly options: readonly ShareOption[]
  readonly onClose: () => void
}

/**
 * 分享链接弹窗。
 *
 * 链接只展示、复制或手动选择；不自动打开、不上传、不生成二维码。
 * 内容超长时由生成器返回错误，提示改用 Phase 11A 的文件导出。
 */
export function ShareLinkDialog({ open, title, options, onClose }: ShareLinkDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const descriptionIdBase = useId()
  const [result, setResult] = useState<ShareLinkResult | null>(null)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'manual'>('idle')

  function close(): void {
    setResult(null)
    setCopied('idle')
    onClose()
  }

  /*
   * 选项列表与链接框是**互相替换**的：被点的按钮随即卸载，焦点会掉到 `<body>`。
   * 所以换完之后把焦点交给新出现的那一块——`flushSync` 让 DOM 先更新，再 `focus()`。
   * 生成失败时选项列表还在、被点的按钮也还在，焦点不用动。
   */
  function choose(option: ShareOption): void {
    const next = option.generate()
    flushSync(() => {
      setCopied('idle')
      setResult(next)
    })
    if (next.ok) inputRef.current?.focus()
  }

  function reselect(): void {
    flushSync(() => setResult(null))
    firstOptionRef.current?.focus()
  }

  async function copy(): Promise<void> {
    if (result === null || !result.ok) return
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied('copied')
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
      setCopied('manual')
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      footer={
        <Button block onClick={close}>
          关闭
        </Button>
      }
    >
      <div data-testid="share-dialog" className="space-y-3">
        {result === null || !result.ok ? (
          <div className="space-y-2">
            {options.map((option, index) => (
              /*
               * 名字只取标题，说明走 `aria-describedby`：说明是做选择的依据，
               * 原先 `aria-label` 把它整个盖掉了，读屏听不到。
               * `whitespace-normal` 挂在两个 span 上而不是按钮上：`Button` 自带
               * `whitespace-nowrap`，同名工具类之间没有优先级，靠后的赢；
               * 子元素上声明则一定盖过继承来的值，长说明才能换行。
               */
              <Button
                key={option.id}
                ref={index === 0 ? firstOptionRef : undefined}
                block
                aria-label={option.label}
                aria-describedby={`${descriptionIdBase}-${option.id}`}
                onClick={() => choose(option)}
                className="h-auto flex-col items-start gap-1 py-2 text-left"
              >
                <span className="font-medium whitespace-normal">{option.label}</span>
                <span id={`${descriptionIdBase}-${option.id}`} className="text-xs font-normal whitespace-normal text-muted">
                  {option.description}
                </span>
              </Button>
            ))}
            {result !== null && !result.ok && (
              <p role="alert" data-testid="share-error" className="text-sm text-danger">
                {result.message}
              </p>
            )}
          </div>
        ) : (
          // `flex gap` 而不是 `space-y`：下面的播报区常驻，空着时靠 `empty:absolute` 退出排版；
          // `space-y` 按选择器加边距，空节点也会多占一截间距。
          <div className="flex flex-col gap-3">
            <label className="block text-xs text-faint">
              分享链接
              <input
                ref={inputRef}
                data-testid="share-link"
                readOnly
                value={result.link}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg"
              />
            </label>
            <div className="flex gap-2">
              <Button block onClick={() => void copy()}>
                {copied === 'copied' ? '已复制' : '复制链接'}
              </Button>
              {options.length > 1 && (
                <Button block onClick={reselect}>
                  重新选择
                </Button>
              )}
            </div>
            {/* 播报区常驻、只换内容：随内容一起挂载的 `role="status"` 部分读屏不播报 */}
            <div role="status" data-testid="share-copy-status" className="empty:absolute">
              {copied === 'manual' && (
                <p data-testid="share-manual" className="text-xs text-warn">
                  无法自动复制，请手动选择上面的链接。
                </p>
              )}
            </div>
            <p className="text-xs text-faint">
              链接只包含本次选择的内容；打开预览不会自动写入本地棋谱库。
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
