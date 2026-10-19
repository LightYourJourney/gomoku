import { useEffect } from 'react'

/**
 * 页面转入后台或即将卸载时，尽最大努力把待写状态冲出去。
 *
 * **这不是落盘保证**：页面销毁后异步写入仍可能来不及提交。它只是把
 * 「最后一次修改」的窗口从「下一次用户操作」提前到浏览器通知我们的那一刻。
 * 调用方不要据此向用户承诺「关掉页面也一定保存」。
 *
 * 两个事件各有覆盖：`visibilitychange` 覆盖切后台 / 锁屏 / 切标签页
 * （移动端在这里被杀的概率最高）；`pagehide` 覆盖关闭与往返缓存。
 * 只监听 `beforeunload` 不够——它在移动端经常不触发，而且会阻止 bfcache。
 */
export function useFlushOnHide(flush: () => Promise<void>): void {
  useEffect(() => {
    const run = (): void => {
      void flush()
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') run()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', run)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', run)
    }
  }, [flush])
}
