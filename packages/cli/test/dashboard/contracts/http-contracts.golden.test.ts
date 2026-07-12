import { describe, expect, it } from 'vitest';
import {
  DashboardRouteRegistry,
  createDashboardTestRequest,
  createDashboardTestResponse,
  type DashboardRoute,
  type DashboardServerDependencies,
} from '../../../src/dashboard/server/http.js';
import {
  createDashboardServerComposition,
  type DashboardCorePort,
  type DashboardConfigPort,
  type DashboardConvertPort,
  type DashboardOperationsPort,
  type DashboardYamlPort,
  type OperationsResult,
} from '../../../src/dashboard/server/composition.js';

// ── Stub implementations ────────────────────────────────────────────

const NOW = '2026-07-12T00:00:00.000Z';

function ok<T>(data: T): OperationsResult<T> {
  return { success: true, data, timestamp: NOW };
}

function err(message: string, statusCode = 500): OperationsResult {
  return { success: false, error: message, statusCode, timestamp: NOW };
}

const stubCore: DashboardCorePort = {
  getStatus: async () => ({
    subscription: { updatedAt: NOW, proxyCount: 5 },
    local: { running: true },
    version: '1.0.0',
  }),
  updateSubscription: async () => ({ updatedAt: NOW, proxyCount: 5, message: 'ok' }),
  artifacts: {
    getFileContent: async (name: string) => `content-of-${name}`,
    getArtifactPaths: async () => ['subscription.txt', 'clash.yaml', 'raw.txt'],
    artifactExists: async () => true,
    getArtifactMtime: async () => NOW,
  } as unknown as DashboardCorePort['artifacts'],
};

const stubOps: DashboardOperationsPort = {
  getClusterStatus: async () => ok({ nodes: [] }),
  getClusterHealth: async () => ok({ healthy: true }),
  triggerClusterUpdate: async () => ok({ updated: 1 }),
  addNode: async () => ok({ id: 'n1' }),
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
};

const stubConfig: DashboardConfigPort = {
  getConfigs: () => ok({ configs: [], count: 0 }),
  updateConfigs: async () => ok({ configs: [], count: 0 }),
  getRemoteLogs: async () => ok({ lines: [] }),
};

const stubYaml: DashboardYamlPort = {
  getFullConfig: () => ok({}),
  getFrontendConfig: () => ok({}),
  generateConfig: async () => ok(true),
  validateConfig: () => ok(true),
};

const stubConvert: DashboardConvertPort = {
  convertContent: async () => ok({ clashConfig: '' }),
  diagnoseMihomo: async () => ok({ healthy: true }),
  testProtocols: async () => ok({ tests: [] }),
};

function createStubDeps(): DashboardServerDependencies {
  return { core: stubCore, operations: stubOps, config: stubConfig, yaml: stubYaml, convert: stubConvert };
}

// ── Route registrations categorised by legacy contract ──────────────

function registerCoreRoutes(r: DashboardRouteRegistry, deps: DashboardServerDependencies) {
  // GET /api/status
  r.register({
    method: 'GET', path: '/api/status',
    handler: async (req, res) => {
      const status = await deps.core.getStatus();
      res.json({ success: true, data: status, timestamp: NOW });
    },
  });

  // GET /api/update
  r.register({
    method: 'GET', path: '/api/update',
    handler: async (_req, res) => {
      const result = await deps.core.updateSubscription();
      res.json({ success: true, data: result, message: '订阅更新成功', timestamp: NOW });
    },
  });

  // GET /health
  r.register({
    method: 'GET', path: '/health',
    handler: async (_req, res) => {
      res.json({ status: 'healthy', timestamp: NOW, uptime: 0, memory: {}, version: '1.0.0' });
    },
  });

  // GET /api/file/:name
  r.register({
    method: 'GET', path: '/api/file/subscription',
    handler: async (_req, res) => {
      const content = await deps.core.artifacts.getFileContent('subscription.txt');
      res.text(content);
    },
  });
  r.register({
    method: 'GET', path: '/api/file/clash',
    handler: async (_req, res) => {
      const content = await deps.core.artifacts.getFileContent('clash.yaml');
      res.text(content);
    },
  });
  r.register({
    method: 'GET', path: '/api/file/raw',
    handler: async (_req, res) => {
      const content = await deps.core.artifacts.getFileContent('raw.txt');
      res.text(content);
    },
  });
}

