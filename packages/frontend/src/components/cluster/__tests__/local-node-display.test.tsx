// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getClusterStatus: vi.fn(), updateNode: vi.fn(), deleteNode: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ apiService: api }))

const localNode = {
  nodeId: 'local', name: '本机节点', host: '127.0.0.1', location: '本机', enabled: true,
  online: false, configuredKernels: [{ type: 'sing-box' as const }],
  kernels: [
    { type: 'sing-box' as const, detected: false, monitored: true, accessible: false, nodesCount: 0, configPaths: [] },
  ],
}
const childNode = {
  nodeId: 'node-a', name: '东京节点', host: 'jp.example.com', location: 'JP', enabled: true,
  online: true, nodesCount: 4, configuredKernels: [{ type: 'xray' as const }],
  kernels: [
    { type: 'xray' as const, detected: true, monitored: true, accessible: true, nodesCount: 4, configPaths: [] },
  ],
  agent: { deployed: true, version: '1.0.0', status: 'running' as const, lastDeploy: '' },
  lastError: '连接失败: HTTP 401: Unauthorized',
}

describe('Default local node display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists the install-created local node as an ordinary node card', async () => {
    api.getClusterStatus.mockResolvedValue({
      success: true,
      data: { totalNodes: 2, onlineNodes: 1, totalProxies: 4, nodes: [localNode, childNode], lastUpdated: '' },
      timestamp: '',
    })
    const { default: NodesPage } = await import('@/pages/nodes')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><NodesPage /></MemoryRouter></QueryClientProvider>)
    // 本机节点是普通子节点：不被过滤、不带特殊徽标，走与其他节点相同的表格行。
    await screen.findByText('本机节点')
    expect(screen.getByText('127.0.0.1 · 本机')).toBeTruthy()
    expect(screen.getByText('东京节点')).toBeTruthy()
    // 部署入口在选中节点后的详情标签页，不再是每行按钮；离线本机与在线子节点各有一个 Agent 状态徽标。
    expect(screen.getByText('未安装')).toBeTruthy()
    expect(screen.getByText('在线')).toBeTruthy()
    expect(screen.queryByText('本机', { exact: true })).toBeNull()
    fireEvent.click(screen.getByText('东京节点').closest('tr')!)
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    expect(screen.getByText('历史错误（当前已恢复）')).toBeTruthy()
  })

  it('allows an explicitly confirmed force-delete when an unreachable node still has Agent metadata', async () => {
    api.getClusterStatus.mockResolvedValue({
      success: true,
      data: { totalNodes: 2, onlineNodes: 1, totalProxies: 4, nodes: [localNode, childNode], lastUpdated: '' },
      timestamp: '',
    })
    api.deleteNode
      .mockResolvedValueOnce({ success: false, error: '节点仍安装 Agent，请先在部署中心卸载', timestamp: '' })
      .mockResolvedValueOnce({ success: true, data: { nodeId: childNode.nodeId, deleted: true }, timestamp: '' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { default: NodesPage } = await import('@/pages/nodes')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><NodesPage /></MemoryRouter></QueryClientProvider>)

    const nodeName = await screen.findByText('东京节点')
    fireEvent.click(nodeName.closest('tr')!)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => expect(api.deleteNode).toHaveBeenNthCalledWith(1, childNode.nodeId, undefined))
    await waitFor(() => expect(api.deleteNode).toHaveBeenNthCalledWith(2, childNode.nodeId, true))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['fluctuating', '波动', true], ['abnormal', '异常', true], ['offline', '离线', false], ['online', '在线', true],
  ])('shows the API %s heartbeat state and preserves failure diagnostics', async (health, label, online) => {
    api.getClusterStatus.mockResolvedValue({
      success: true,
      data: { totalNodes: 1, onlineNodes: online ? 1 : 0, totalProxies: 4, nodes: [{
        ...childNode, health, online, consecutiveFailures: 1, consecutiveSuccesses: 0,
        ...(health === 'online' ? {} : { error: childNode.lastError }),
        lastErrorAt: '2026-09-24T00:00:02.000Z',
      }], lastUpdated: '' }, timestamp: '',
    })
    const { default: NodesPage } = await import('@/pages/nodes')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><NodesPage /></MemoryRouter></QueryClientProvider>)
    const row = (await screen.findByText('东京节点')).closest('tr')!
    expect(within(row).getByText(label)).toBeTruthy()
    fireEvent.click(row)
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    expect(screen.getByText(health === 'online' ? '历史错误（当前已恢复）' : '最近错误')).toBeTruthy()
    expect(screen.getByText(childNode.lastError)).toBeTruthy()
    expect(screen.getByLabelText('最近异常时间').getAttribute('datetime')).toBe('2026-09-24T00:00:02.000Z')
  })
})
