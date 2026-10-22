/**
 * 浏览器原生下载。**只在这里碰 DOM/Blob**，数据组装留在纯逻辑模块里，
 * 这样格式与校验可以在 Node 下测，下载路径交给 Playwright 真跑。
 */
export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
