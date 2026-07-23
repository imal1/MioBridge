// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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

function renderDashboard(Dashboard: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Dashboard 状态错误反馈', () => {
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
})
