import type { DashboardRouteRegistrar, DashboardServerDependencies } from './composition.js';
import type { DashboardRequest, DashboardResponse } from './http.js';

const NOW = () => new Date().toISOString();

/**
 * Register config, logs, YAML, convert, and diagnose routes.
 */
export function registerConfigRoutes(
  registrar: DashboardRouteRegistrar,
  deps: DashboardServerDependencies,
): void {
  // ── Configs ────────────────────────────────────────────────────────

  // GET /api/configs
  registrar.register({
    method: 'GET',
    path: '/api/configs',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      const result = deps.config.getConfigs();
      res.json(result);
    },
  });

  // POST /api/configs
  registrar.register({
    method: 'POST',
    path: '/api/configs',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const { configs } = (req.body as Record<string, unknown>) || {};
        if (!Array.isArray(configs)) {
          res.status(400).json({ success: false, error: '请提供有效的configs数组', timestamp: NOW() });
          return;
        }
        if (configs.length === 0) {
          res.status(400).json({ success: false, error: '配置列表不能为空', timestamp: NOW() });
          return;
        }
        const result = await deps.config.updateConfigs(configs as string[]);
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // ── Logs ───────────────────────────────────────────────────────────

  // GET /api/logs?node=&file=&level=&q=
  registrar.register({
    method: 'GET',
    path: '/api/logs',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const nodeId = typeof req.query?.node === 'string' ? req.query.node.trim() : '';
        if (!nodeId) {
          res.status(400).json({ success: false, error: '请选择一个子节点查看日志', timestamp: NOW() });
          return;
        }
        const result = await deps.config.getRemoteLogs(nodeId, {
          file: typeof req.query?.file === 'string' ? req.query.file : undefined,
          level: typeof req.query?.level === 'string' ? req.query.level : undefined,
          query: typeof req.query?.q === 'string' ? req.query.q : undefined,
        });
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(502).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // ── YAML ───────────────────────────────────────────────────────────

  // GET /api/yaml/config
  registrar.register({
    method: 'GET',
    path: '/api/yaml/config',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = deps.yaml.getFullConfig();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });

  // GET /api/yaml/frontend
  registrar.register({
    method: 'GET',
    path: '/api/yaml/frontend',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = deps.yaml.getFrontendConfig();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });

  // POST /api/yaml/generate
  registrar.register({
    method: 'POST',
    path: '/api/yaml/generate',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      const { templatePath, outputPath } = (req.body as Record<string, unknown>) || {};
      if (!templatePath || typeof templatePath !== 'string') {
        res.status(400).json({ success: false, message: '请提供模板文件路径 (templatePath)' });
        return;
      }
      try {
        const result = await deps.yaml.generateConfig(templatePath, typeof outputPath === 'string' ? outputPath : undefined);
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });

  // GET /api/yaml/validate
  registrar.register({
    method: 'GET',
    path: '/api/yaml/validate',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = deps.yaml.validateConfig();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });
}
