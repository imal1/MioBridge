// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MetricsSnapshot, MetricsSummary } from '@/lib/types'

const mocks = vi.hoisted(() => ({ getMetrics: vi.fn(), getStatus: vi.fn(), getClusterStatus: vi.fn() }))

vi.mock('@/lib/api', () => ({
  apiService: {
    getStatus: mocks.getStatus,
    getClusterStatus: mocks.getClusterStatus,
    getMetrics: mocks.getMetrics,
  },
}))

function summary(): MetricsSummary {
  return {
    deploymentSuccessRate: null, deploymentCompleted: 0, deploymentAverageDurationMs: null,
    deploymentStepAverageDurationMs: {}, agentOnlineRate: null, sourceSuccessRate: null,
    subscriptionSuccessRate: null, subscriptionJobs: 0, artifactAverageAgeSeconds: null,
    artifactMaximumAgeSeconds: null,
  }
}

/** 用快照条数区分是哪一个窗口的响应：界面上会渲染成「N 个快照样本」。 */
function metricsWith(snapshots: number) {
  return {
    success: true,
    data: {
      range: '',
      snapshot: {} as MetricsSnapshot,
      history: Array.from({ length: snapshots }, () => ({}) as MetricsSnapshot),
      summary: summary(),
    },
  }
}

/** 一个可以由测试决定何时兑现的 promise，用来精确编排响应到达顺序。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

describe('Dashboard 指标窗口竞态', () => {
  it('先发的旧窗口响应后到时不得覆盖新窗口的数据', async () => {
    const slow24h = deferred<unknown>()
    const fast30d = deferred<unknown>()

    mocks.getStatus.mockResolvedValue({})
    mocks.getClusterStatus.mockResolvedValue({ success: true, data: null })
    mocks.getMetrics.mockImplementation((range: string) =>
      range === '24h' ? slow24h.promise : fast30d.promise)

    const Dashboard = (await import('@/components/Dashboard')).default
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><Dashboard /></MemoryRouter>
      </QueryClientProvider>,
    )

    // 挂载时按默认的 24h 发起请求，此时切到 30d，两个请求同时在途。
    await waitFor(() => expect(mocks.getMetrics).toHaveBeenCalledWith('24h'))
    fireEvent.click(screen.getByRole('button', { name: '30d' }))
    await waitFor(() => expect(mocks.getMetrics).toHaveBeenCalledWith('30d'))

    // 后发的 30d 先返回，再让先发的 24h 迟到。
    fast30d.resolve(metricsWith(30))
    await waitFor(() => expect(screen.getByText('30 个快照样本')).toBeDefined())

    slow24h.resolve(metricsWith(24))
    await new Promise(res => setTimeout(res, 0))

    // 当前窗口是 30d：迟到的 24h 响应写入的是 ['metrics','24h'] 缓存，不影响当前视图。
    expect(screen.getByText('30 个快照样本')).toBeDefined()
    expect(screen.queryByText('24 个快照样本')).toBeNull()
  })
})
