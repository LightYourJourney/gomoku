/**
 * 浏览器原生下载。**只在这里碰 DOM/Blob**，数据组装留在纯逻辑模块里，
 * 这样格式与校验可以在 Node 下测，下载路径交给 Playwright 真跑。
 */
/** 下载文件的确切文本。导出前的自检要量的就是这一份（含缩进），不是紧凑序列化。 */
export function toJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

export function downloadJson(filename: string, value: unknown): void {
  downloadJsonText(filename, toJsonText(value))
}

export function downloadJsonText(filename: string, text: string): void {
  const blob = new Blob([text], {
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
