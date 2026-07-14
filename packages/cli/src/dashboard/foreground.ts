import { join } from 'node:path';
import type { RuntimePaths } from '@miobridge/core';
import { DASHBOARD_MANIFEST_NAME, loadDashboardProvider, type LoadedDashboardProvider } from './provider.js';
import { runNodeDashboardServer } from './server/nodeServer.js';
import { createNodeDashboardDependencies } from './server/nodeDependencies.js';
import type { NodeCoreComposition } from '../composition.js';

export interface ForegroundOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface ForegroundAdapters {
  serve(input: {
    readonly host: string;
    readonly port: number;
    readonly provider: LoadedDashboardProvider;
  }): Promise<number>;
}

export interface ForegroundResult {
  readonly exitCode: number;
  readonly healthUrl: string;
  readonly provider: LoadedDashboardProvider;
}

export function dashboardManifestPath(paths: Pick<RuntimePaths, 'distDir'>): string {
  return join(paths.distDir, 'dashboard', DASHBOARD_MANIFEST_NAME);
}

export class DashboardForegroundService {
  constructor(
    private readonly paths: Pick<RuntimePaths, 'distDir'>,
    private readonly adapters: ForegroundAdapters,
  ) {}

  async run(options: ForegroundOptions = {}): Promise<ForegroundResult> {
    const host = options.host ?? '0.0.0.0';
    const port = options.port ?? 3000;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid dashboard port: ${port}`);
    const provider = await loadDashboardProvider(dashboardManifestPath(this.paths));
    const exitCode = await this.adapters.serve({ host, port, provider });
    return { exitCode, healthUrl: `http://${host}:${port}/health`, provider };
  }
}

export function createNodeForegroundAdapters(composition: NodeCoreComposition): ForegroundAdapters {
  return {
    serve({ host, port, provider }) {
      return runNodeDashboardServer({
        host,
        port,
        root: provider.root,
        reservedPaths: provider.manifest.reservedPaths,
        fallbackToIndex: provider.manifest.spaFallback ?? true,
        dependencies: createNodeDashboardDependencies(composition),
      });
    },
  };
}
