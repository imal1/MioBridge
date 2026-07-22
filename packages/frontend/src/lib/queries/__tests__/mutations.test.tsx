// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiService } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { useUpdateNode } from '@/lib/queries/mutations'

describe('useUpdateNode', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('invalidates cluster status after updateNode', async () => {
    vi.spyOn(apiService, 'updateNode').mockResolvedValue({ success: true, data: {}, timestamp: '' } as never)
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useUpdateNode(), { wrapper })
    await result.current.mutateAsync({ nodeId: 'n1', patch: { enabled: true } })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.clusterStatus }))
  })
})
