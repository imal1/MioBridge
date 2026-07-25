/**
 * Boots the real dashboard Fastify instance in-process. Requests go through
 * `app.inject()`, so routing, body parsing, and the error envelope are the
 * production code paths — only the dependency ports are stubbed.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDashboardApp,
  type DashboardServerDependencies,
  type OperationsResult,
} from '@miobridge/cli';

const NOW = () => new Date().toISOString();

/**
 * Every port method resolves to an empty success result. Routes under test are
 * asserted on their HTTP contract, not on port behaviour, so a single Proxy
 * beats ~40 hand-written stubs.
 */
function successPort<T extends object>(): T {
  return new Proxy({}, {
    get: () => async (): Promise<OperationsResult> => ({ success: true, data: {}, timestamp: NOW() }),
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

export function createTestApp(): ReturnType<typeof createDashboardApp> {
  return createDashboardApp({
    // A missing root makes serveStatic fall through to 404 without touching disk
    // contents, keeping the suite independent of any frontend build.
    root: join(tmpdir(), 'miobridge-integration-no-static'),
    reservedPaths: [...RESERVED_PATHS],
    fallbackToIndex: false,
    dependencies: stubDependencies(),
    logger: false,
  });
}
