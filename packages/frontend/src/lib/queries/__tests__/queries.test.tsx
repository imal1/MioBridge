// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiService } from '@/lib/api'
import { useClusterStatus } from '@/lib/queries'

describe('useClusterStatus', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('dedupes concurrent callers into one apiService call', async () => {
    const spy = vi.spyOn(apiService, 'getClusterStatus').mockResolvedValue({ success: true, data: { nodes: [] }, timestamp: '' } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const a = renderHook(() => useClusterStatus(), { wrapper })
    const b = renderHook(() => useClusterStatus(), { wrapper })
    await waitFor(() => expect(a.result.current.data).toBeDefined())
    await waitFor(() => expect(b.result.current.data).toBeDefined())
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('surfaces server error message when success is false', async () => {
    vi.spyOn(apiService, 'getClusterStatus').mockResolvedValue({ success: false, error: '节点服务不可用', timestamp: '' } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useClusterStatus(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('节点服务不可用')
  })
})
