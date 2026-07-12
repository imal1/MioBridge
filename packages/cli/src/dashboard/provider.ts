import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const DASHBOARD_PROVIDER_SCHEMA_VERSION = 1 as const;
export const DASHBOARD_MANIFEST_NAME = 'provider.json' as const;

export interface DashboardProviderManifest {
  readonly schemaVersion: typeof DASHBOARD_PROVIDER_SCHEMA_VERSION;
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

export interface LoadedDashboardProvider {
  readonly manifestPath: string;
  readonly root: string;
  readonly entrypoint: string;
  readonly manifest: DashboardProviderManifest;
}

const COMPATIBILITY_PATHS = ['/health', '/subscription.txt', '/clash.yaml', '/raw.txt'] as const;
const ENVIRONMENT_NAMES = ['HOSTNAME', 'PORT', 'MIOBRIDGE_CONFIG_DIR', 'CONFIG_FILE'] as const;

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

export function validateDashboardProviderManifest(value: unknown): DashboardProviderManifest {
  const input = object(value, 'Dashboard provider manifest');
  if (input.schemaVersion !== DASHBOARD_PROVIDER_SCHEMA_VERSION) {
    throw new Error(`Unsupported dashboard provider schema: ${String(input.schemaVersion)}`);
  }
  const artifactRoot = string(input.artifactRoot, 'artifactRoot');
  const entrypoint = string(input.entrypoint, 'entrypoint');
  const executable = string(input.executable, 'executable');
  assertRelativePath(artifactRoot, 'artifactRoot');
  assertRelativePath(entrypoint, 'entrypoint');
  if (executable.includes('/') || executable.includes('\\')) throw new Error('executable must be a command name');

  const environment = object(input.environment, 'environment');
  const environmentValues = [environment.host, environment.port, environment.configDir, environment.configFile];
  if (environmentValues.some((item, index) => item !== ENVIRONMENT_NAMES[index])) {
    throw new Error(`environment must map to ${ENVIRONMENT_NAMES.join(', ')}`);
  }
  const healthUrl = string(input.healthUrl, 'healthUrl');
  validateUrl(healthUrl, 'healthUrl');
  const compatibilityUrls = stringArray(input.compatibilityUrls, 'compatibilityUrls');
  for (const [index, url] of compatibilityUrls.entries()) validateUrl(url, `compatibilityUrls[${index}]`);
  const paths = new Set(compatibilityUrls.map(url => new URL(url.replace('{host}', '127.0.0.1').replace('{port}', '3000')).pathname));
  for (const path of COMPATIBILITY_PATHS) if (!paths.has(path)) throw new Error(`compatibilityUrls is missing ${path}`);

  return Object.freeze({
    schemaVersion: DASHBOARD_PROVIDER_SCHEMA_VERSION,
    dashboardVersion: string(input.dashboardVersion, 'dashboardVersion'),
    artifactRoot,
    executable,
    entrypoint,
    args: Object.freeze(stringArray(input.args, 'args')),
    environment: Object.freeze({ host: 'HOSTNAME', port: 'PORT', configDir: 'MIOBRIDGE_CONFIG_DIR', configFile: 'CONFIG_FILE' }),
    healthUrl,
    compatibilityUrls: Object.freeze(compatibilityUrls),
  });
}

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
  const declaredEntrypoint = resolve(declaredRoot, manifest.entrypoint);
  if (!contained(manifestDirectory, declaredRoot) || !contained(declaredRoot, declaredEntrypoint)) throw new Error('Dashboard provider path escapes its installation root');
  let root: string;
  let entrypoint: string;
  try {
    root = await realpath(declaredRoot);
    entrypoint = await realpath(declaredEntrypoint);
    await access(entrypoint, constants.R_OK);
  } catch (error) {
    throw new Error(`Dashboard provider entrypoint is missing: ${declaredEntrypoint}`, { cause: error });
  }
  if (!contained(manifestDirectory, root) || !contained(root, entrypoint)) throw new Error('Dashboard provider path escapes its installation root');
  return { manifestPath: resolve(manifestPath), root, entrypoint, manifest };
}

export function renderProviderUrl(template: string, host: string, port: number): string {
  return template.replaceAll('{host}', host).replaceAll('{port}', String(port));
}
