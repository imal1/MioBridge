/**
 * 面板常以 http:// 跑在局域网主机名上，这类非安全上下文里 navigator.clipboard 是 undefined，
 * 直接调用会抛 TypeError（按钮表现为「点了没反应」）。故降级到 execCommand 兜底。
 */
export async function copyText(value: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(value)
    return
  }
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('浏览器拒绝了复制操作')
  } finally {
    area.remove()
  }
}
