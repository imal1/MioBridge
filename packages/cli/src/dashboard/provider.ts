import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const DASHBOARD_PROVIDER_SCHEMA_VERSION = 2 as const;
export const DASHBOARD_MANIFEST_NAME = 'provider.json' as const;

export interface DashboardProviderManifest {
  readonly schemaVersion: 2;
  readonly dashboardVersion: string;
  /** Relative path to the Vite `dist` directory. */
  readonly artifactRoot: string;
  /** SPA history fallback enabled (default true). */
  readonly spaFallback?: boolean;
  /** Reserved paths that must never be served as static files. */
  readonly reservedPaths: readonly string[];
}

export interface LoadedDashboardProvider {
  readonly manifestPath: string;
  readonly root: string;
  readonly manifest: DashboardProviderManifest;
}

const COMPATIBILITY_PATHS = ['/health', '/subscription.txt', '/clash.yaml', '/raw.txt'] as const;

// ── Validation ──────────────────────────────────────────────────────

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${name} must be an array of strings`);
  return value;
}

function assertRelativePath(value: string, name: string): void {
  if (isAbsolute(value) || value.split(/[\\/]/u).includes('..')) throw new Error(`${name} must stay inside the provider root`);
}

function validateManifest(value: Record<string, unknown>): DashboardProviderManifest {
  if (value.schemaVersion !== 2) throw new Error(`Unsupported dashboard provider schema: ${String(value.schemaVersion)}`);
  const artifactRoot = string(value.artifactRoot, 'artifactRoot');
  assertRelativePath(artifactRoot, 'artifactRoot');

  return Object.freeze({
    schemaVersion: 2 as const,
    dashboardVersion: string(value.dashboardVersion, 'dashboardVersion'),
    artifactRoot,
    ...(typeof value.spaFallback === 'boolean' ? { spaFallback: value.spaFallback } : {}),
    reservedPaths: Object.freeze([...new Set([
      ...stringArray(value.reservedPaths ?? [], 'reservedPaths'),
      ...COMPATIBILITY_PATHS,
      '/api',
    ])]),
  });
}

export function validateDashboardProviderManifest(value: unknown): DashboardProviderManifest {
  const input = object(value, 'Dashboard provider manifest');
  return validateManifest(input);
}

// ── Loading ─────────────────────────────────────────────────────────

function contained(base: string, candidate: string): boolean {
  const path = relative(base, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export async function loadDashboardProvider(manifestPath: string): Promise<LoadedDashboardProvider> {
  let source: string;
  try { source = await readFile(manifestPath, 'utf8'); } catch (error) {
    throw new Error(`Dashboard provider is not installed (${manifestPath}). Install a dashboard provider first.`, { cause: error });
  }
  let json: unknown;
  try { json = JSON.parse(source); } catch (error) { throw new Error(`Invalid dashboard provider JSON: ${manifestPath}`, { cause: error }); }
  const manifest = validateDashboardProviderManifest(json);
  const manifestDirectory = await realpath(resolve(manifestPath, '..'));
  const declaredRoot = resolve(manifestDirectory, manifest.artifactRoot);
  if (!contained(manifestDirectory, declaredRoot)) throw new Error('Dashboard provider path escapes its installation root');
  let root: string;
  try {
    root = await realpath(declaredRoot);
    await access(root, constants.R_OK);
  } catch (error) {
    throw new Error(`Dashboard provider artifact root is missing: ${declaredRoot}`, { cause: error });
  }
  if (!contained(manifestDirectory, root)) throw new Error('Dashboard provider path escapes its installation root');
  return { manifestPath: resolve(manifestPath), root, manifest };
}
