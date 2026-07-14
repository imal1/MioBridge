import type { DashboardRouteRegistrar, DashboardServerDependencies } from './composition.js';
import type { DashboardRequest, DashboardResponse } from './http.js';

const NOW = () => new Date().toISOString();

/**
 * Register all cluster operations, agent lifecycle, deployment, and kernel
 * management routes.  Each handler delegates to the injected operations port,
 * keeping the HTTP layer thin.
 */
export function registerOperationsRoutes(
  registrar: DashboardRouteRegistrar,
  deps: DashboardServerDependencies,
): void {
  const ops = deps.operations;

  // GET /api/cluster/status
  registrar.register({
    method: 'GET',
    path: '/api/cluster/status',
    handler: async (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = await ops.getClusterStatus();
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // GET /api/cluster/health?node=
  registrar.register({
    method: 'GET',
    path: '/api/cluster/health',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const nodeId = typeof req.query?.node === 'string' ? req.query.node : undefined;
        const result = await ops.getClusterHealth(nodeId);
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // POST /api/cluster/update?node=
  registrar.register({
    method: 'POST',
    path: '/api/cluster/update',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const nodeId = typeof req.query?.node === 'string' ? req.query.node : undefined;
        const result = await ops.triggerClusterUpdate(nodeId);
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // PUT /api/cluster/nodes
  registrar.register({
    method: 'PUT',
    path: '/api/cluster/nodes',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const { nodeId, kernels } = (req.body as Record<string, unknown>) || {};
        if (typeof nodeId !== 'string' || !nodeId) {
          res.status(400).json({ success: false, error: '缺少 nodeId', timestamp: NOW() });
          return;
        }
        const result = await ops.updateNodeKernels(nodeId, kernels);
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // POST /api/cluster/nodes
  registrar.register({
    method: 'POST',
    path: '/api/cluster/nodes',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = await ops.addNode(req.body);
        if (result.statusCode) {
          res.status(result.statusCode);
        } else {
          res.status(201);
        }
        res.json({ success: true, data: result.data, message: '节点已添加', timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // ── Agent lifecycle ────────────────────────────────────────────────

  const agentActions: Array<{
    method: 'restartAgent' | 'startAgent' | 'stopAgent' | 'uninstallAgent' | 'updateAgent';
    path: string;
    label: string;
  }> = [
    { method: 'restartAgent', path: '/api/cluster/agent/restart', label: '重启' },
    { method: 'startAgent', path: '/api/cluster/agent/start', label: '启动' },
    { method: 'stopAgent', path: '/api/cluster/agent/stop', label: '停止' },
    { method: 'uninstallAgent', path: '/api/cluster/agent/uninstall', label: '卸载' },
    { method: 'updateAgent', path: '/api/cluster/agent/update', label: '更新' },
  ];

  for (const { method, path, label } of agentActions) {
    registrar.register({
      method: 'POST',
      path,
      handler: async (req: DashboardRequest, res: DashboardResponse) => {
        try {
          const { nodeId } = (req.body as Record<string, unknown>) || {};
          if (typeof nodeId !== 'string' || !nodeId) {
            res.status(400).json({ success: false, error: '缺少 nodeId', timestamp: NOW() });
            return;
          }
          await ops[method](nodeId);
          res.json({ success: true, message: `节点 ${nodeId} Agent ${label}任务已提交`, timestamp: NOW() });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          res.status(500).json({ success: false, error: msg, timestamp: NOW() });
        }
      },
    });
  }

  // ── Deploy ─────────────────────────────────────────────────────────

  // POST /api/cluster/deploy
  registrar.register({
    method: 'POST',
    path: '/api/cluster/deploy',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const { nodeId, kernels } = (req.body as Record<string, unknown>) || {};
        if (!nodeId) {
          res.status(400).json({ success: false, error: '缺少 nodeId', timestamp: NOW() });
          return;
        }
        const result = await ops.deployToNode(String(nodeId), kernels);
        res.status(202).json({ success: true, data: result.data, message: '部署已启动', timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // GET /api/cluster/deploy/progress?node=
  registrar.register({
    method: 'GET',
    path: '/api/cluster/deploy/progress',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const nodeId = typeof req.query?.node === 'string' ? req.query.node : '';
        const result = await ops.getDeployProgress(nodeId);
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // GET /api/cluster/deploy/status?nodes=
  registrar.register({
    method: 'GET',
    path: '/api/cluster/deploy/status',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const nodesParam = typeof req.query?.nodes === 'string' ? req.query.nodes : '';
        const nodeIds = nodesParam ? nodesParam.split(',').map(s => s.trim()) : undefined;
        const result = await ops.getAllDeployStatuses(nodeIds);
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // ── Kernel ─────────────────────────────────────────────────────────

  // POST /api/cluster/kernel/detect
  registrar.register({
    method: 'POST',
    path: '/api/cluster/kernel/detect',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = await ops.detectKernels(req.body);
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // POST /api/cluster/kernel/install
  registrar.register({
    method: 'POST',
    path: '/api/cluster/kernel/install',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const { nodeId, kernelType } = (req.body as Record<string, unknown>) || {};
        if (!nodeId || !kernelType) {
          res.status(400).json({ success: false, error: '缺少 nodeId 或 kernelType', timestamp: NOW() });
          return;
        }
        const result = await ops.installKernel(String(nodeId), String(kernelType));
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // POST /api/cluster/kernel/uninstall
  registrar.register({
    method: 'POST',
    path: '/api/cluster/kernel/uninstall',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const { nodeId, kernelType } = (req.body as Record<string, unknown>) || {};
        const result = await ops.uninstallKernel(String(nodeId), String(kernelType));
        res.json({ success: true, data: result.data, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });
}
