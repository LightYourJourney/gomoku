import { useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'

import type { ShareLinkResult } from '../../sharing/link'
export type { ShareLinkResult } from '../../sharing/link'

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
  const [result, setResult] = useState<ShareLinkResult | null>(null)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'manual'>('idle')

  function choose(option: ShareOption): void {
    setCopied('idle')
    setResult(option.generate())
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
      onClose={onClose}
      footer={
        <Button block onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div data-testid="share-dialog" className="space-y-3">
        {result === null || !result.ok ? (
          <div className="space-y-2">
            {options.map((option) => (
              <Button
                key={option.id}
                block
                aria-label={option.label}
                onClick={() => choose(option)}
                className="h-auto flex-col items-start gap-0.5 py-2 text-left"
              >
                <span className="font-medium">{option.label}</span>
                <span className="text-xs font-normal text-muted">{option.description}</span>
              </Button>
            ))}
            {result !== null && !result.ok && (
              <p role="alert" data-testid="share-error" className="text-sm text-danger">
                {result.message}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
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
                <Button block onClick={() => setResult(null)}>
                  重新选择
                </Button>
              )}
            </div>
            {copied === 'manual' && (
              <p role="status" data-testid="share-manual" className="text-xs text-warn">
                无法自动复制，请手动选择上面的链接。
              </p>
            )}
            <p className="text-xs text-faint">
              链接只包含本次选择的内容；打开预览不会自动写入本地棋谱库。
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
