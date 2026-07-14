import type { MioBridgeCore } from '@miobridge/core';
import { DashboardRouteRegistry, type DashboardRouteRegistrar } from './http.js';

export type { DashboardRouteRegistrar } from './http.js';

/** Public core surface available to dashboard HTTP routes. */
export type DashboardCorePort = Pick<
  MioBridgeCore,
  'getStatus' | 'updateSubscription' | 'artifacts'
>;

/**
 * Response shape for every operations port method.  All methods return
 * `Promise<OperationsResult<T>>` so route handlers never need to know
 * whether the underlying adapters hit the network, read local state, or
 * delegate to a child process.
 */
export interface OperationsResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly statusCode?: number;
  readonly timestamp: string;
}

// ── Cluster ────────────────────────────────────────────────────────

export interface DashboardOperationsPort {
  readonly getClusterStatus: () => Promise<OperationsResult>;
  readonly getClusterHealth: (nodeId?: string) => Promise<OperationsResult>;
  readonly triggerClusterUpdate: (nodeId?: string) => Promise<OperationsResult>;
  readonly addNode: (body: unknown) => Promise<OperationsResult>;
  readonly updateNodeKernels: (nodeId: string, kernels: unknown) => Promise<OperationsResult>;
  readonly restartAgent: (nodeId: string) => Promise<OperationsResult>;
  readonly startAgent: (nodeId: string) => Promise<OperationsResult>;
  readonly stopAgent: (nodeId: string) => Promise<OperationsResult>;
  readonly uninstallAgent: (nodeId: string) => Promise<OperationsResult>;
  readonly updateAgent: (nodeId: string) => Promise<OperationsResult>;
  readonly deployToNode: (nodeId: string, kernels?: unknown) => Promise<OperationsResult>;
  readonly getDeployProgress: (nodeId: string) => Promise<OperationsResult>;
  readonly getAllDeployStatuses: (nodeIds?: string[]) => Promise<OperationsResult>;
  readonly detectKernels: (body: unknown) => Promise<OperationsResult>;
  readonly installKernel: (nodeId: string, kernelType: string) => Promise<OperationsResult>;
  readonly uninstallKernel: (nodeId: string, kernelType: string) => Promise<OperationsResult>;
}

// ── Config + logs ───────────────────────────────────────────────────

export interface DashboardConfigPort {
  readonly getConfigs: () => OperationsResult;
  readonly updateConfigs: (configs: string[]) => Promise<OperationsResult>;
  readonly getRemoteLogs: (nodeId: string, filters?: LogFilters) => Promise<OperationsResult>;
}

export interface LogFilters {
  readonly file?: string | undefined;
  readonly level?: string | undefined;
  readonly query?: string | undefined;
}

// ── YAML ────────────────────────────────────────────────────────────

export interface DashboardYamlPort {
  readonly getFullConfig: () => OperationsResult;
  readonly getFrontendConfig: () => OperationsResult;
  readonly generateConfig: (templatePath: string, outputPath?: string) => Promise<OperationsResult>;
  readonly validateConfig: () => OperationsResult;
}

// ── Convert + diagnose ──────────────────────────────────────────────

export interface DashboardConvertPort {
  readonly convertContent: (content: string) => Promise<OperationsResult>;
  readonly diagnoseMihomo: () => Promise<OperationsResult>;
  readonly testProtocols: () => Promise<OperationsResult>;
}

// ── Composition ─────────────────────────────────────────────────────

export interface DashboardServerDependencies {
  readonly core: DashboardCorePort;
  readonly operations: DashboardOperationsPort;
  readonly config: DashboardConfigPort;
  readonly yaml: DashboardYamlPort;
  readonly convert: DashboardConvertPort;
}

export interface DashboardServerComposition extends DashboardServerDependencies {
  readonly routes: DashboardRouteRegistry;
  registerRoutes(
    register: (registrar: DashboardRouteRegistrar, dependencies: DashboardServerDependencies) => void,
  ): void;
}

/**
 * CLI-owned server seam. No browser-package services or hidden globals may
 * cross this boundary; route ports register through it.
 */
export function createDashboardServerComposition(
  dependencies: DashboardServerDependencies,
): DashboardServerComposition {
  const routes = new DashboardRouteRegistry();
  return {
    ...dependencies,
    routes,
    registerRoutes(register) {
      register(routes, dependencies);
    },
  };
}
