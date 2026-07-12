import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { loadDashboardProvider, validateDashboardProviderManifest } from '../../src/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

function manifest(overrides: Record<string, unknown> = {}) {
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

describe('dashboard provider manifest', () => {
  it('validates the replaceable provider contract', () => {
    expect(validateDashboardProviderManifest(manifest())).toMatchObject({ schemaVersion: 1, executable: 'node' });
    expect(() => validateDashboardProviderManifest(manifest({ schemaVersion: 2 }))).toThrow('Unsupported dashboard provider schema');
    expect(() => validateDashboardProviderManifest(manifest({ artifactRoot: '../outside' }))).toThrow('inside the provider root');
    expect(() => validateDashboardProviderManifest(manifest({ entrypoint: '/tmp/server.js' }))).toThrow('inside the provider root');
    expect(() => validateDashboardProviderManifest(manifest({ executable: '../node' }))).toThrow('command name');
    expect(() => validateDashboardProviderManifest(manifest({ healthUrl: 'javascript:{host}:{port}' }))).toThrow('valid HTTP URL');
    expect(() => validateDashboardProviderManifest(manifest({ compatibilityUrls: ['http://{host}:{port}/health'] }))).toThrow('missing /subscription.txt');
  });

  it('reports missing providers and entrypoints with installation guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-provider-'));
    roots.push(root);
    await expect(loadDashboardProvider(join(root, 'provider.json'))).rejects.toThrow('Install a dashboard provider first');
    await mkdir(join(root, 'artifact'));
    await writeFile(join(root, 'provider.json'), JSON.stringify(manifest()));
    await expect(loadDashboardProvider(join(root, 'provider.json'))).rejects.toThrow('entrypoint is missing');
  });

  it('rejects an entrypoint symlink that escapes the provider root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-provider-link-'));
    roots.push(root);
    await mkdir(join(root, 'artifact'));
    await writeFile(join(root, 'outside.js'), 'outside');
    await symlink(join(root, 'outside.js'), join(root, 'artifact', 'server.js'));
    await writeFile(join(root, 'provider.json'), JSON.stringify(manifest()));
    await expect(loadDashboardProvider(join(root, 'provider.json'))).rejects.toThrow('escapes its installation root');
  });
});
