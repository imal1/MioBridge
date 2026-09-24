// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppContext'

const mocks = vi.hoisted(() => ({
  getMetrics: vi.fn(), getStatus: vi.fn(), getClusterStatus: vi.fn(),
  getArtifacts: vi.fn(), getComponentDeployments: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  apiService: {
    getStatus: mocks.getStatus,
    getClusterStatus: mocks.getClusterStatus,
    getMetrics: mocks.getMetrics,
    getArtifacts: mocks.getArtifacts,
    getComponentDeployments: mocks.getComponentDeployments,
  },
}))

vi.mock('@iconify/react', () => ({ Icon: () => null }))

function renderDashboard(Dashboard: React.ComponentType, withProvider = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const dashboard = <MemoryRouter><Dashboard /></MemoryRouter>
  return render(
    <QueryClientProvider client={client}>
      {withProvider ? <AppProvider>{dashboard}</AppProvider> : dashboard}
    </QueryClientProvider>,
  )
}

describe('Dashboard 状态错误反馈', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    mocks.getClusterStatus.mockResolvedValue({ success: true, data: null })
    mocks.getMetrics.mockResolvedValue({ success: true, data: { snapshot: {}, history: [], summary: {} } })
    mocks.getArtifacts.mockResolvedValue({ success: true, data: { artifacts: [] } })
    mocks.getComponentDeployments.mockResolvedValue({ success: true, data: { deployments: {} } })
  })

  it('状态查询失败时把错误告诉用户，而不是静默吞掉', async () => {
    mocks.getStatus.mockRejectedValue(new Error('后端连接被拒绝'))
    const Dashboard = (await import('@/components/Dashboard')).default
    renderDashboard(Dashboard)

    await waitFor(() => expect(screen.getByText('状态异常')).toBeDefined())
    expect(screen.getByText('后端连接被拒绝')).toBeDefined()
  })

  it('首次健康检查失败后，后台重新检查成功会清除静态预览提示', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default
    const fetchHealth = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(() => Promise.resolve(Response.json({ status: 'healthy' })))
    vi.stubGlobal('fetch', fetchHealth)
    mocks.getStatus.mockResolvedValue({ nodesCount: 2 })
    mocks.getClusterStatus.mockResolvedValue({
      success: true, data: { nodes: [], onlineNodes: 2, totalNodes: 2, totalProxies: 2 },
    })
    vi.useFakeTimers()
    renderDashboard(Dashboard, true)
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })

    expect(screen.getByText('2/2')).toBeDefined()
    expect(screen.getByText('仪表盘后端未运行')).toBeDefined()

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })

    expect(fetchHealth).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('仪表盘后端未运行')).toBeNull()
    expect(screen.getByText('2/2')).toBeDefined()
  })

  it.each([
    ['静态 HTML', '<!doctype html><html><body>Dashboard</body></html>', 'text/html'],
    ['无健康状态的 JSON', '{"success":true}', 'application/json'],
  ])('HTTP 200 的%s 不会被当作健康后端', async (_label, body, contentType) => {
    const Dashboard = (await import('@/components/Dashboard')).default
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
      new Response(body, { status: 200, headers: { 'Content-Type': contentType } }),
    )))
    mocks.getStatus.mockRejectedValue(new Error('没有可用的后端 API'))
    renderDashboard(Dashboard, true)

    await waitFor(() => expect(screen.getByText('仪表盘后端未运行')).toBeDefined())
  })
})
