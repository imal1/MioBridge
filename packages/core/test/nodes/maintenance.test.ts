import { describe, expect, it, vi } from 'vitest';
import { NodeMaintenanceService, type NodeDiagnosticsReport, type NodeMaintenancePort } from '../../src/nodes/nodeMaintenanceService.js';
import type { NodeConfig } from '../../src/nodes/types.js';
const node: NodeConfig = { id: 'n', name: 'Node', host: 'node.example', secret: 'agent-secret', kernels: [], location: '', enabled: true };
const healthy: NodeDiagnosticsReport = { nodeId: 'n', checkedAt: '2026-01-01T00:00:00Z', serviceMode: 'user', runtimeUser: 'alice', version: '1.2.12', healthy: true, checks: [{ key: 'running', label: 'Agent 服务', status: 'pass', reason: 'running', repairable: false }] };
function setup(report = healthy) {
  const port: NodeMaintenancePort = { inspect: vi.fn(async () => report), repair: vi.fn(async () => {}), beginMigration: vi.fn(async () => ({ commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) })) };
  const accept = vi.fn(async () => ({}));
  return { port, accept, service: new NodeMaintenanceService({ port, accept }) };
}
describe('node maintenance', () => {
  it('reports a healthy node without changing it', async () => {
    const { service, port, accept } = setup();
    expect(await service.diagnose(node)).toEqual(healthy);
    expect(port.repair).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });
});

describe('repair and migration acceptance', () => {
  const broken: NodeDiagnosticsReport = { ...healthy, healthy: false, checks: [{ key: 'running', label: 'Agent 服务', status: 'fail', reason: 'stopped', suggestion: '启动服务', repairable: true }] };
  it('repairs a failed service and verifies independent acceptance before returning success', async () => {
    const { service, port, accept } = setup(broken);
    vi.mocked(port.inspect).mockResolvedValueOnce(broken).mockResolvedValue(healthy);
    expect(await service.repair(node)).toEqual(healthy);
    expect(port.repair).toHaveBeenCalledWith(node, broken);
    expect(accept).toHaveBeenCalledWith(node, '1.2.12');
  });
  it('does not report success when repair fails or when independent acceptance fails', async () => {
    const failed = setup(broken);
    vi.mocked(failed.port.repair).mockRejectedValue(new Error('permission denied agent-secret'));
    await expect(failed.service.repair(node)).rejects.toThrow('permission denied [REDACTED]');
    expect(failed.accept).not.toHaveBeenCalled();
    const lost = setup(broken);
    lost.accept.mockRejectedValue(new Error('Agent stopped after SSH disconnect'));
    await expect(lost.service.repair(node)).rejects.toThrow('Agent stopped after SSH disconnect');
  });
  it('keeps the old service recoverable until migration acceptance passes', async () => {
    const { service, port, accept } = setup();
    const transaction = { commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) };
    vi.mocked(port.beginMigration).mockResolvedValue(transaction);
    vi.mocked(port.inspect).mockResolvedValueOnce(healthy).mockResolvedValue({ ...healthy, serviceMode: 'system', runtimeUser: 'agent' });
    expect((await service.migrate(node, 'agent')).serviceMode).toBe('system');
    expect(accept).toHaveBeenCalledBefore(transaction.commit);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
  it('rolls back after acceptance failure and retains both failure reasons if rollback fails', async () => {
    const { service, port, accept } = setup();
    const transaction = { commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) };
    vi.mocked(port.beginMigration).mockResolvedValue(transaction);
    accept.mockRejectedValueOnce(new Error('public health failed'));
    await expect(service.migrate(node, 'agent')).rejects.toThrow('public health failed；已恢复');
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledTimes(2);
    accept.mockRejectedValueOnce(new Error('public health failed'));
    transaction.rollback.mockRejectedValue(new Error('restore failed'));
    await expect(service.migrate(node, 'agent')).rejects.toThrow('public health failed；回滚失败：restore failed');
  });
  it('rejects privileged runtime users and surfaces insufficient elevation without starting acceptance', async () => {
    const { service, port, accept } = setup();
    await expect(service.migrate(node, 'root')).rejects.toThrow('非 root');
    expect(port.beginMigration).not.toHaveBeenCalled();
    vi.mocked(port.beginMigration).mockRejectedValue(new Error('sudo permission denied'));
    await expect(service.migrate(node, 'agent')).rejects.toThrow('sudo permission denied');
    expect(accept).not.toHaveBeenCalled();
  });
});
