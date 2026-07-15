import { describe, expect, it } from 'vitest';
import {
  DashboardRouteRegistry,
  createDashboardTestRequest,
  createDashboardTestResponse,
} from '../../src/dashboard/server/http.js';
import {
  createDashboardServerComposition,
  type DashboardCorePort,
  type DashboardConfigPort,
  type DashboardConvertPort,
  type DashboardOperationsPort,
  type DashboardYamlPort,
  type OperationsResult,
} from '../../src/dashboard/server/composition.js';
import { registerOperationsRoutes } from '../../src/dashboard/server/operationsRoutes.js';
import { registerConfigRoutes } from '../../src/dashboard/server/configRoutes.js';
import { registerConvertRoutes } from '../../src/dashboard/server/convertRoutes.js';

const NOW = '2026-07-12T00:00:00.000Z';

function ok<T>(data: T): OperationsResult<T> {
  return { success: true, data, timestamp: NOW };
}

function err(msg: string, statusCode = 500): OperationsResult {
  return { success: false, error: msg, statusCode, timestamp: NOW };
}

const stubOps: DashboardOperationsPort = {
  getClusterStatus: async () => ok({ nodes: [{ id: 'n1', name: 'node1' }] }),
  getClusterHealth: async () => ok({ healthy: true }),
  triggerClusterUpdate: async () => ok({ updated: 1, results: {} }),
  addNode: async () => ok({ id: 'n1', name: 'new-node' }),
  preflightNode: async () => ok({ checks: [] }),
  updateNode: async () => ok({ id: 'n1' }),
  deleteNode: async () => ok({ deleted: true }),
  updateNodeKernels: async () => ok({ id: 'n1', kernels: [] }),
  restartAgent: async () => ok({}),
  startAgent: async () => ok({}),
  stopAgent: async () => ok({}),
  uninstallAgent: async () => ok({}),
  updateAgent: async () => ok({}),
  deployToNode: async () => ok({ deploymentId: 'd1' }),
  getDeployProgress: async () => ok({ status: null }),
  getAllDeployStatuses: async () => ok({ deployments: {} }),
  detectKernels: async () => ok([]),
  installKernel: async () => ok({}),
  uninstallKernel: async () => ok({}),
  kernelAction: async () => ok({ status: 'running' }),
  startComponentDeployment: async () => ok({ taskId: 'task-1' }),
  getComponentDeployments: async () => ok({ deployments: {} }),
};

const stubConfig: DashboardConfigPort = {
  getConfigs: () => ok({ configs: ['c1'], count: 1 }),
  updateConfigs: async () => ok({ configs: ['c1', 'c2'], count: 2 }),
  getRemoteLogs: async () => ok({ lines: ['log line 1'] }),
};

const stubYaml: DashboardYamlPort = {
  getFullConfig: () => ok({ app: {} }),
  getFrontendConfig: () => ok({ app: {}, network: {} }),
  generateConfig: async () => ok(true),
  validateConfig: () => ok(true),
};

const stubConvert: DashboardConvertPort = {
  convertContent: async () => ok({ clashConfig: 'proxies: []' }),
  diagnoseMihomo: async () => ok({ healthy: true }),
  testProtocols: async () => ok({ tests: [] }),
};

const stubCore: DashboardCorePort = {
  getStatus: async () => ({}),
  updateSubscription: async () => ({}),
  getLocalLogs: async () => ({
    entries: [{ file: 'control.log', lineNumber: 1, content: 'INFO control ready', level: 'info' }],
    files: ['control.log'],
    updatedAt: NOW,
  }),
  artifacts: {} as DashboardCorePort['artifacts'],
} as DashboardCorePort;

function stubDeps() {
  return {
    core: stubCore,
    operations: stubOps,
    config: stubConfig,
    yaml: stubYaml,
    convert: stubConvert,
  };
}

async function dispatch(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
) {
  const composition = createDashboardServerComposition(stubDeps());
  composition.registerRoutes((registry, deps) => {
    registerOperationsRoutes(registry, deps);
    registerConfigRoutes(registry, deps);
    registerConvertRoutes(registry, deps);
  });
  const req = createDashboardTestRequest({ method, path, body, query });
  const res = createDashboardTestResponse();
  const handled = await composition.routes.dispatch(req, res);
  return { handled, res };
}

