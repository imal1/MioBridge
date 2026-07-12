import type { DashboardRouteRegistrar, DashboardServerDependencies } from './composition.js';
import type { DashboardRequest, DashboardResponse } from './http.js';
import { createSseConnection } from './sse.js';

const SSE_INTERVAL_MS = 30_000;

/**
 * Register the cluster event stream (SSE) route.
 */
export function registerSseRoutes(
  registrar: DashboardRouteRegistrar,
  deps: DashboardServerDependencies,
): void {
  registrar.register({
    method: 'GET',
    path: '/api/cluster/events',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      const sse = createSseConnection(res);

      // Send initial heartbeat
      sse.heartbeat();

      // Send initial cluster status
      try {
        const result = await deps.operations.getClusterStatus();
        sse.send(result.data);
      } catch {
        sse.send({ error: '获取集群状态失败' });
      }

      // Periodic updates
      const interval = setInterval(async () => {
        try {
          const result = await deps.operations.getClusterStatus();
          sse.send(result.data);
        } catch {
          sse.heartbeat();
        }
      }, SSE_INTERVAL_MS);

      // Cleanup on disconnect
      req.onClose(() => {
        clearInterval(interval);
        sse.close();
      });
    },
  });
}
