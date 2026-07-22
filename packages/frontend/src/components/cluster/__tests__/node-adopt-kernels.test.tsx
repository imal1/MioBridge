// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeCard } from '../NodeCard'
import type { NodeStatus } from '@/lib/types'

const api = vi.hoisted(() => ({ updateNodeKernels: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiService: api }))

function renderCard(node: NodeStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><NodeCard node={node} /></QueryClientProvider>)
}

const baseNode: NodeStatus = {
  nodeId: 'node-adopt', name: '东京', location: 'JP', online: true,
  configuredKernels: [{ type: 'xray' }],
  kernels: [
    { type: 'sing-box', detected: true, monitored: false, accessible: true, nodesCount: 0, configPaths: [] },
    { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 4, configPaths: ['/etc/xray/config.json'] },
    { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
  ],
  agent: { deployed: true, version: '1.0.0', status: 'running', lastDeploy: '' },
  adoptableKernels: ['sing-box'],
}

describe('NodeCard kernel adoption prompt', () => {
  beforeEach(() => {
    api.updateNodeKernels.mockReset()
    api.updateNodeKernels.mockResolvedValue({ success: true, data: {}, timestamp: '' })
  })

  it('adopts detected-but-unmonitored kernels, merging into the configured set on confirm', async () => {
    renderCard(baseNode)
    expect(screen.getByText(/检测到未纳管内核/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '纳管' }))
    await waitFor(() => expect(api.updateNodeKernels).toHaveBeenCalledTimes(1))
    // 合并既有 xray 与新纳管的 sing-box，不重复。
    expect(api.updateNodeKernels).toHaveBeenCalledWith('node-adopt', [{ type: 'xray' }, { type: 'sing-box' }])
  })

  it('hides the prompt on ignore without calling the API', () => {
    renderCard(baseNode)
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    expect(screen.queryByText(/检测到未纳管内核/)).toBeNull()
    expect(api.updateNodeKernels).not.toHaveBeenCalled()
  })

  it('shows no prompt when there is nothing to adopt', () => {
    renderCard({ ...baseNode, adoptableKernels: [] })
    expect(screen.queryByText(/检测到未纳管内核/)).toBeNull()
  })

  it('shows no prompt while the node is offline', () => {
    renderCard({ ...baseNode, online: false })
    expect(screen.queryByText(/检测到未纳管内核/)).toBeNull()
  })
})
