import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { loadDashboardProvider, validateDashboardProviderManifest } from '../../src/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

function v1Manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    dashboardVersion: '2.0.0',
    artifactRoot: 'artifact',
    executable: 'node',
    entrypoint: 'server.js',
    args: [],
    environment: { host: 'HOSTNAME', port: 'PORT', configDir: 'MIOBRIDGE_CONFIG_DIR', configFile: 'CONFIG_FILE' },
    healthUrl: 'http://{host}:{port}/health',
    compatibilityUrls: ['/health', '/subscription.txt', '/clash.yaml', '/raw.txt'].map(path => `http://{host}:{port}${path}`),
    ...overrides,
  };
}

function v2Manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    dashboardVersion: '2.0.0',
    artifactRoot: 'dist',
    reservedPaths: [],
    ...overrides,
  };
}

describe('dashboard provider manifest', () => {
  it('validates v1 provider contract', () => {
    expect(validateDashboardProviderManifest(v1Manifest())).toMatchObject({ schemaVersion: 1, executable: 'node' });
    expect(() => validateDashboardProviderManifest(v1Manifest({ schemaVersion: 3 }))).toThrow('Unsupported dashboard provider schema');
    expect(() => validateDashboardProviderManifest(v1Manifest({ artifactRoot: '../outside' }))).toThrow('inside the provider root');
    expect(() => validateDashboardProviderManifest(v1Manifest({ entrypoint: '/tmp/server.js' }))).toThrow('inside the provider root');
    expect(() => validateDashboardProviderManifest(v1Manifest({ executable: '../node' }))).toThrow('command name');
    expect(() => validateDashboardProviderManifest(v1Manifest({ healthUrl: 'javascript:{host}:{port}' }))).toThrow('valid HTTP URL');
    expect(() => validateDashboardProviderManifest(v1Manifest({ compatibilityUrls: ['http://{host}:{port}/health'] }))).toThrow('missing /subscription.txt');
  });

  it('validates v2 provider contract', () => {
    const m = validateDashboardProviderManifest(v2Manifest());
    expect(m).toMatchObject({ schemaVersion: 2, artifactRoot: 'dist' });
    // v2 auto-adds reserved paths
    expect('reservedPaths' in m).toBe(true);
  });

  it('rejects v2 with escape path', () => {
    expect(() => validateDashboardProviderManifest(v2Manifest({ artifactRoot: '../outside' }))).toThrow('inside the provider root');
  });

  it('reports missing providers with installation guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-provider-'));
    roots.push(root);
    await expect(loadDashboardProvider(join(root, 'provider.json'))).rejects.toThrow('Install a dashboard provider first');
  });

  it('loads v2 provider with valid artifact root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-provider-v2-'));
    roots.push(root);
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'provider.json'), JSON.stringify(v2Manifest()));
    const result = await loadDashboardProvider(join(root, 'provider.json'));
    expect(result.manifest.schemaVersion).toBe(2);
    expect(result.manifest.artifactRoot).toBe('dist');
  });
});
