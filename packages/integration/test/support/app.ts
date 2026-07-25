/**
 * Boots the real dashboard Fastify instance in-process. Requests go through
 * `app.inject()`, so routing, body parsing, and the error envelope are the
 * production code paths — only the dependency ports are stubbed.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Imported from source rather than the built package so coverage attributes to
// packages/cli/src, matching how the CLI's own unit tests import it.
import { createDashboardApp } from '../../../cli/src/dashboard/server/nodeServer.js';
import type { DashboardRouteRegistry } from '../../../cli/src/dashboard/server/http.js';
import type {
  DashboardServerDependencies,
  OperationsResult,
} from '../../../cli/src/dashboard/server/composition.js';

const NOW = () => new Date().toISOString();

/**
 * Every port method returns an empty success result. Routes under test are
 * asserted on their HTTP contract, not on port behaviour, so a single Proxy
 * beats ~40 hand-written stubs.
 *
 * The stub is deliberately synchronous: parts of these ports are declared sync
 * and their routes call them without `await` (`deps.config.getConfigs()`,
 * `deps.yaml.getFullConfig()`), so an async stub would hand those routes a
 * Promise that serialises to `{}`. Returning a plain object is correct for both
 * kinds of call site, since `await` on a non-Promise yields the value itself.
 */
function successPort<T extends object>(): T {
  return new Proxy({}, {
    get: () => (): OperationsResult => ({ success: true, data: {}, timestamp: NOW() }),
  }) as T;
}

function stubDependencies(): DashboardServerDependencies {
  const state = new Map<string, string>();
  return {
    core: {
      getStatus: async () => ({
        subscriptionExists: true, clashExists: true, rawExists: true, mihomoAvailable: true,
        uptime: 1, version: '0.0.0-test', nodesCount: 0,
      }),
      updateSubscription: async () => ({ success: true, nodesCount: 0, errors: [] }),
      preflightSubscription: async () => ({ ok: true, issues: [] }),
      artifacts: { getFileContent: async () => 'artifact-body' },
      config: { getSchema: () => [] },
      state: {
        get: async (key: string) => state.get(key) ?? null,
        set: async (key: string, value: string) => { state.set(key, value); },
        listKeys: async () => [...state.keys()],
      },
      getConfigPath: () => join(tmpdir(), 'miobridge-integration', 'config.yaml'),
      getEffectiveConfig: () => ({}),
      getConfigValue: () => undefined,
      setConfigValue: async () => ({ applied: true, restarted: false }),
      setConfigValues: async () => ({ applied: true, restarted: false }),
      restoreLastGoodConfig: async () => ({ restored: true }),
      validateConfig: () => ({ valid: true, issues: [] }),
      getLocalLogs: async () => ({ entries: [], total: 0 }),
      getMetricsSnapshot: async () => ({
        timestamp: NOW(), version: '0.0.0-test', uptime: 1,
        enabledNodes: 0, onlineNodes: 0, sources: 0, proxies: 0, mihomoAvailable: true,
        artifacts: { raw: { exists: false }, subscription: { exists: false }, clash: { exists: false } },
      }),
    } as unknown as DashboardServerDependencies['core'],
    operations: successPort(),
    config: successPort(),
    yaml: successPort(),
    convert: successPort(),
    subscription: successPort(),
  };
}

export const RESERVED_PATHS = ['/api', '/health', '/subscription.txt', '/clash.yaml', '/raw.txt'] as const;

export interface RegisteredRoute { readonly method: string; readonly path: string }

/**
 * Captures what the registry actually holds. `extendRoutes` runs after every
 * route group has registered, so the registrar handed to it already carries the
 * full table — which is how the suite checks the hand-maintained OpenAPI
 * document in the *other* direction: registered but undocumented.
 */
export function createTestApp(): {
  app: ReturnType<typeof createDashboardApp>;
  registered: readonly RegisteredRoute[];
} {
  const registered: RegisteredRoute[] = [];
  const app = createDashboardApp({
    extendRoutes: registrar => {
      // The registrar port only declares register(); the server always passes the
      // concrete registry, which can also enumerate what it holds.
      for (const route of (registrar as DashboardRouteRegistry).routes()) {
        registered.push({ method: route.method, path: route.path });
      }
    },
    // A missing root makes serveStatic fall through to 404 without touching disk
    // contents, keeping the suite independent of any frontend build.
    root: join(tmpdir(), 'miobridge-integration-no-static'),
    reservedPaths: [...RESERVED_PATHS],
    fallbackToIndex: false,
    dependencies: stubDependencies(),
    logger: false,
  });
  return { app, registered };
}
