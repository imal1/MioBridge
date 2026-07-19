import type { DashboardRouteRegistrar, DashboardServerDependencies } from './composition.js';
import { contentDisposition, type DashboardRequest, type DashboardResponse } from './http.js';

const NOW = () => new Date().toISOString();

/**
 * Register core status, update, health, and artifact-file routes.
 * Method/status/body/header contracts implement the stable dashboard API.
 */
export function registerCoreRoutes(
  registrar: DashboardRouteRegistrar,
  deps: DashboardServerDependencies,
): void {
  // GET /api/status
  registrar.register({
    method: 'GET',
    path: '/api/status',
    handler: async (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const status = await deps.core.getStatus();
        res.json({ success: true, data: status, timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // GET /api/update
  registrar.register({
    method: 'GET',
    path: '/api/update',
    handler: async (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = await deps.core.updateSubscription();
        res.json({ success: true, data: result, message: '订阅更新成功', timestamp: NOW() });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // GET /health
  registrar.register({
    method: 'GET',
    path: '/health',
    handler: async (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const status = await deps.core.getStatus();
        res.json({
          status: 'healthy',
          timestamp: NOW(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: status.version,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(503).json({ status: 'unhealthy', error: msg, timestamp: NOW() });
      }
    },
  });

  // ── Artifact file routes (compatibility URLs) ──────────────────────

  const FILE_MAP: Record<string, { filename: string; contentType: string }> = {
    subscription: { filename: 'subscription.txt', contentType: 'text/plain; charset=utf-8' },
    clash: { filename: 'clash.yaml', contentType: 'text/yaml; charset=utf-8' },
    raw: { filename: 'raw.txt', contentType: 'text/plain; charset=utf-8' },
  };

  for (const [name, entry] of Object.entries(FILE_MAP)) {
    registrar.register({
      method: 'GET',
      path: `/api/file/${name}`,
      handler: async (req: DashboardRequest, res: DashboardResponse) => {
        try {
          const content = String(await deps.core.artifacts.getFileContent(entry.filename));
          res.header('Content-Type', entry.contentType);
          res.header('Content-Disposition', contentDisposition(req.query, entry.filename));
          res.text(content);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          if (name === 'raw') {
            res.status(404).json({
              success: false,
              error: `获取原始链接失败: ${msg}`,
              message: '请确保 raw.txt 文件存在于数据目录中',
              timestamp: NOW(),
            });
          } else {
            res.status(404).text(`获取文件失败: ${msg}`);
          }
        }
      },
    });
  }
}
