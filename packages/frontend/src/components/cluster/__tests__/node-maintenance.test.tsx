// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeMaintenancePanel } from '../NodeMaintenancePanel'

const api = vi.hoisted(() => ({ diagnoseNode: vi.fn(), repairNode: vi.fn(), migrateNodeService: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiService: api }))
const report = {
  nodeId: 'child', checkedAt: '2026-09-24T00:00:00Z', serviceMode: 'user', runtimeUser: 'agent', version: '1.2.21', healthy: false,
  checks: [{ key: 'linger', label: 'Linger', status: 'fail', reason: 'Linger 未启用', suggestion: '启用 Linger', repairable: true }],
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><NodeMaintenancePanel nodeId="child" runtimeUser="agent" /></QueryClientProvider>)
}
describe('node maintenance', () => {
  beforeEach(() => vi.clearAllMocks())
  it('runs diagnostics only on request and displays reasons and suggested actions', async () => {
    api.diagnoseNode.mockResolvedValue({ success: true, data: report })
    setup()
    expect(api.diagnoseNode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '开始体检' }))
    expect(await screen.findByText('Linger 未启用')).toBeTruthy()
    expect(screen.getByText('启用 Linger')).toBeTruthy()
    expect(api.repairNode).not.toHaveBeenCalled()
  })
  it('shows independent acceptance failure without claiming repair succeeded', async () => {
    api.diagnoseNode.mockResolvedValue({ success: true, data: report })
    api.repairNode.mockResolvedValue({ success: false, error: '版本验收失败' })
    setup()
    fireEvent.click(screen.getByRole('button', { name: '开始体检' }))
    await screen.findByText('Linger 未启用')
    fireEvent.click(screen.getByRole('button', { name: '一键修复' }))
    expect((await screen.findByRole('alert')).textContent).toContain('版本验收失败')
    expect(screen.queryByText('修复完成，断线存活验收通过')).toBeNull()
  })
  it('requires an explicit migration action and selected runtime user', async () => {
    api.migrateNodeService.mockResolvedValue({ success: true, data: { ...report, serviceMode: 'system', healthy: true, checks: [] } })
    setup()
    expect(api.migrateNodeService).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '迁移至系统级服务' }))
    expect(api.migrateNodeService).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '开始迁移' }))
    await waitFor(() => expect(api.migrateNodeService).toHaveBeenCalledWith('child', 'agent'))
    expect(await screen.findByText('迁移完成，断线存活验收通过')).toBeTruthy()
  })
})