function registerClusterRoutes(r: DashboardRouteRegistry, deps: DashboardServerDependencies) {
  // GET /api/cluster/status
  r.register({
    method: 'GET', path: '/api/cluster/status',
    handler: async (_req, res) => {
      const result = await deps.operations.getClusterStatus();
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });

  // GET /api/cluster/health?node=
  r.register({
    method: 'GET', path: '/api/cluster/health',
    handler: async (_req, res) => {
      const result = await deps.operations.getClusterHealth();
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });

  // GET /api/cluster/update?node=
  r.register({
    method: 'GET', path: '/api/cluster/update',
    handler: async (_req, res) => {
      const result = await deps.operations.triggerClusterUpdate();
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });

  // POST /api/cluster/nodes
  r.register({
    method: 'POST', path: '/api/cluster/nodes',
    handler: async (req, res) => {
      const result = await deps.operations.addNode(req.body);
      res.status(201).json({ success: true, data: result.data, message: '节点已添加', timestamp: NOW });
    },
  });

  // POST /api/cluster/agent/restart
  r.register({
    method: 'POST', path: '/api/cluster/agent/restart',
    handler: async (req, res) => {
      const { nodeId } = (req.body as Record<string, unknown>) || {};
      await deps.operations.restartAgent(String(nodeId));
      res.json({ success: true, message: `节点 ${nodeId} Agent 重启任务已提交`, timestamp: NOW });
    },
  });

  // POST /api/cluster/agent/start
  r.register({
    method: 'POST', path: '/api/cluster/agent/start',
    handler: async (req, res) => {
      const { nodeId } = (req.body as Record<string, unknown>) || {};
      await deps.operations.startAgent(String(nodeId));
      res.json({ success: true, message: `节点 ${nodeId} Agent 启动任务已提交`, timestamp: NOW });
    },
  });

  // POST /api/cluster/agent/stop
  r.register({
    method: 'POST', path: '/api/cluster/agent/stop',
    handler: async (req, res) => {
      const { nodeId } = (req.body as Record<string, unknown>) || {};
      await deps.operations.stopAgent(String(nodeId));
      res.json({ success: true, message: `节点 ${nodeId} Agent 停止任务已提交`, timestamp: NOW });
    },
  });

  // POST /api/cluster/agent/uninstall
  r.register({
    method: 'POST', path: '/api/cluster/agent/uninstall',
    handler: async (req, res) => {
      const { nodeId } = (req.body as Record<string, unknown>) || {};
      await deps.operations.uninstallAgent(String(nodeId));
      res.json({ success: true, message: `节点 ${nodeId} Agent 卸载任务已提交`, timestamp: NOW });
    },
  });

  // POST /api/cluster/agent/update
  r.register({
    method: 'POST', path: '/api/cluster/agent/update',
    handler: async (req, res) => {
      const { nodeId } = (req.body as Record<string, unknown>) || {};
      await deps.operations.updateAgent(String(nodeId));
      res.json({ success: true, message: `节点 ${nodeId} Agent 更新任务已提交`, timestamp: NOW });
    },
  });

  // POST /api/cluster/deploy
  r.register({
    method: 'POST', path: '/api/cluster/deploy',
    handler: async (req, res) => {
      const { nodeId, kernels } = (req.body as Record<string, unknown>) || {};
      if (!nodeId) {
        res.status(400).json({ success: false, error: '缺少 nodeId', timestamp: NOW });
        return;
      }
      const result = await deps.operations.deployToNode(String(nodeId), kernels);
      res.status(202).json({ success: true, message: '部署已启动', timestamp: NOW });
    },
  });

  // GET /api/cluster/deploy/progress?node=
  r.register({
    method: 'GET', path: '/api/cluster/deploy/progress',
    handler: async (req, res) => {
      const nodeId = typeof req.query?.node === 'string' ? req.query.node : '';
      const result = await deps.operations.getDeployProgress(nodeId);
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });

  // GET /api/cluster/deploy/status?nodes=
  r.register({
    method: 'GET', path: '/api/cluster/deploy/status',
    handler: async (req, res) => {
      const nodesParam = typeof req.query?.nodes === 'string' ? req.query.nodes : '';
      const nodeIds = nodesParam ? nodesParam.split(',').map(s => s.trim()) : undefined;
      const result = await deps.operations.getAllDeployStatuses(nodeIds);
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });

  // POST /api/cluster/kernel/detect
  r.register({
    method: 'POST', path: '/api/cluster/kernel/detect',
    handler: async (req, res) => {
      const result = await deps.operations.detectKernels(req.body);
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });

  // POST /api/cluster/kernel/install
  r.register({
    method: 'POST', path: '/api/cluster/kernel/install',
    handler: async (req, res) => {
      const { kernelType } = (req.body as Record<string, unknown>) || {};
      const result = await deps.operations.installKernel(String(kernelType));
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });

  // POST /api/cluster/kernel/uninstall
  r.register({
    method: 'POST', path: '/api/cluster/kernel/uninstall',
    handler: async (req, res) => {
      const { nodeId, kernelType } = (req.body as Record<string, unknown>) || {};
      const result = await deps.operations.uninstallKernel(String(nodeId), String(kernelType));
      res.json({ success: true, data: result.data, timestamp: NOW });
    },
  });
}

function registerConfigRoutes(r: DashboardRouteRegistry, deps: DashboardServerDependencies) {
  // GET /api/configs
  r.register({
    method: 'GET', path: '/api/configs',
    handler: async (_req, res) => {
      const result = deps.config.getConfigs();
      res.json(result);
    },
  });

  // POST /api/configs
  r.register({
    method: 'POST', path: '/api/configs',
    handler: async (req, res) => {
      const { configs } = (req.body as Record<string, unknown>) || {};
      if (!Array.isArray(configs)) {
        res.status(400).json({ success: false, error: '请提供有效的configs数组', timestamp: NOW });
        return;
      }
      const result = await deps.config.updateConfigs(configs as string[]);
      res.json(result);
    },
  });

  // GET /api/logs?node=&file=&level=&q=
  r.register({
    method: 'GET', path: '/api/logs',
    handler: async (req, res) => {
      const nodeId = typeof req.query?.node === 'string' ? req.query.node : '';
      if (!nodeId) {
        res.status(400).json({ success: false, error: '请选择一个子节点查看日志', timestamp: NOW });
        return;
      }
      const result = await deps.config.getRemoteLogs(nodeId, {
        file: typeof req.query?.file === 'string' ? req.query.file : undefined,
        level: typeof req.query?.level === 'string' ? req.query.level : undefined,
        query: typeof req.query?.q === 'string' ? req.query.q : undefined,
      });
      res.json(result);
    },
  });
}

function registerYamlRoutes(r: DashboardRouteRegistry, deps: DashboardServerDependencies) {
  r.register({ method: 'GET', path: '/api/yaml/config', handler: (_req, res) => { res.json(deps.yaml.getFullConfig()); } });
  r.register({ method: 'GET', path: '/api/yaml/frontend', handler: (_req, res) => { res.json(deps.yaml.getFrontendConfig()); } });
  r.register({
    method: 'POST', path: '/api/yaml/generate',
    handler: async (req, res) => {
      const { templatePath, outputPath } = (req.body as Record<string, unknown>) || {};
      if (!templatePath || typeof templatePath !== 'string') {
        res.status(400).json({ success: false, message: '请提供模板文件路径 (templatePath)' });
        return;
      }
      const result = await deps.yaml.generateConfig(templatePath, typeof outputPath === 'string' ? outputPath : undefined);
      res.json(result);
    },
  });
  r.register({ method: 'GET', path: '/api/yaml/validate', handler: (_req, res) => { res.json(deps.yaml.validateConfig()); } });
}

function registerConvertRoutes(r: DashboardRouteRegistry, deps: DashboardServerDependencies) {
  r.register({
    method: 'POST', path: '/api/convert',
    handler: async (req, res) => {
      const { content } = (req.body as Record<string, unknown>) || {};
      if (!content || typeof content !== 'string') {
        res.status(400).json({ success: false, error: '请提供有效的订阅内容', timestamp: NOW });
        return;
      }
      const result = await deps.convert.convertContent(content);
      res.json(result);
    },
  });
  r.register({ method: 'GET', path: '/api/diagnose/mihomo', handler: async (_req, res) => {
    const result = await deps.convert.diagnoseMihomo();
    res.json(result);
  } });
  r.register({ method: 'GET', path: '/api/test/protocols', handler: async (_req, res) => {
    const result = await deps.convert.testProtocols();
    res.json(result);
  } });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('HTTP contract golden tests', () => {
  function buildComposition() {
    const composition = createDashboardServerComposition(createStubDeps());
    composition.registerRoutes((registry, deps) => {
      registerCoreRoutes(registry, deps);
      registerClusterRoutes(registry, deps);
      registerConfigRoutes(registry, deps);
      registerYamlRoutes(registry, deps);
      registerConvertRoutes(registry, deps);
    });
    return composition;
  }

  async function dispatch(method: string, path: string, body?: unknown, query?: Record<string, string>) {
    const comp = buildComposition();
    const req = createDashboardTestRequest({ method, path, body, query });
    const res = createDashboardTestResponse();
    const handled = await comp.routes.dispatch(req, res);
    return { handled, res };
  }

  describe('core / status', () => {
    it('GET /api/status returns 200', async () => {
      const { handled, res } = await dispatch('GET', '/api/status');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('GET /api/update returns 200', async () => {
      const { handled, res } = await dispatch('GET', '/api/update');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('订阅更新成功');
    });

    it('GET /health returns 200', async () => {
      const { handled, res } = await dispatch('GET', '/health');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('healthy');
    });
  });

  describe('artifacts (file/*)', () => {
    it('GET /api/file/subscription returns text', async () => {
      const { handled, res } = await dispatch('GET', '/api/file/subscription');
      expect(handled).toBe(true);
      expect(res.body).toBe('content-of-subscription.txt');
    });

    it('GET /api/file/clash returns text', async () => {
      const { handled, res } = await dispatch('GET', '/api/file/clash');
      expect(handled).toBe(true);
      expect(res.body).toBe('content-of-clash.yaml');
    });

    it('GET /api/file/raw returns text', async () => {
      const { handled, res } = await dispatch('GET', '/api/file/raw');
      expect(handled).toBe(true);
      expect(res.body).toBe('content-of-raw.txt');
    });
  });

  describe('cluster', () => {
    it('GET /api/cluster/status returns 200', async () => {
      const { handled, res } = await dispatch('GET', '/api/cluster/status');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it('POST /api/cluster/nodes returns 201', async () => {
      const { handled, res } = await dispatch('POST', '/api/cluster/nodes', { name: 'n1', host: '10.0.0.1' });
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(201);
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

    it('agent lifecycle routes all return 200', async () => {
      for (const action of ['restart', 'start', 'stop', 'uninstall', 'update']) {
        const { handled, res } = await dispatch('POST', `/api/cluster/agent/${action}`, { nodeId: 'n1' });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('config', () => {
    it('GET /api/configs returns 200', async () => {
      const { handled, res } = await dispatch('GET', '/api/configs');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it('POST /api/configs with invalid body returns 400', async () => {
      const { handled, res } = await dispatch('POST', '/api/configs', { configs: 'not-array' });
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(400);
    });

    it('GET /api/logs without node returns 400', async () => {
      const { handled, res } = await dispatch('GET', '/api/logs');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('yaml', () => {
    it('GET /api/yaml/config returns 200', async () => {
      const { handled, res } = await dispatch('GET', '/api/yaml/config');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it('POST /api/yaml/generate without templatePath returns 400', async () => {
      const { handled, res } = await dispatch('POST', '/api/yaml/generate', {});
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('convert', () => {
    it('POST /api/convert without content returns 400', async () => {
      const { handled, res } = await dispatch('POST', '/api/convert', {});
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(400);
    });

    it('GET /api/diagnose/mihomo returns 200', async () => {
      const { handled, res } = await dispatch('GET', '/api/diagnose/mihomo');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('method enforcement', () => {
    it('POST /api/cluster/nodes rejects GET', async () => {
      // The route is registered as POST, so GET won't match
      const { handled } = await dispatch('GET', '/api/cluster/nodes');
      expect(handled).toBe(false);
    });
  });

  describe('composition seam', () => {
    it('creates server composition without Next/frontend-server imports', () => {
      const composition = createDashboardServerComposition(createStubDeps());
      expect(composition.routes).toBeDefined();
      expect(composition.core).toBeDefined();
      expect(composition.operations).toBeDefined();
      expect(composition.config).toBeDefined();
      expect(composition.yaml).toBeDefined();
      expect(composition.convert).toBeDefined();
    });

    it('registerRoutes calls the registration function', () => {
      let called = false;
      const composition = createDashboardServerComposition(createStubDeps());
      composition.registerRoutes(() => { called = true; });
      expect(called).toBe(true);
    });
  });
});
