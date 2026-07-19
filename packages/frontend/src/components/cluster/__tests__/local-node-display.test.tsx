// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
    render(<MemoryRouter><NodesPage /></MemoryRouter>)
    // 本机节点是普通子节点：不被过滤、不带特殊徽标，走与其他节点相同的卡片和操作入口。
    await screen.findByText('本机节点')
    expect(screen.getByText('127.0.0.1 · 本机 · local')).toBeTruthy()
    expect(screen.getByText('东京节点')).toBeTruthy()
    expect(screen.getAllByText(/部署 Agent|查看部署/).length).toBe(2)
    expect(screen.queryByText('本机', { exact: true })).toBeNull()
  })
})
