import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const DASHBOARD_PROVIDER_SCHEMA_VERSION = 2 as const;
export const DASHBOARD_MANIFEST_NAME = 'provider.json' as const;

// ── v1 (Next standalone) — read-only, migration only ────────────────

export interface DashboardProviderManifestV1 {
  readonly schemaVersion: 1;
  readonly dashboardVersion: string;
  readonly artifactRoot: string;
  readonly executable: string;
  readonly entrypoint: string;
  readonly args: readonly string[];
  readonly environment: {
    readonly host: string;
    readonly port: string;
    readonly configDir: string;
    readonly configFile: string;
  };
  readonly healthUrl: string;
  readonly compatibilityUrls: readonly string[];
}

// ── v2 (Vite static) — canonical form ────────────────────────────────

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

function validateUrl(value: string, name: string): void {
  if (!value.includes('{host}') || !value.includes('{port}')) throw new Error(`${name} must contain {host} and {port}`);
  try {
    const parsed = new URL(value.replace('{host}', '127.0.0.1').replace('{port}', '3000'));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    throw new Error(`${name} must be a valid HTTP URL template`);
  }
}

function validateV1Manifest(value: Record<string, unknown>): DashboardProviderManifestV1 {
  if (value.schemaVersion !== 1) throw new Error(`Unsupported dashboard provider schema: ${String(value.schemaVersion)}`);
  const artifactRoot = string(value.artifactRoot, 'artifactRoot');
  const entrypoint = string(value.entrypoint, 'entrypoint');
  const executable = string(value.executable, 'executable');
  assertRelativePath(artifactRoot, 'artifactRoot');
  assertRelativePath(entrypoint, 'entrypoint');
  if (executable.includes('/') || executable.includes('\\')) throw new Error('executable must be a command name');

  const environment = object(value.environment, 'environment');
  const ENVIRONMENT_NAMES = ['HOSTNAME', 'PORT', 'MIOBRIDGE_CONFIG_DIR', 'CONFIG_FILE'] as const;
  const environmentValues = [environment.host, environment.port, environment.configDir, environment.configFile];
  if (environmentValues.some((item, index) => item !== ENVIRONMENT_NAMES[index])) {
    throw new Error(`environment must map to ${ENVIRONMENT_NAMES.join(', ')}`);
  }
  const healthUrl = string(value.healthUrl, 'healthUrl');
  validateUrl(healthUrl, 'healthUrl');
  const compatibilityUrls = stringArray(value.compatibilityUrls, 'compatibilityUrls');
  for (const [index, url] of compatibilityUrls.entries()) validateUrl(url, `compatibilityUrls[${index}]`);
  const paths = new Set(compatibilityUrls.map(url => new URL(url.replace('{host}', '127.0.0.1').replace('{port}', '3000')).pathname));
  for (const path of COMPATIBILITY_PATHS) if (!paths.has(path)) throw new Error(`compatibilityUrls is missing ${path}`);

  return Object.freeze({
    schemaVersion: 1 as const,
    dashboardVersion: string(value.dashboardVersion, 'dashboardVersion'),
    artifactRoot,
    executable,
    entrypoint,
    args: Object.freeze(stringArray(value.args, 'args')),
    environment: Object.freeze({ host: 'HOSTNAME', port: 'PORT', configDir: 'MIOBRIDGE_CONFIG_DIR', configFile: 'CONFIG_FILE' }),
    healthUrl,
    compatibilityUrls: Object.freeze(compatibilityUrls),
  });
}

function validateV2Manifest(value: Record<string, unknown>): DashboardProviderManifest {
  if (value.schemaVersion !== 2) throw new Error(`Unsupported dashboard provider schema: ${String(value.schemaVersion)}`);
  const artifactRoot = string(value.artifactRoot, 'artifactRoot');
  assertRelativePath(artifactRoot, 'artifactRoot');

  return Object.freeze({
    schemaVersion: 2 as const,
    dashboardVersion: string(value.dashboardVersion, 'dashboardVersion'),
    artifactRoot,
    ...(typeof value.spaFallback === 'boolean' ? { spaFallback: value.spaFallback } : {}),
    reservedPaths: Object.freeze([
      ...stringArray(value.reservedPaths ?? [], 'reservedPaths'),
      ...COMPATIBILITY_PATHS,
      '/api',
    ]),
  });
}

export function validateDashboardProviderManifest(value: unknown): DashboardProviderManifest | DashboardProviderManifestV1 {
  const input = object(value, 'Dashboard provider manifest');
  if (input.schemaVersion === 1) return validateV1Manifest(input);
  if (input.schemaVersion === 2) return validateV2Manifest(input);
  throw new Error(`Unsupported dashboard provider schema: ${String(input.schemaVersion)}`);
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
  return { manifestPath: resolve(manifestPath), root, manifest: manifest as DashboardProviderManifest };
}

export function renderProviderUrl(template: string, host: string, port: number): string {
  return template.replaceAll('{host}', host).replaceAll('{port}', String(port));
}

/** Check if a manifest is v1 (Next standalone) and needs migration. */
export function isV1Manifest(manifest: DashboardProviderManifest | DashboardProviderManifestV1): manifest is DashboardProviderManifestV1 {
  return manifest.schemaVersion === 1;
}
