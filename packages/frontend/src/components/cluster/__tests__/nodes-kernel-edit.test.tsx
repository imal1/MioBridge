// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function renderRuntimes(RuntimesPage: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/runtimes?node=node-edit']}><RuntimesPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const api = vi.hoisted(() => ({
  getClusterStatus: vi.fn(), detectKernels: vi.fn(), updateNodeKernels: vi.fn(), kernelAction: vi.fn(),
  getComponentStates: vi.fn(),
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
    api.getComponentStates.mockResolvedValue({
      success: true,
      data: {
        states: [
          { nodeId: 'node-edit', component: 'xray', installState: 'installed', runtimeState: 'running', monitorState: 'monitored', path: '/opt/bin/xray', configPath: '/custom/xray.json' },
        ],
        updatedAt: '',
      },
      timestamp: '',
    })
  })

  it('detects cores and saves monitoring through the dedicated runtime page', async () => {
    const { default: RuntimesPage } = await import('@/pages/runtimes')
    renderRuntimes(RuntimesPage)
    await screen.findByText('1.11.0')
    fireEvent.click(screen.getByRole('button', { name: '编辑监控范围与路径' }))
    expect((screen.getByRole('checkbox', { name: /Xray/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存并验证监控配置' }))
    // 新加入的 sing-box 取检测到的默认路径；已监控的 xray 必须保留用户的自定义路径。
    await waitFor(() => expect(api.updateNodeKernels).toHaveBeenCalledWith('node-edit', [
      { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
      { type: 'xray', configPath: '/custom/xray.json' },
    ]))
  })

  it('renders the runtime state and real binary path from the component state API', async () => {
    const { default: RuntimesPage } = await import('@/pages/runtimes')
    renderRuntimes(RuntimesPage)
    expect(await screen.findByText('/opt/bin/xray')).toBeDefined()
    expect(screen.getByText('running')).toBeDefined()
  })

  it('re-detects and adopts newly installed kernels directly, without a confirmation step', async () => {
    const { default: RuntimesPage } = await import('@/pages/runtimes')
    renderRuntimes(RuntimesPage)
    await screen.findByText('1.11.0')
    // v2ray 未安装 → 卡片上出现「再次检测」；点击后 sing-box 已安装未监控，直接纳管，无任何确认弹窗。
    fireEvent.click(screen.getByRole('button', { name: '再次检测' }))
    await waitFor(() => expect(api.updateNodeKernels).toHaveBeenCalledWith('node-edit', [
      { type: 'xray', configPath: '/custom/xray.json' },
      { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
    ]))
    expect(screen.queryByText(/检测到未纳管内核/)).toBeNull()
  })

  it('keeps install-state changes as links to the deployment center', async () => {
    const { default: RuntimesPage } = await import('@/pages/runtimes')
    renderRuntimes(RuntimesPage)
    await screen.findByText('1.11.0')
    const links = screen.getAllByRole('link', { name: /升级\/修复\/卸载|前往部署/ })
    expect(links.some(link => link.getAttribute('href')?.includes('/deploy?node=node-edit'))).toBe(true)
  })
})
