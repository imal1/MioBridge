import { describe, expect, it, vi } from 'vitest';
import { registerApplicationRoutes } from '../../src/dashboard/server/applicationRoutes.js';
import { DashboardRouteRegistry, createDashboardTestRequest, createDashboardTestResponse } from '../../src/dashboard/server/http.js';
import type { DashboardServerDependencies } from '../../src/dashboard/server/composition.js';

const NOW = '2026-07-16T00:00:00.000Z';
const ok = (data: unknown) => ({ success: true, data, timestamp: NOW });

function dependencies() {
  const startComponentDeployment = vi.fn(async () => ok({ taskId: 'task-1' }));
  const setConfigValues = vi.fn(async () => ({ results: [], restartRequired: false }));
  const deps = {
    core: {
      config: { getSchema: () => [{ path: 'app.port', type: 'number', restartRequired: true }] },
      state: { listKeys: async () => [], get: async () => null, set: async () => {}, del: async () => {}, kind: 'file', withLock: async (_key: string, fn: () => Promise<unknown>) => fn() },
      getConfigPath: () => '/runtime/config.yaml', getEffectiveConfig: () => ({ app: { port: 3000 } }),
      setConfigValue: async () => ({}), setConfigValues, restoreLastGoodConfig: async () => ({ restored: true }),
      validateConfig: () => ({ valid: true, issues: [] }), getMetricsSnapshot: async () => ({}),
    },
    operations: {
      startComponentDeployment,
      getComponentDeployments: async () => ok({ deployments: {} }),
      getComponentDeployment: async () => ok({ taskId: 'task-1', status: 'pending' }),
      cancelComponentDeployment: async () => ok({ taskId: 'task-1', status: 'cancelled' }),
      retryComponentDeployment: async () => ok({ taskId: 'task-2' }),
      getDeploymentEvents: async () => ok({ events: [] }),
      getDeploymentLog: async () => ok({ content: 'log' }),
      getManualAgentConfig: async () => ok({ content: 'node:\n  id: child\n' }),
      getComponentStates: async () => ok({ states: [] }),
      preflightNode: async () => ok({ checks: [] }), getClusterStatus: async () => ok({ nodes: [] }),
      updateNode: async () => ok({}), deleteNode: async () => ok({}), detectKernels: async () => ok([]),
    },
    subscription: {
      preflight: async () => ok({ ready: true }), start: async () => ok({ jobId: 'job-1' }), list: async () => ok({ jobs: [] }),
      get: async () => ok(null), retry: async () => ok({ jobId: 'job-2' }), events: async () => ok({ events: [] }),
      artifacts: async () => ok({ artifacts: [] }), previewArtifact: async () => ok({ content: '' }),
      validateArtifacts: async () => ok({ artifacts: [] }), policy: async () => ok({}), updatePolicy: async () => ok({}),
    },
  } as unknown as DashboardServerDependencies;
  return { deps, startComponentDeployment, setConfigValues };
}

async function dispatch(deps: DashboardServerDependencies, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, headers: Record<string, string> = {}) {
  const routes = new DashboardRouteRegistry();
  registerApplicationRoutes(routes, deps);
  const url = new URL(path, 'http://dashboard.test');
  const query = Object.fromEntries(url.searchParams.entries());
  const request = createDashboardTestRequest({ method, path: url.pathname, query, body, headers, requestId: 'request-1' });
  const response = createDashboardTestResponse();
  expect(await routes.dispatch(request, response)).toBe(true);
  return response;
}

