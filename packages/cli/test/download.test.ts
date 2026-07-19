import { describe, expect, it, vi } from 'vitest'
import { downloadBytes } from '../src/platform/download.js'

function chunkedResponse(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers })
}

describe('downloadBytes', () => {
  it('streams the body and reports progress with the declared total', async () => {
    const seen: Array<[number, number | undefined]> = []
    const data = await downloadBytes('https://example.test/a', {
      fetcher: async () => chunkedResponse(
        [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])],
        { 'content-length': '5' },
      ),
      onProgress: (received, total) => seen.push([received, total]),
    })
    expect([...data]).toEqual([1, 2, 3, 4, 5])
    expect(seen).toEqual([[3, 5], [5, 5]])
  })

  it('reports progress without a total when content-length is missing', async () => {
    const seen: Array<[number, number | undefined]> = []
    await downloadBytes('https://example.test/a', {
      fetcher: async () => chunkedResponse([new Uint8Array([9])]),
      onProgress: (received, total) => seen.push([received, total]),
    })
    expect(seen).toEqual([[1, undefined]])
  })

  it('notifies before each retry and eventually succeeds', async () => {
    const retries: number[] = []
    let calls = 0
    const data = await downloadBytes('https://example.test/a', {
      retryDelayMs: 1,
      fetcher: async () => {
        calls += 1
        if (calls < 3) throw new Error('socket hang up')
        return chunkedResponse([new Uint8Array([7])])
      },
      onRetry: attempt => retries.push(attempt),
    })
    expect([...data]).toEqual([7])
    expect(retries).toEqual([1, 2])
  })

  it('aborts a stalled body but tolerates a slow-yet-moving download', async () => {
    vi.useFakeTimers()
    try {
      // 龟速但一直有数据：每 40ms 一块，共 5 块，空闲超时 100ms —— 必须成功。
      // 这是修复的核心语义：超时衡量的是「多久没有任何数据」，不是总时长。
      let sent = 0
      const slow = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === 5) { controller.close(); return }
          sent += 1
          return new Promise(resolve => {
            setTimeout(() => { controller.enqueue(new Uint8Array([sent])); resolve() }, 40)
          })
        },
      })
      const done = downloadBytes('https://example.test/slow', {
        attempts: 1,
        timeoutMs: 100,
        fetcher: async () => new Response(slow, { status: 200 }),
      })
      await vi.advanceTimersByTimeAsync(400)
      expect([...await done]).toEqual([1, 2, 3, 4, 5])

      // 完全停摆的流：第一块之后再无数据 —— 必须在空闲超时后报错，而不是永远挂着。
      const stalled = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === 5) { sent += 1; controller.enqueue(new Uint8Array([0])); return }
          return new Promise(() => { /* 永不推进 */ })
        },
      })
      const failing = downloadBytes('https://example.test/stalled', {
        attempts: 1,
        timeoutMs: 100,
        fetcher: async () => new Response(stalled, { status: 200 }),
      })
      const outcome = failing.then(() => 'resolved', () => 'rejected')
      await vi.advanceTimersByTimeAsync(400)
      expect(await outcome).toBe('rejected')
    } finally {
      vi.useRealTimers()
    }
  })
})
