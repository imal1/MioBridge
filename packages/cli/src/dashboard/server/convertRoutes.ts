import type { DashboardRouteRegistrar, DashboardServerDependencies } from './composition.js';
import type { DashboardRequest, DashboardResponse } from './http.js';

const NOW = () => new Date().toISOString();

/**
 * Register content conversion, mihomo diagnose, and protocol test routes.
 */
export function registerConvertRoutes(
  registrar: DashboardRouteRegistrar,
  deps: DashboardServerDependencies,
): void {
  // POST /api/convert
  registrar.register({
    method: 'POST',
    path: '/api/convert',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const { content } = (req.body as Record<string, unknown>) || {};
        if (!content || typeof content !== 'string') {
          res.status(400).json({ success: false, error: '请提供有效的订阅内容', timestamp: NOW() });
          return;
        }
        const result = await deps.convert.convertContent(content);
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: `转换失败: ${msg}`, timestamp: NOW() });
      }
    },
  });

  // GET /api/diagnose/mihomo
  registrar.register({
    method: 'GET',
    path: '/api/diagnose/mihomo',
    handler: async (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = await deps.convert.diagnoseMihomo();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // GET /api/test/protocols
  registrar.register({
    method: 'GET',
    path: '/api/test/protocols',
    handler: async (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = await deps.convert.testProtocols();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });
}