describe('canonical dashboard application routes', () => {
  it('runs node diagnostics and explicit repair through the selected node', async () => {
    const { deps } = dependencies();
    const report = { nodeId: 'child', healthy: false, checks: [{ key: 'linger', status: 'fail', reason: 'Linger 未启用' }] };
    const diagnoseNode = vi.fn(async () => ok(report));
    const repairNode = vi.fn(async () => ok({ ...report, healthy: true }));
    Object.assign(deps.operations, { diagnoseNode, repairNode });
    const checked = await dispatch(deps, 'POST', '/api/cluster/nodes/child/diagnostics');
    expect(JSON.parse(checked.body)).toMatchObject({ success: true, data: report });
    expect(diagnoseNode).toHaveBeenCalledWith('child');
    expect(repairNode).not.toHaveBeenCalled();
    const repaired = await dispatch(deps, 'POST', '/api/cluster/nodes/child/repair');
    expect(JSON.parse(repaired.body)).toMatchObject({ success: true, data: { healthy: true } });
    expect(repairNode).toHaveBeenCalledWith('child');
  });

  it('requires an explicit non-root user before service migration', async () => {
    const { deps } = dependencies();
    const migrateNodeService = vi.fn(async () => ok({ serviceMode: 'system', runtimeUser: 'agent' }));
    Object.assign(deps.operations, { migrateNodeService });
    for (const body of [{}, { runtimeUser: 'root' }, { runtimeUser: 'agent;id' }]) {
      const rejected = await dispatch(deps, 'POST', '/api/cluster/nodes/child/migrate-service', body);
      expect(rejected.statusCode).toBe(400);
    }
    expect(migrateNodeService).not.toHaveBeenCalled();
    const migrated = await dispatch(deps, 'POST', '/api/cluster/nodes/child/migrate-service', { runtimeUser: 'agent' });
    expect(JSON.parse(migrated.body)).toMatchObject({ success: true, data: { serviceMode: 'system' } });
    expect(migrateNodeService).toHaveBeenCalledWith('child', 'agent');
  });

  it('keeps a failed acceptance a failure at the API boundary', async () => {
    const { deps } = dependencies();
    Object.assign(deps.operations, { repairNode: async () => { throw new Error('VERSION_MISMATCH: 版本验收失败'); } });
    const failed = await dispatch(deps, 'POST', '/api/cluster/nodes/child/repair');
    expect(failed.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.parse(failed.body)).toMatchObject({ success: false, error: expect.objectContaining({ message: expect.stringContaining('VERSION_MISMATCH') }) });
  });

  it('creates a single-node deployment with idempotency and a 202 envelope', async () => {
    const { deps, startComponentDeployment } = dependencies();
    const response = await dispatch(deps, 'POST', '/api/deployments', {
      nodeId: 'node-1', component: 'agent', operation: 'install', options: { preserveConfig: true, preserveData: true },
    }, { 'idempotency-key': 'same-request' });
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toMatchObject({ success: true, data: { taskId: 'task-1' }, requestId: 'request-1', role: 'admin' });
    expect(startComponentDeployment).toHaveBeenCalledWith('node-1', 'agent', 'install', expect.objectContaining({ idempotencyKey: 'same-request' }));
  });

  it('matches task path parameters and returns a downloadable manual Agent config', async () => {
    const { deps } = dependencies();
    const cancelled = await dispatch(deps, 'POST', '/api/deployments/task-1/cancel');
    expect(JSON.parse(cancelled.body)).toMatchObject({ data: { taskId: 'task-1', status: 'cancelled' } });
    const manual = await dispatch(deps, 'GET', '/api/deployments/agent/manual-config?nodeId=child', undefined, {});
    expect(manual.headers['content-disposition']).toContain('attachment');
    expect(manual.body).toContain('id: child');
  });

  it('atomically applies a config change set and exposes OpenAPI without wrapping the document', async () => {
    const { deps, setConfigValues } = dependencies();
    const saved = await dispatch(deps, 'PATCH', '/api/config', { changes: [{ path: 'app.port', value: 4000 }] });
    expect(saved.statusCode).toBe(200);
    expect(setConfigValues).toHaveBeenCalledWith([{ path: 'app.port', value: 4000 }]);
    const openapi = await dispatch(deps, 'GET', '/api/openapi.json');
    const document = JSON.parse(openapi.body);
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/api/deployments'].post.summary).toContain('部署任务');
    expect(document.success).toBeUndefined();
  });
});
