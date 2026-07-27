// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { copyText } from '../clipboard'

afterEach(() => { vi.unstubAllGlobals() })

describe('copyText', () => {
  it('uses the async clipboard API in a secure context', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyText('https://example.test/clash.yaml')
    expect(writeText).toHaveBeenCalledWith('https://example.test/clash.yaml')
  })

  it('falls back to execCommand when served over plain http', async () => {
    // 非安全上下文里 navigator.clipboard 根本不存在，直接调用会抛 TypeError。
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', {})
    let copied = ''
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea')?.value ?? ''
      return true
    })
    await copyText('http://box.lan:3000/clash.yaml')
    expect(copied).toBe('http://box.lan:3000/clash.yaml')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('rejects when the fallback is refused so callers can warn', async () => {
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => false)
    await expect(copyText('nope')).rejects.toThrow('浏览器拒绝了复制操作')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
