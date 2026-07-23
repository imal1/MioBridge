// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api', () => ({ apiService: {
  getStatus: vi.fn().mockResolvedValue({}), getClusterStatus: vi.fn().mockResolvedValue({ success: true, data: null }),
  getConfigSchema: vi.fn().mockResolvedValue({ success: true, data: { fields: [] } }),
  getEffectiveConfig: vi.fn().mockResolvedValue({ success: true, data: { config: {}, path: '' } }),
  getMetrics: vi.fn().mockResolvedValue({ success: true, data: { snapshot: {}, history: [], summary: {} } }),
  getConfigs: vi.fn().mockResolvedValue([]), getFrontendConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
  validateConfig: vi.fn().mockResolvedValue({ success: true }), updateConfigs: vi.fn().mockResolvedValue({ success: true, data: { count: 1 } }),
} }))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const status = { rawExists: true, subscriptionExists: true, clashExists: true, mihomoAvailable: true, nodesCount: 12, uptime: 120, version: '1.0.0', mihomoVersion: '1.19.0' }
const cluster = { totalNodes: 2, onlineNodes: 1, totalProxies: 12, nodes: [
  { nodeId: 'node-sg', name: '新加坡', location: '新加坡', configuredKernels: [{ type: 'sing-box' as const }, { type: 'xray' as const }], kernels: [{ type: 'sing-box' as const, detected: true, monitored: true, accessible: true, nodesCount: 8, configPaths: [] }], online: true, agent: { deployed: true, version: '1.0.0', status: 'running' as const, lastDeploy: '' } },
  { nodeId: 'node-jp', name: '东京', location: '东京', configuredKernels: [{ type: 'xray' as const }, { type: 'v2ray' as const }], kernels: [], online: false, agent: { deployed: true, version: '1.0.0', status: 'running' as const, lastDeploy: '' } },
], lastUpdated: '' }

describe('Cluster Dashboard Page', () => {
  it('renders overview counts and readiness without executing business actions', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default
    renderWithClient(<MemoryRouter><Dashboard initialCluster={cluster} initialStatus={status} initialError={null} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '总览' })).toBeDefined()
    expect(screen.getByText('1/2')).toBeDefined()
    expect(screen.getByText('1/4 可用')).toBeDefined()
    expect(screen.queryByRole('button', { name: '立即更新订阅' })).toBeNull()
    expect(screen.getByRole('link', { name: /生成订阅/ })).toBeDefined()
  })

  it('exposes the redesign header shortcuts', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default
    renderWithClient(<MemoryRouter><Dashboard initialCluster={null} initialError={null} /></MemoryRouter>)
    // 重设计头部动作：添加节点 → /nodes，生成订阅 → /subscription。
    expect(screen.getByRole('link', { name: /添加节点/ })).toBeDefined()
    expect(screen.getByRole('link', { name: /生成订阅/ })).toBeDefined()
  })

  it('manages structured config drafts without runtime capability cards', async () => {
    const ConfigPage = (await import('@/pages/config')).default
    renderWithClient(<ConfigPage initialConfigs={['default']} frontendConfig={{}} initialError={null} />)
    expect(screen.queryByRole('tab', { name: '运行能力' })).toBeNull()
    fireEvent.change(screen.getByLabelText('protocols.sing_box_configs'), { target: { value: 'default, vless-reality' } })
    expect(screen.getByText(/待保存差异/)).toBeDefined()
    expect(screen.getByText(/vless-reality/)).toBeDefined()
  })
})
