// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getMetrics: vi.fn(), getStatus: vi.fn(), getClusterStatus: vi.fn() }))

vi.mock('@/lib/api', () => ({
  apiService: {
    getStatus: mocks.getStatus,
    getClusterStatus: mocks.getClusterStatus,
    getMetrics: mocks.getMetrics,
  },
}))

const initialStatus = {
  rawExists: true, subscriptionExists: true, clashExists: true, mihomoAvailable: true,
  nodesCount: 3, uptime: 120, version: '1.0.0', mihomoVersion: '1.19.0',
}

function renderDashboard(Dashboard: React.ComponentType<{ initialStatus?: typeof initialStatus }>) {
  // 传入初始数据，挂载时不会自动拉取，这样点击才是唯一的请求来源。
  return render(<MemoryRouter><Dashboard initialStatus={initialStatus} /></MemoryRouter>)
}

describe('Dashboard 刷新失败反馈', () => {
  beforeEach(() => {
    mocks.getClusterStatus.mockResolvedValue({ success: true, data: null })
    mocks.getMetrics.mockResolvedValue({ success: true, data: null })
  })

  it('点击刷新失败时把错误告诉用户，而不是静默吞掉', async () => {
    mocks.getStatus.mockRejectedValue(new Error('后端连接被拒绝'))
    const Dashboard = (await import('@/components/Dashboard')).default
    renderDashboard(Dashboard)

    fireEvent.click(screen.getByRole('button', { name: /刷新摘要/ }))

    await waitFor(() => expect(screen.getByText('状态异常')).toBeDefined())
    expect(screen.getByText('后端连接被拒绝')).toBeDefined()
  })

  it('重新刷新成功后清掉上一次的错误提示', async () => {
    mocks.getStatus.mockRejectedValueOnce(new Error('后端连接被拒绝')).mockResolvedValue(initialStatus)
    const Dashboard = (await import('@/components/Dashboard')).default
    renderDashboard(Dashboard)

    fireEvent.click(screen.getByRole('button', { name: /刷新摘要/ }))
    await waitFor(() => expect(screen.getByText('状态异常')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /刷新摘要/ }))
    await waitFor(() => expect(screen.queryByText('状态异常')).toBeNull())
  })
})