describe('operations routes', () => {
  it('GET /api/cluster/status', async () => {
    const { handled, res } = await dispatch('GET', '/api/cluster/status');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('GET /api/cluster/health', async () => {
    const { handled, res } = await dispatch('GET', '/api/cluster/health');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/cluster/update', async () => {
    const { handled, res } = await dispatch('POST', '/api/cluster/update');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/cluster/nodes', async () => {
    const { handled, res } = await dispatch('POST', '/api/cluster/nodes', { name: 'n1', host: '10.0.0.1' });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(201);
  });

  it('supports node preflight, metadata update, and deletion routes', async () => {
    const preflight = await dispatch('POST', '/api/cluster/nodes/preflight', { ssh: { host: 'n1' } });
    expect(preflight.handled).toBe(true);
    expect(preflight.res.statusCode).toBe(200);
    const update = await dispatch('PATCH', '/api/cluster/nodes', { nodeId: 'n1', name: 'renamed' });
    expect(update.res.statusCode).toBe(200);
    const remove = await dispatch('DELETE', '/api/cluster/nodes', { nodeId: 'n1' });
    expect(remove.res.statusCode).toBe(200);
  });

  it('PUT /api/cluster/nodes', async () => {
    const { handled, res } = await dispatch('PUT', '/api/cluster/nodes', { nodeId: 'n1', kernels: [] });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('PUT /api/cluster/nodes requires nodeId', async () => {
    const { handled, res } = await dispatch('PUT', '/api/cluster/nodes', { kernels: [] });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/cluster/deploy returns 202', async () => {
    const { handled, res } = await dispatch('POST', '/api/cluster/deploy', { nodeId: 'n1' });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(202);
  });

  it('POST /api/cluster/deploy without nodeId returns 400', async () => {
    const { handled, res } = await dispatch('POST', '/api/cluster/deploy', {});
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/cluster/deploy/progress', async () => {
    const { handled, res } = await dispatch('GET', '/api/cluster/deploy/progress', undefined, { node: 'n1' });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/cluster/deploy/status', async () => {
    const { handled, res } = await dispatch('GET', '/api/cluster/deploy/status', undefined, { nodes: 'n1,n2' });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('agent lifecycle routes all return 200', async () => {
    for (const action of ['restart', 'start', 'stop', 'uninstall', 'update']) {
      const { handled, res } = await dispatch('POST', `/api/cluster/agent/${action}`, { nodeId: 'n1' });
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    }
  });

  it('agent lifecycle routes require nodeId', async () => {
    const { handled, res } = await dispatch('POST', '/api/cluster/agent/restart', {});
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('kernel routes', async () => {
    const { handled: h1, res: r1 } = await dispatch('POST', '/api/cluster/kernel/detect', { nodeId: 'n1' });
    expect(h1).toBe(true);
    expect(r1.statusCode).toBe(200);

    const { handled: h2, res: r2 } = await dispatch('POST', '/api/cluster/kernel/install', { nodeId: 'n1', kernelType: 'sing-box' });
    expect(h2).toBe(true);
    expect(r2.statusCode).toBe(200);

    const { handled: h3, res: r3 } = await dispatch('POST', '/api/cluster/kernel/uninstall', { nodeId: 'n1', kernelType: 'sing-box' });
    expect(h3).toBe(true);
    expect(r3.statusCode).toBe(200);
  });

  it('creates and lists component-aware deployment tasks', async () => {
    const created = await dispatch('POST', '/api/cluster/deployments', {
      nodeIds: ['n1', 'n2'], component: 'mihomo', operation: 'upgrade',
    });
    expect(created.handled).toBe(true);
    expect(created.res.statusCode).toBe(202);
    expect(JSON.parse(created.res.body).data.tasks).toHaveLength(2);

    const listed = await dispatch('GET', '/api/cluster/deployments', undefined, { nodes: 'n1,n2' });
    expect(listed.handled).toBe(true);
    expect(listed.res.statusCode).toBe(200);
  });

  it('validates component deployment input', async () => {
    const { res } = await dispatch('POST', '/api/cluster/deployments', { nodeIds: [], component: 'agent' });
    expect(res.statusCode).toBe(400);
  });
});

describe('config routes', () => {
  it('GET /api/configs', async () => {
    const { handled, res } = await dispatch('GET', '/api/configs');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/configs with invalid body returns 400', async () => {
    const { handled, res } = await dispatch('POST', '/api/configs', { configs: 'not-array' });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/configs with empty array returns 400', async () => {
    const { handled, res } = await dispatch('POST', '/api/configs', { configs: [] });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/logs without node reads local control-plane logs', async () => {
    const { handled, res } = await dispatch('GET', '/api/logs');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      data: { source: 'control', nodeId: 'local', lines: ['INFO control ready'] },
    });
  });
});

describe('yaml routes', () => {
  it('GET /api/yaml/config', async () => {
    const { handled, res } = await dispatch('GET', '/api/yaml/config');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/yaml/frontend', async () => {
    const { handled, res } = await dispatch('GET', '/api/yaml/frontend');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/yaml/generate without templatePath returns 400', async () => {
    const { handled, res } = await dispatch('POST', '/api/yaml/generate', {});
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/yaml/validate', async () => {
    const { handled, res } = await dispatch('GET', '/api/yaml/validate');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});

describe('convert routes', () => {
  it('POST /api/convert without content returns 400', async () => {
    const { handled, res } = await dispatch('POST', '/api/convert', {});
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/diagnose/mihomo', async () => {
    const { handled, res } = await dispatch('GET', '/api/diagnose/mihomo');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/test/protocols', async () => {
    const { handled, res } = await dispatch('GET', '/api/test/protocols');
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
