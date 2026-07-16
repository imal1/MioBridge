// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getClusterStatus: vi.fn(), detectKernels: vi.fn(), updateNodeKernels: vi.fn(), kernelAction: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ apiService: api }))

const node = {
  nodeId: 'node-edit', name: '东京节点', host: 'jp.example.com', location: 'JP', enabled: true,
  online: true, nodesCount: 4, configuredKernels: [{ type: 'xray' as const, configPath: '/custom/xray.json' }],
  kernels: [
    { type: 'sing-box' as const, detected: true, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
    { type: 'xray' as const, detected: true, monitored: true, accessible: true, nodesCount: 4, configPaths: ['/custom/xray.json'] },
    { type: 'v2ray' as const, detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
  ],
  agent: { deployed: true, version: '1.0.0', status: 'running' as const, lastDeploy: '' },
}
const cluster = { totalNodes: 1, onlineNodes: 1, totalProxies: 4, nodes: [node], lastUpdated: '' }
const detections = [
  { type: 'sing-box' as const, installed: true, version: '1.11.0', defaultConfigPath: '/etc/sing-box/config.json' },
  { type: 'xray' as const, installed: true, version: '1.8.0', defaultConfigPath: '/etc/xray/config.json' },
  { type: 'v2ray' as const, installed: false, defaultConfigPath: '/etc/v2ray/config.json' },
]

describe('Runtime monitoring management', () => {
  beforeEach(() => {
    api.getClusterStatus.mockResolvedValue({ success: true, data: cluster, timestamp: '' })
    api.detectKernels.mockResolvedValue(detections)
    api.updateNodeKernels.mockResolvedValue({ success: true, data: {}, timestamp: '' })
    api.kernelAction.mockResolvedValue({ success: true, timestamp: '' })
  })

  it('detects cores and saves monitoring through the dedicated runtime page', async () => {
    const { default: RuntimesPage } = await import('@/pages/runtimes')
    render(<MemoryRouter initialEntries={['/runtimes?node=node-edit']}><RuntimesPage /></MemoryRouter>)
    await screen.findByText('1.11.0')
    fireEvent.click(screen.getByRole('button', { name: '编辑监控范围与路径' }))
    expect((screen.getByRole('checkbox', { name: /Xray/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存并验证监控配置' }))
    await waitFor(() => expect(api.updateNodeKernels).toHaveBeenCalledWith('node-edit', [
      { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
      { type: 'xray', configPath: '/etc/xray/config.json' },
    ]))
  })

  it('keeps install-state changes as links to the deployment center', async () => {
    const { default: RuntimesPage } = await import('@/pages/runtimes')
    render(<MemoryRouter initialEntries={['/runtimes?node=node-edit']}><RuntimesPage /></MemoryRouter>)
    await screen.findByText('1.11.0')
    const links = screen.getAllByRole('link', { name: /升级\/修复\/卸载|前往部署/ })
    expect(links.some(link => link.getAttribute('href')?.includes('/deploy?node=node-edit'))).toBe(true)
  })
})
