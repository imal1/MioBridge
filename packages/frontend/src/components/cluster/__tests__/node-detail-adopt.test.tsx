// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeDetail } from '../NodeDetail'
import type { NodeStatus } from '@/lib/types'

const api = vi.hoisted(() => ({ updateNodeKernels: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiService: api }))
// iconify 在 jsdom 里异步拉取图标，测试卸载后其 timer 仍 fire → unhandled error 噪音；
// 图标非本测试关注点，stub 掉即可。
vi.mock('@iconify/react', () => ({ Icon: () => null }))

function renderDetail(node: NodeStatus, onHealthCheck?: (id: string) => Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NodeDetail node={node} isOpen onClose={vi.fn()} onHealthCheck={onHealthCheck} />
    </QueryClientProvider>,
  )
}

const baseNode: NodeStatus = {
  nodeId: 'node-detail-adopt', name: '首尔', location: 'KR', online: true,
  configuredKernels: [{ type: 'xray' }],
  kernels: [
    { type: 'sing-box', detected: true, monitored: false, accessible: true, nodesCount: 0, configPaths: [] },
    { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 4, configPaths: ['/etc/xray/config.json'] },
    { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
  ],
  agent: { deployed: true, version: '1.0.0', status: 'running', lastDeploy: '' },
  adoptableKernels: ['sing-box'],
}

describe('NodeDetail health-check kernel adoption prompt', () => {
  beforeEach(() => {
    api.updateNodeKernels.mockReset()
    api.updateNodeKernels.mockResolvedValue({ success: true, data: {}, timestamp: '' })
  })

  it('does not prompt until the health-check button is pressed', () => {
    renderDetail(baseNode, vi.fn().mockResolvedValue(undefined))
    // 已有可纳管内核，但健康检查前不主动弹，避免打断浏览。
    expect(screen.queryByText(/检测到未纳管内核/)).toBeNull()
  })

  it('prompts adoption after a manual health check and merges on confirm', async () => {
    const onHealthCheck = vi.fn().mockResolvedValue(undefined)
    renderDetail(baseNode, onHealthCheck)

    fireEvent.click(screen.getByRole('button', { name: '健康检查' }))
    await waitFor(() => expect(onHealthCheck).toHaveBeenCalledWith('node-detail-adopt'))
    await screen.findByText(/检测到未纳管内核/)

    fireEvent.click(screen.getByRole('button', { name: '纳管' }))
    await waitFor(() => expect(api.updateNodeKernels).toHaveBeenCalledTimes(1))
    // 合并既有 xray 与新纳管的 sing-box，不重复。
    expect(api.updateNodeKernels).toHaveBeenCalledWith('node-detail-adopt', [{ type: 'xray' }, { type: 'sing-box' }])
  })

  it('hides the prompt on cancel without calling the API', async () => {
    renderDetail(baseNode, vi.fn().mockResolvedValue(undefined))
    fireEvent.click(screen.getByRole('button', { name: '健康检查' }))
    await screen.findByText(/检测到未纳管内核/)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText(/检测到未纳管内核/)).toBeNull()
    expect(api.updateNodeKernels).not.toHaveBeenCalled()
  })

  it('shows no prompt when there is nothing to adopt', async () => {
    renderDetail({ ...baseNode, adoptableKernels: [] }, vi.fn().mockResolvedValue(undefined))
    fireEvent.click(screen.getByRole('button', { name: '健康检查' }))
    await waitFor(() => expect(screen.queryByText(/检测到未纳管内核/)).toBeNull())
  })
})
