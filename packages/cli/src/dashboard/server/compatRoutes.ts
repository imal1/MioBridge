import type { DashboardRouteRegistrar, DashboardServerDependencies } from './composition.js';

/**
 * Compatibility URL routes that mirror Next.js rewrites.
 * These must be registered before any static/history fallback so they
 * are never intercepted by the SPA catch-all.
 */
export function registerCompatRoutes(
  registrar: DashboardRouteRegistrar,
  deps: DashboardServerDependencies,
): void {
  const COMPAT_PATHS: Array<{ path: string; filename: string; contentType: string }> = [
    { path: '/subscription.txt', filename: 'subscription.txt', contentType: 'text/plain; charset=utf-8' },
    { path: '/clash.yaml', filename: 'clash.yaml', contentType: 'text/yaml; charset=utf-8' },
    { path: '/raw.txt', filename: 'raw.txt', contentType: 'text/plain; charset=utf-8' },
  ];

  for (const entry of COMPAT_PATHS) {
    registrar.register({
      method: 'GET',
      path: entry.path,
      handler: async (_req, res) => {
        try {
          const content = String(await deps.core.artifacts.getFileContent(entry.filename));
          res.header('Content-Type', entry.contentType);
          res.header('Content-Disposition', `attachment; filename="${entry.filename}"`);
          res.text(content);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          res.status(404).text(`获取文件失败: ${msg}`);
        }
      },
    });
  }
}
